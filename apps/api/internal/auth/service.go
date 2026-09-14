package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 业务错误。handler 层把它们映射为 HTTP 状态码与错误码；
// 内部错误（DB 故障等）直接向上冒泡为 500。
var (
	ErrHandleTaken      = errors.New("用户名已被占用")
	ErrEmailTaken       = errors.New("邮箱已被注册")
	ErrPasswordPolicy   = errors.New("密码长度需在 8 到 128 之间")
	ErrInvalidCreds     = errors.New("账号或密码错误")
	ErrAccountSuspended = errors.New("账号已被停用")
	ErrRefreshInvalid   = errors.New("刷新令牌无效")
	ErrRefreshExpired   = errors.New("刷新令牌已过期，请重新登录")
	ErrRefreshReused    = errors.New("检测到刷新令牌重用，已撤销该账号全部会话，请重新登录")
	ErrWrongPassword    = errors.New("当前密码不正确")
)

// dummyHash 用于用户不存在时的时序抹平（防用户枚举）：
// 反正要跑一次 argon2，别让「有这个账号」从响应时间里漏出去。
const dummyHash = "$argon2id$v=19$m=65536,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

// User 用户资料的库内表示。
type User struct {
	ID             uuid.UUID
	Handle         string
	DisplayName    string
	Email          string
	EmailVerified  bool
	AvatarURL      *string
	Bio            *string
	Location       *string
	Website        *string
	UnitPreference string
	IsOfficial     bool
	FollowerCount  int
	FollowingCount int
	RecipeCount    int
	CreatedAt      time.Time
}

// SessionInfo 一次登录/注册/刷新的完整产物。
type SessionInfo struct {
	User         *User
	AccessToken  string
	RefreshToken string
}

// UpdateProfile PATCH /me 的可空字段：nil = 不改。
type UpdateProfile struct {
	DisplayName    *string
	Bio            *string
	Location       *string
	Website        *string
	AvatarURL      *string
	UnitPreference *string
}

const userCols = `id, handle, display_name, email, email_verified, avatar_url, bio, location, website,
	unit_preference, is_official, follower_count, following_count, recipe_count, created_at`

// Service 认证业务逻辑。
type Service struct {
	pool   *pgxpool.Pool
	tokens *TokenManager
}

func NewService(pool *pgxpool.Pool, tokens *TokenManager) *Service {
	return &Service{pool: pool, tokens: tokens}
}

// execer 让 createSession 同时接受 pool 和 tx。
type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// ─────────────────────────────── 注册 / 登录 ───────────────────────────────

