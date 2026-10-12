// Package wiki 百科式维护（ADR-027）：编辑身份、原料词条修订、修订动态。
//
// 经典配方的修订走 recipe.Store.Update 的编辑通道（同一套校验与投影），
// 这里只管 recipe 包之外的部分：谁能改、原料词条怎么改、最近改了什么。
// 每次修订都存完整快照而非差异 —— 词条很小，快照让「回到某一版」只是一次读取。
package wiki

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	RoleUser   = "user"
	RoleEditor = "editor"
	RoleAdmin  = "admin"
)

var (
	ErrNotFound  = errors.New("条目不存在")
	ErrForbidden = errors.New("需要编辑身份")
	ErrSelf      = errors.New("不能修改自己的身份")
	ErrAdmin     = errors.New("管理员的身份只能通过部署配置调整")
)

// VersionConflict 乐观锁失败：词条在你打开之后被别人改过。
type VersionConflict struct{ Current int }

func (e *VersionConflict) Error() string {
	return fmt.Sprintf("词条已被修订到第 %d 版", e.Current)
}

// CanEdit 该角色能否修订经典配方与原料词条。
func CanEdit(role string) bool { return role == RoleEditor || role == RoleAdmin }

// Store 百科数据访问。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

/* ────────────────────────── 身份 ────────────────────────── */

// Role 当前角色。每次写操作现查：撤销编辑身份即时生效，不必等访问令牌过期。
func (s *Store) Role(ctx context.Context, userID uuid.UUID) (string, error) {
	var role string
	err := s.pool.QueryRow(ctx, `SELECT role FROM users WHERE id = $1 AND status = 'active'`, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleUser, nil
	}
	if err != nil {
		return "", fmt.Errorf("查询角色: %w", err)
	}
	return role, nil
}

// Member 编辑部名册里的一行。
type Member struct {
	ID          uuid.UUID
	Handle      string
	DisplayName string
	AvatarURL   *string
	Role        string
	EditCount   int
	LastEditAt  *time.Time
}

const memberCols = `u.id, u.handle, u.display_name, u.avatar_url, u.role,
	(SELECT count(*) FROM recipe_revisions v JOIN recipes r ON r.id = v.recipe_id
		WHERE v.editor_id = u.id AND r.is_canonical AND v.meta IS NOT NULL)
	+ (SELECT count(*) FROM ingredient_revisions v WHERE v.editor_id = u.id AND v.version > 0),
	greatest(
		(SELECT max(v.created_at) FROM recipe_revisions v JOIN recipes r ON r.id = v.recipe_id
			WHERE v.editor_id = u.id AND r.is_canonical AND v.meta IS NOT NULL),
		(SELECT max(v.created_at) FROM ingredient_revisions v WHERE v.editor_id = u.id AND v.version > 0))`

func scanMember(row pgx.Row) (*Member, error) {
	m := &Member{}
	if err := row.Scan(&m.ID, &m.Handle, &m.DisplayName, &m.AvatarURL, &m.Role, &m.EditCount, &m.LastEditAt); err != nil {
		return nil, err
	}
	return m, nil
}

// Editors 编辑部名册：管理员在前，再按修订数。
func (s *Store) Editors(ctx context.Context) ([]Member, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+memberCols+` FROM users u
		WHERE u.role IN ('editor', 'admin') AND u.status = 'active' AND u.deleted_at IS NULL
		ORDER BY u.role = 'admin' DESC, 6 DESC, u.handle`)
	if err != nil {
		return nil, fmt.Errorf("查询编辑名册: %w", err)
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, fmt.Errorf("扫描编辑名册: %w", err)
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// SetRole 管理员授予/撤销编辑身份。只在 user ↔ editor 之间切换；
// 管理员由部署配置产生（PromoteAdmins），站内不能互相罢免。
func (s *Store) SetRole(ctx context.Context, actorID uuid.UUID, handle, role string) (*Member, error) {
	actorRole, err := s.Role(ctx, actorID)
	if err != nil {
		return nil, err
	}
	if actorRole != RoleAdmin {
		return nil, ErrForbidden
	}
	var id uuid.UUID
	var cur string
	err = s.pool.QueryRow(ctx, `
		SELECT id, role FROM users
		WHERE lower(handle) = lower($1) AND status = 'active' AND deleted_at IS NULL`, handle).Scan(&id, &cur)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("查询用户: %w", err)
	}
	if id == actorID {
		return nil, ErrSelf
	}
	if cur == RoleAdmin {
		return nil, ErrAdmin
	}
	if _, err := s.pool.Exec(ctx, `UPDATE users SET role = $2 WHERE id = $1`, id, role); err != nil {
		return nil, fmt.Errorf("更新角色: %w", err)
	}
	m, err := scanMember(s.pool.QueryRow(ctx, `SELECT `+memberCols+` FROM users u WHERE u.id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("回读成员: %w", err)
	}
	return m, nil
}

// PromoteAdmins 启动时把配置里的账号提升为管理员；不存在的 handle 只告知调用方。
func (s *Store) PromoteAdmins(ctx context.Context, handles []string) (missing []string, err error) {
	for _, h := range handles {
		tag, err := s.pool.Exec(ctx, `
			UPDATE users SET role = 'admin'
			WHERE lower(handle) = lower($1) AND deleted_at IS NULL AND role <> 'admin'`, h)
		if err != nil {
			return nil, fmt.Errorf("提升管理员 %s: %w", h, err)
		}
		if tag.RowsAffected() == 0 {
			var ok bool
			if err := s.pool.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM users WHERE lower(handle) = lower($1) AND deleted_at IS NULL)`, h).Scan(&ok); err != nil {
				return nil, fmt.Errorf("查询用户 %s: %w", h, err)
			}
			if !ok {
				missing = append(missing, h)
			}
		}
	}
	return missing, nil
}

