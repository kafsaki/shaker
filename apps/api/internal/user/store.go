// Package user 公开资料与关注关系（API 定义 §2.8）。
//
// 关注/取关在同一事务里维护 follows 行与双方计数；幂等（重复关注、
// 关注不存在的人取关都是 no-op 成功）。计数漂移由 river 对账任务兜底（ADR-006）。
package user

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/cursor"
	"github.com/kafsaki/shaker/apps/api/internal/notify"
)

var (
	ErrNotFound   = errors.New("用户不存在")
	ErrSelfFollow = errors.New("不能关注自己")
	ErrBadCursor  = errors.New("分页游标无效")
)

// Profile 公开资料（不含 email —— 那是 /me 的事）。
type Profile struct {
	ID             uuid.UUID
	Handle         string
	DisplayName    string
	AvatarURL      *string
	Bio            *string
	Location       *string
	Website        *string
	IsOfficial     bool
	FollowerCount  int
	FollowingCount int
	RecipeCount    int
	CreatedAt      time.Time
}

// Card 粉丝/关注列表里的用户卡片。
type Card struct {
	ID            uuid.UUID
	Handle        string
	DisplayName   string
	AvatarURL     *string
	IsOfficial    bool
	FollowerCount int
	RecipeCount   int
}

// Store 用户数据访问。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

const profileCols = `id, handle, display_name, avatar_url, bio, location, website,
	is_official, follower_count, following_count, recipe_count, created_at`

func scanProfile(row pgx.Row) (*Profile, error) {
	p := &Profile{}
	if err := row.Scan(&p.ID, &p.Handle, &p.DisplayName, &p.AvatarURL, &p.Bio, &p.Location,
		&p.Website, &p.IsOfficial, &p.FollowerCount, &p.FollowingCount, &p.RecipeCount, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return p, nil
}

// ProfileByHandle 公开资料。已注销/停用的账号视同不存在。
func (s *Store) ProfileByHandle(ctx context.Context, handle string) (*Profile, error) {
	p, err := scanProfile(s.pool.QueryRow(ctx, `
		SELECT `+profileCols+` FROM users
		WHERE lower(handle) = lower($1) AND status = 'active' AND deleted_at IS NULL`, handle))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询用户 %s: %w", handle, err)
	}
	return p, nil
}