// Register 创建用户并发给首个会话。handle/email 冲突返回 ErrHandleTaken/ErrEmailTaken。
func (s *Service) Register(ctx context.Context, handle, email, password, displayName, userAgent string, ip *netip.Addr) (*SessionInfo, error) {
	if len(password) < 8 || len(password) > 128 {
		return nil, ErrPasswordPolicy
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	userID, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("生成 UUIDv7: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // 提交后是 no-op

	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, handle, display_name, email, password_hash)
		VALUES ($1, $2, $3, $4, $5)`,
		userID, handle, displayName, email, hash)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if pgErr.ConstraintName == "users_handle_lower_key" {
				return nil, ErrHandleTaken
			}
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("创建用户: %w", err)
	}

	chainID, refresh, err := createSession(ctx, tx, userID, userAgent, ip)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return s.assemble(ctx, userID, chainID, refresh)
}

// Login 按 handle 或 email（大小写不敏感）登录。
func (s *Service) Login(ctx context.Context, identifier, password, userAgent string, ip *netip.Addr) (*SessionInfo, error) {
	var (
		id     uuid.UUID
		hash   *string
		status string
	)
	err := s.pool.QueryRow(ctx, `
		SELECT id, password_hash, status FROM users
		WHERE lower(handle) = lower($1) OR lower(email) = lower($1)`, identifier).
		Scan(&id, &hash, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_, _ = VerifyPassword(password, dummyHash) // 时序抹平
			return nil, ErrInvalidCreds
		}
		return nil, fmt.Errorf("查询用户: %w", err)
	}
	if hash == nil {
		// 无密码账号（v1 不存在，防御性处理）
		_, _ = VerifyPassword(password, dummyHash)
		return nil, ErrInvalidCreds
	}
	ok, err := VerifyPassword(password, *hash)
	if err != nil {
		return nil, fmt.Errorf("校验密码: %w", err)
	}
	if !ok {
		return nil, ErrInvalidCreds
	}
	switch status {
	case "suspended":
		return nil, ErrAccountSuspended
	case "deleted":
		return nil, ErrInvalidCreds // 不泄露账号存在性
	}

	chainID, refresh, err := createSession(ctx, s.pool, id, userAgent, ip)
	if err != nil {
		return nil, err
	}
	return s.assemble(ctx, id, chainID, refresh)
}

// ─────────────────────────────── 刷新（轮转 + 重用检测） ───────────────────────────────

// Refresh 用刷新令牌换新令牌对。旧令牌立即失效；检测到重放旧令牌时
// 撤销该用户全部会话（API 定义 §1.2 的标准泄露应对）。
func (s *Service) Refresh(ctx context.Context, refreshToken, userAgent string, ip *netip.Addr) (*SessionInfo, error) {
	hash := HashRefreshToken(refreshToken)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 原子认领：UPDATE ... WHERE revoked_at IS NULL 保证并发下同一令牌
	// 只有一个请求能完成轮转，其余落入重用分支。
	var (
		oldID, chainID, userID uuid.UUID
		expiresAt              time.Time
	)
	err = tx.QueryRow(ctx, `
		UPDATE sessions SET revoked_at = now()
		WHERE refresh_token_hash = $1 AND revoked_at IS NULL
		RETURNING id, chain_id, user_id, expires_at`, hash).
		Scan(&oldID, &chainID, &userID, &expiresAt)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("认领刷新令牌: %w", err)
		}
		return nil, s.detectReuse(ctx, hash)
	}
	if expiresAt.Before(time.Now()) {
		// 过期令牌：认领已把它标记为撤销，提交以保留这个状态
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("提交事务: %w", err)
		}
		return nil, ErrRefreshExpired
	}

	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM users WHERE id = $1`, userID).Scan(&status); err != nil {
		return nil, fmt.Errorf("查询用户状态: %w", err)
	}
	if status != "active" {
		// 停用/删除账号：借这个事务把整条链一起撤销
		if _, err := tx.Exec(ctx,
			`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
			return nil, fmt.Errorf("撤销会话: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("提交事务: %w", err)
		}
		if status == "suspended" {
			return nil, ErrAccountSuspended
		}
		return nil, ErrRefreshInvalid
	}

	// 轮转：新行接续同一条链
	refresh, err := insertSession(ctx, tx, chainID, userID, userAgent, ip)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	_ = oldID // 认领后不再需要旧行信息

	return s.assemble(ctx, userID, chainID, refresh)
}

// detectReuse 处理认领失败的令牌：不存在 → 无效；存在且已撤销 → 重放，
// 撤销该用户全部会话并告警。
func (s *Service) detectReuse(ctx context.Context, hash string) error {
	var (
		userID    uuid.UUID
		revokedAt *time.Time
	)
	err := s.pool.QueryRow(ctx,
		`SELECT user_id, revoked_at FROM sessions WHERE refresh_token_hash = $1`, hash).
		Scan(&userID, &revokedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRefreshInvalid
		}
		return fmt.Errorf("查询刷新令牌: %w", err)
	}
	if revokedAt == nil {
		// 理论不可达：认领 UPDATE 覆盖了未撤销分支。防御性兜底。
		return ErrRefreshInvalid
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
		return fmt.Errorf("撤销全部会话: %w", err)
	}
	slog.Warn("检测到刷新令牌重用，已撤销该用户全部会话", "user_id", userID)
	return ErrRefreshReused
}

// ─────────────────────────────── 登出 / 改密 ───────────────────────────────

// Logout 撤销当前会话链。
func (s *Service) Logout(ctx context.Context, chainID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE sessions SET revoked_at = now() WHERE chain_id = $1 AND revoked_at IS NULL`, chainID)
	if err != nil {
		return fmt.Errorf("撤销会话链: %w", err)
	}
	return nil
}

// LogoutAll 撤销用户全部会话。
func (s *Service) LogoutAll(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	if err != nil {
		return fmt.Errorf("撤销全部会话: %w", err)
	}
	return nil
}

// ChangePassword 校验旧密码后改新密码，并撤销除当前链以外的全部会话。
func (s *Service) ChangePassword(ctx context.Context, userID, chainID uuid.UUID, currentPassword, newPassword string) error {
	if len(newPassword) < 8 || len(newPassword) > 128 {
		return ErrPasswordPolicy
	}
	var hash *string
	err := s.pool.QueryRow(ctx,
		`SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidCreds
		}
		return fmt.Errorf("查询用户: %w", err)
	}
	if hash == nil {
		return ErrInvalidCreds
	}
	ok, err := VerifyPassword(currentPassword, *hash)
	if err != nil {
		return fmt.Errorf("校验密码: %w", err)
	}
	if !ok {
		return ErrWrongPassword
	}
	newHash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, userID, newHash); err != nil {
		return fmt.Errorf("更新密码: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET revoked_at = now()
		WHERE user_id = $1 AND chain_id <> $2 AND revoked_at IS NULL`, userID, chainID); err != nil {
		return fmt.Errorf("撤销其它会话: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("提交事务: %w", err)
	}
	return nil
}

// ─────────────────────────────── 用户资料 ───────────────────────────────

// GetMe 返回当前用户资料。
func (s *Service) GetMe(ctx context.Context, userID uuid.UUID) (*User, error) {
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, userID))
}