/* ────────────────────────── 原料词条 ────────────────────────── */

// IngredientEdit 一次词条修订（整表提交：表单总是带着全部可编辑字段）。
// ABV、品类、视觉样式 v1 不开放 —— 它们牵动分层与配方计算，见 ADR-027。
type IngredientEdit struct {
	NameZh        string
	NameEn        string
	Aliases       []string
	DescriptionZh *string
	DescriptionEn *string
	Note          *string
	IfMatch       int
}

// snapshotSQL 当前词条的快照（与 IngredientSnapshot 的 JSON 字段一一对应）。
const snapshotSQL = `
	SELECT jsonb_build_object(
		'nameZh', i.name_zh, 'nameEn', i.name_en,
		'aliases', coalesce((SELECT jsonb_agg(a.alias ORDER BY a.alias) FROM ingredient_aliases a WHERE a.ingredient_id = i.id), '[]'::jsonb),
		'descriptionZh', i.description_zh_md, 'descriptionEn', i.description_en_md)
	FROM ingredients i WHERE i.id = $1`

// UpdateIngredient 修订原料词条，返回新版本号。
// 第一次修订先把种子原文存成第 0 版：历史页因此总能对比出「改了什么」，也能回到原文。
func (s *Store) UpdateIngredient(ctx context.Context, id string, editorID uuid.UUID, in IngredientEdit) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var version int
	err = tx.QueryRow(ctx, `SELECT wiki_version FROM ingredients WHERE id = $1 AND is_official FOR UPDATE`, id).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("锁定原料: %w", err)
	}
	if version != in.IfMatch {
		return 0, &VersionConflict{Current: version}
	}
	if version == 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ingredient_revisions (ingredient_id, version, snapshot, note)
			SELECT $1, 0, (`+snapshotSQL+`), '种子原文'
			ON CONFLICT DO NOTHING`, id); err != nil {
			return 0, fmt.Errorf("存档种子原文: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE ingredients SET name_zh = $2, name_en = $3, description_zh_md = $4, description_en_md = $5,
			wiki_version = wiki_version + 1, wiki_edited_at = now()
		WHERE id = $1`,
		id, strings.TrimSpace(in.NameZh), strings.TrimSpace(in.NameEn),
		blankToNil(in.DescriptionZh), blankToNil(in.DescriptionEn)); err != nil {
		return 0, fmt.Errorf("更新原料: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM ingredient_aliases WHERE ingredient_id = $1`, id); err != nil {
		return 0, fmt.Errorf("清理别名: %w", err)
	}
	for _, alias := range normalizeAliases(in.Aliases) {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ingredient_aliases (ingredient_id, alias, lang) VALUES ($1, $2, $3)`,
			id, alias, aliasLang(alias)); err != nil {
			return 0, fmt.Errorf("写入别名 %s: %w", alias, err)
		}
	}

	next := version + 1
	note := "修订词条"
	if in.Note != nil && strings.TrimSpace(*in.Note) != "" {
		note = strings.TrimSpace(*in.Note)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO ingredient_revisions (ingredient_id, version, snapshot, editor_id, note)
		SELECT $1, $2, (`+snapshotSQL+`), $3, $4`, id, next, editorID, note); err != nil {
		return 0, fmt.Errorf("写入修订 %d: %w", next, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("提交事务: %w", err)
	}
	return next, nil
}

func blankToNil(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

// normalizeAliases 去空白、去重（大小写不敏感），保留首次出现的写法。
func normalizeAliases(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, a := range in {
		a = strings.TrimSpace(a)
		key := strings.ToLower(a)
		if a == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, a)
	}
	return out
}

// aliasLang 含汉字即中文别名，否则视为英文 —— 编辑不必为每个别名选语言。
func aliasLang(alias string) string {
	for _, r := range alias {
		if unicode.Is(unicode.Han, r) {
			return "zh"
		}
	}
	return "en"
}

// IngredientRevision 原料词条的一个版本。
type IngredientRevision struct {
	Version      int
	Note         *string
	EditorID     *uuid.UUID
	EditorHandle *string
	EditorName   *string
	Snapshot     []byte
	CreatedAt    time.Time
}

const ingredientRevisionCols = `v.version, v.note, v.editor_id, u.handle, u.display_name, v.snapshot, v.created_at`

func scanIngredientRevision(row pgx.Row) (*IngredientRevision, error) {
	r := &IngredientRevision{}
	if err := row.Scan(&r.Version, &r.Note, &r.EditorID, &r.EditorHandle, &r.EditorName, &r.Snapshot, &r.CreatedAt); err != nil {
		return nil, err
	}
	return r, nil
}

// IngredientRevisions 词条的全部版本（新→旧，含快照：词条小，历史页直接逐版对比）。
func (s *Store) IngredientRevisions(ctx context.Context, id string) ([]IngredientRevision, error) {
	var ok bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ingredients WHERE id = $1 AND is_official)`, id).Scan(&ok); err != nil {
		return nil, fmt.Errorf("查询原料: %w", err)
	}
	if !ok {
		return nil, ErrNotFound
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+ingredientRevisionCols+`
		FROM ingredient_revisions v LEFT JOIN users u ON u.id = v.editor_id
		WHERE v.ingredient_id = $1 ORDER BY v.version DESC`, id)
	if err != nil {
		return nil, fmt.Errorf("查询词条修订: %w", err)
	}
	defer rows.Close()
	var out []IngredientRevision
	for rows.Next() {
		r, err := scanIngredientRevision(rows)
		if err != nil {
			return nil, fmt.Errorf("扫描词条修订: %w", err)
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// IngredientRevisionAt 取某一版。
func (s *Store) IngredientRevisionAt(ctx context.Context, id string, version int) (*IngredientRevision, error) {
	r, err := scanIngredientRevision(s.pool.QueryRow(ctx, `
		SELECT `+ingredientRevisionCols+`
		FROM ingredient_revisions v LEFT JOIN users u ON u.id = v.editor_id
		WHERE v.ingredient_id = $1 AND v.version = $2`, id, version))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("查询词条修订 %d: %w", version, err)
	}
	return r, nil
}

/* ────────────────────────── 修订动态 ────────────────────────── */

// Change 最近修订里的一条。经典配方以 classic_key 定位，原料以 id 定位。
type Change struct {
	Kind         string // recipe / ingredient
	TargetID     string // 配方 UUID 或原料 slug
	TargetKey    string // classic_key 或原料 slug（前端路由用）
	Title        string
	Version      int
	Note         *string
	EditorHandle *string
	EditorName   *string
	CreatedAt    time.Time
}

// RecentChanges 全站最近的百科修订（经典配方 + 原料词条，新→旧）。
// 经典配方只算带元数据快照的版本：种子导入写的版本没有快照，那不是人改的。
func (s *Store) RecentChanges(ctx context.Context, limit int) ([]Change, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT * FROM (
			SELECT 'recipe' AS kind, r.id::text, coalesce(r.classic_key, r.id::text), v.title, v.version, v.note,
				u.handle, u.display_name, v.created_at
			FROM recipe_revisions v
			JOIN recipes r ON r.id = v.recipe_id
			LEFT JOIN users u ON u.id = v.editor_id
			WHERE r.is_canonical AND v.meta IS NOT NULL AND r.deleted_at IS NULL
			UNION ALL
			SELECT 'ingredient', i.id, i.id, i.name_zh, v.version, v.note,
				u.handle, u.display_name, v.created_at
			FROM ingredient_revisions v
			JOIN ingredients i ON i.id = v.ingredient_id
			LEFT JOIN users u ON u.id = v.editor_id
			WHERE v.version > 0
		) c ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("查询修订动态: %w", err)
	}
	defer rows.Close()
	var out []Change
	for rows.Next() {
		var c Change
		if err := rows.Scan(&c.Kind, &c.TargetID, &c.TargetKey, &c.Title, &c.Version, &c.Note,
			&c.EditorHandle, &c.EditorName, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("扫描修订动态: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