// IsFollowing viewer 是否关注了 target。
func (s *Store) IsFollowing(ctx context.Context, viewer, target uuid.UUID) (bool, error) {
	var ok bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2)`,
		viewer, target).Scan(&ok); err != nil {
		return false, fmt.Errorf("查询关注状态: %w", err)
	}
	return ok, nil
}

/* ────────────────────────── 关注 / 取关 ────────────────────────── */

// Follow 关注。幂等：已关注直接成功。返回最新的被关注者资料。
func (s *Store) Follow(ctx context.Context, followerID, followeeID uuid.UUID) (*Profile, error) {
	if followerID == followeeID {
		return nil, ErrSelfFollow
	}
	if err := s.followTx(ctx, followerID, followeeID, true); err != nil {
		return nil, err
	}
	return s.ProfileByID(ctx, followeeID)
}

// Unfollow 取关。幂等。
func (s *Store) Unfollow(ctx context.Context, followerID, followeeID uuid.UUID) (*Profile, error) {
	if err := s.followTx(ctx, followerID, followeeID, false); err != nil {
		return nil, err
	}
	return s.ProfileByID(ctx, followeeID)
}

// followTx 关注关系的事务体。changed = true 关注 / false 取关。
// 计数 UPDATE 按 UUID 升序加锁，避免 A↔B 并发互相关注时死锁。
func (s *Store) followTx(ctx context.Context, followerID, followeeID uuid.UUID, follow bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var ok bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM users
			WHERE id = $1 AND status = 'active' AND deleted_at IS NULL)`, followeeID).Scan(&ok); err != nil {
		return fmt.Errorf("查询目标用户: %w", err)
	}
	if !ok {
		return ErrNotFound
	}

	var tag pgconn.CommandTag
	if follow {
		tag, err = tx.Exec(ctx, `
			INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
			ON CONFLICT DO NOTHING`, followerID, followeeID)
	} else {
		tag, err = tx.Exec(ctx, `
			DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, followerID, followeeID)
	}
	if err != nil {
		return fmt.Errorf("写关注关系: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return tx.Commit(ctx) // 幂等：状态没变，只回计数现状
	}

	// 关注成功 → 通知被关注者（取关不发）
	if follow {
		if err := notify.Insert(ctx, tx, followeeID, notify.TypeFollow, &followerID, "user", &followerID, nil); err != nil {
			return err
		}
	}

	delta := 1
	if !follow {
		delta = -1
	}
	first, second := followerID, followeeID
	if second.String() < first.String() {
		first, second = second, first
	}
	for _, u := range []uuid.UUID{first, second} {
		col := "following_count" // 关注者自己的「关注了多少人」
		if u == followeeID {
			col = "follower_count" // 被关注者的「粉丝数」
		}
		if _, err := tx.Exec(ctx,
			fmt.Sprintf(`UPDATE users SET %s = %s + %d WHERE id = $1`, col, col, delta), u); err != nil {
			return fmt.Errorf("更新计数: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// ProfileByID 关注操作后回填最新资料（含计数）。
func (s *Store) ProfileByID(ctx context.Context, id uuid.UUID) (*Profile, error) {
	p, err := scanProfile(s.pool.QueryRow(ctx, `
		SELECT `+profileCols+` FROM users WHERE id = $1 AND deleted_at IS NULL`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询用户 %s: %w", id, err)
	}
	return p, nil
}

/* ────────────────────────── 关注关系列表 ────────────────────────── */

// ListResult 泛型列表页。NextCursor 为 "" 表示到底。
type ListResult struct {
	Items      []Card
	NextCursor string
}

// Followers 某人的粉丝，按关注时间倒序。
func (s *Store) Followers(ctx context.Context, followeeID uuid.UUID, cur string, limit int) (*ListResult, error) {
	return s.followList(ctx, `JOIN users u ON u.id = f.follower_id
		WHERE f.followee_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL`, followeeID, cur, limit)
}

// Following 某人关注的人，按关注时间倒序。
func (s *Store) Following(ctx context.Context, followerID uuid.UUID, cur string, limit int) (*ListResult, error) {
	return s.followList(ctx, `JOIN users u ON u.id = f.followee_id
		WHERE f.follower_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL`, followerID, cur, limit)
}

// followList 粉丝/关注列表共用：f.created_at DESC, u.id ASC，Time 游标。
// joinWhere 是「JOIN ... WHERE ...」片段（$1 = 视角用户）。
func (s *Store) followList(ctx context.Context, joinWhere string, userID uuid.UUID, cur string, limit int) (*ListResult, error) {
	c, err := cursor.Decode[cursor.Time](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{userID}
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (f.created_at < $%d OR (f.created_at = $%d AND u.id > $%d))", n-1, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.handle, u.display_name, u.avatar_url, u.is_official, u.follower_count, u.recipe_count, f.created_at
		FROM follows f `+joinWhere+pred+`
		ORDER BY f.created_at DESC, u.id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("查询关注列表: %w", err)
	}
	defer rows.Close()

	var cards []Card
	var followedAt []time.Time
	for rows.Next() {
		card := Card{}
		var at time.Time
		if err := rows.Scan(&card.ID, &card.Handle, &card.DisplayName, &card.AvatarURL,
			&card.IsOfficial, &card.FollowerCount, &card.RecipeCount, &at); err != nil {
			return nil, fmt.Errorf("扫描关注列表: %w", err)
		}
		cards = append(cards, card)
		followedAt = append(followedAt, at)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历关注列表: %w", err)
	}

	res := &ListResult{Items: cards}
	if len(cards) > limit { // 多取的那条只用来判断还有没有下一页
		cards = cards[:limit]
		res.Items = cards
		res.NextCursor = cursor.Encode(cursor.Time{
			T: followedAt[limit-1].UnixNano(), ID: cards[limit-1].ID.String(),
		})
	}
	return res, nil
}

/* ────────────────────────── 用户搜索（需求 4） ────────────────────────── */

// Search 按 handle/展示名模糊搜索（pg_trgm + ILIKE 兜底短词）。
// 排序：相似度 DESC, id ASC，Hot 游标（S = 相似度分）。
func (s *Store) Search(ctx context.Context, q, cur string, limit int) (*ListResult, error) {
	c, err := cursor.Decode[cursor.Hot](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{q}
	pred := ""
	if c != nil {
		args = append(args, c.H, c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (greatest(similarity(handle, $1), similarity(display_name, $1)) < $%d OR (greatest(similarity(handle, $1), similarity(display_name, $1)) = $%d AND id > $%d))", n-1, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT id, handle, display_name, avatar_url, is_official, follower_count, recipe_count,
			greatest(similarity(handle, $1), similarity(display_name, $1)) AS score
		FROM users
		WHERE status = 'active' AND deleted_at IS NULL
			AND (handle % $1 OR display_name % $1 OR handle ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%')`+pred+`
		ORDER BY score DESC, id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("搜索用户: %w", err)
	}
	defer rows.Close()

	type hit struct {
		Card
		Score float32
	}
	var hits []hit
	for rows.Next() {
		h := hit{}
		if err := rows.Scan(&h.ID, &h.Handle, &h.DisplayName, &h.AvatarURL,
			&h.IsOfficial, &h.FollowerCount, &h.RecipeCount, &h.Score); err != nil {
			return nil, fmt.Errorf("扫描用户搜索: %w", err)
		}
		hits = append(hits, h)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历用户搜索: %w", err)
	}

	res := &ListResult{}
	if len(hits) > limit {
		hits = hits[:limit]
		res.NextCursor = cursor.Encode(cursor.Hot{H: hits[limit-1].Score, ID: hits[limit-1].ID.String()})
	}
	for _, h := range hits {
		res.Items = append(res.Items, h.Card)
	}
	return res, nil
}

// SearchCount 与 Search 同条件的总数（type=all 分组里的 total）。
func (s *Store) SearchCount(ctx context.Context, q string) (int, error) {
	var n int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM users
		WHERE status = 'active' AND deleted_at IS NULL
			AND (handle % $1 OR display_name % $1 OR handle ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%')`,
		q).Scan(&n); err != nil {
		return 0, fmt.Errorf("统计用户搜索: %w", err)
	}
	return n, nil
}