// UpdateMe 更新资料的可空字段（nil = 保持不变），返回更新后的完整资料。
func (s *Service) UpdateMe(ctx context.Context, userID uuid.UUID, p UpdateProfile) (*User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET
			display_name    = COALESCE($2, display_name),
			bio             = COALESCE($3, bio),
			location        = COALESCE($4, location),
			website         = COALESCE($5, website),
			avatar_url      = COALESCE($6, avatar_url),
			unit_preference = COALESCE($7, unit_preference)
		WHERE id = $1 AND status = 'active'
		RETURNING `+userCols,
		userID, p.DisplayName, p.Bio, p.Location, p.Website, p.AvatarURL, p.UnitPreference)
	return scanUser(row)
}

// ─────────────────────────────── 内部工具 ───────────────────────────────

// createSession 插入会话行：新链的 chain_id = 自身 id。
func createSession(ctx context.Context, q execer, userID uuid.UUID, userAgent string, ip *netip.Addr) (chainID uuid.UUID, refresh string, err error) {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("生成 UUIDv7: %w", err)
	}
	refresh, err = insertSession(ctx, q, id, userID, userAgent, ip)
	return id, refresh, err
}

// insertSession 插入会话行（轮转时接续既有链）。
func insertSession(ctx context.Context, q execer, chainID, userID uuid.UUID, userAgent string, ip *netip.Addr) (refresh string, err error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("生成 UUIDv7: %w", err)
	}
	refresh, hash, err := NewRefreshToken()
	if err != nil {
		return "", err
	}
	_, err = q.Exec(ctx, `
		INSERT INTO sessions (id, chain_id, user_id, refresh_token_hash, user_agent, ip, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, now() + $7::interval)`,
		id, chainID, userID, hash, userAgent, ip, fmt.Sprintf("%d seconds", int(RefreshTokenTTL.Seconds())))
	if err != nil {
		return "", fmt.Errorf("写入会话: %w", err)
	}
	return refresh, nil
}

// assemble 加载用户并签发访问令牌。
func (s *Service) assemble(ctx context.Context, userID, chainID uuid.UUID, refresh string) (*SessionInfo, error) {
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	access, err := s.tokens.NewAccessToken(userID, chainID)
	if err != nil {
		return nil, err
	}
	return &SessionInfo{User: user, AccessToken: access, RefreshToken: refresh}, nil
}

// GetUser 按 ID 加载用户（亦供 handler 层复用）。
func (s *Service) GetUser(ctx context.Context, userID uuid.UUID) (*User, error) {
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, userID))
}

func scanUser(row pgx.Row) (*User, error) {
	u := &User{}
	err := row.Scan(&u.ID, &u.Handle, &u.DisplayName, &u.Email, &u.EmailVerified,
		&u.AvatarURL, &u.Bio, &u.Location, &u.Website, &u.UnitPreference,
		&u.IsOfficial, &u.FollowerCount, &u.FollowingCount, &u.RecipeCount, &u.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("扫描用户行: %w", err)
	}
	return u, nil
}
