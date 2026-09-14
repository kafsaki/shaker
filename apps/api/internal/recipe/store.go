// Package recipe 配方核心（API 定义 §2.3/§3）。
//
// 发布事务是这个包的心脏：完整校验 → 派生值 → 原料投影 → slug → 状态，
// 全部在单个事务里，行级锁（FOR UPDATE）保证与 PATCH/DELETE 的并发安全。
// 草稿宽松（schema 过即可，业务 error 降级为 warn 由 handler 处理）；
// 已发布配方的 PATCH 与发布一样跑完整校验 —— 已发布语料是搜索与聚合的地基，不能带病进库。
package recipe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/irv"
	"github.com/kafsaki/shaker/apps/api/internal/notify"
)

// DBTX pool 与事务共用的最小接口（pgxpool.Pool、pgx.Tx 均满足）。
// 导出给 interact 等包，在同一事务里复用热度刷新。
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// querier 内部继续用的历史名。
type querier = DBTX

// Store 配方数据访问。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

/* ────────────────────────── 模型 ────────────────────────── */

type AuthorBrief struct {
	ID          string
	Handle      string
	DisplayName string
	AvatarURL   *string
	IsOfficial  bool
}

type TasteProfile struct {
	Sweet    int `json:"sweet"`
	Sour     int `json:"sour"`
	Bitter   int `json:"bitter"`
	Strength int `json:"strength"`
}

type Recipe struct {
	ID            uuid.UUID
	AuthorID      *uuid.UUID
	Author        *AuthorBrief // 作者删号后为 nil
	Slug          string
	Title         string
	Subtitle      *string
	DescriptionMd *string
	Lang          string
	IR            []byte // 原始 JSONB，未做任何改写（惰性迁移的前提）
	IRVersion     int
	GlassID       string
	Method        string
	Family        *string
	Source        string
	IsCanonical   bool
	ClassicKey    *string
	DerivedFrom   *uuid.UUID
	DerivedCount  int
	IbaCategory   *string
	CoverURL      *string
	Status        string
	AbvEst        *float64
	TotalVolumeMl *float64
	TasteProfile  *TasteProfile
	Difficulty    *int
	LikeCount     int
	CommentCount  int
	CollectCount  int
	ViewCount     int
	HotScore      float32
	CreatedAt     time.Time
	UpdatedAt     time.Time
	PublishedAt   *time.Time
	DeletedAt     *time.Time
	Tags          []string
	Sim           float32 // 搜索相关度（similarity）；仅搜索查询填充，其余为 0
}

// CreateInput POST /recipes 的落库载荷。ir 已通过 schema 校验。
type CreateInput struct {
	Title         string
	Subtitle      *string
	DescriptionMd *string
	Lang          string
	Family        *string
	ClassicKey    *string
	DerivedFrom   *uuid.UUID
	TasteProfile  *TasteProfile
	Difficulty    *int
	Tags          []string
	IR            *irv.IR
	IRRaw         []byte
	Vocab         *irv.Vocab // 派生值计算用
}

// UpdateInput PATCH /recipes。指针为 nil 表示不改；Tags/IRRaw 为 nil 表示保持原值。
type UpdateInput struct {
	Title         *string
	Subtitle      *string
	DescriptionMd *string
	Lang          *string
	Family        *string
	ClassicKey    *string
	DerivedFrom   *uuid.UUID
	TasteProfile  *TasteProfile
	Difficulty    *int
	CoverURL      *string
	Tags          []string
	IR            *irv.IR // IRRaw 非 nil 时必填
	IRRaw         []byte
	IfMatch       int // 乐观锁：必须等于当前 ir_version
	EditorID      uuid.UUID
	Vocab         *irv.Vocab
}

type Revision struct {
	Version   int
	Title     string
	Note      *string
	EditorID  *uuid.UUID
	CreatedAt time.Time
}

// recipeCols 详情/锁行共用的列。author 由调用方决定是否 join。
const recipeCols = `r.id, r.author_id, r.slug, r.title, r.subtitle, r.description_md, r.lang,
	r.ir, r.ir_version, r.glass_id, r.method, r.family, r.source, r.is_canonical, r.classic_key,
	r.derived_from, r.derived_count, r.iba_category, r.cover_url, r.status,
	r.abv_est, r.total_volume_ml, r.taste_profile, r.difficulty,
	r.like_count, r.comment_count, r.collect_count, r.view_count, r.hot_score,
	r.created_at, r.updated_at, r.published_at, r.deleted_at`

const authorCols = `, u.id, u.handle, u.display_name, u.avatar_url, u.is_official`

func scanRecipe(row pgx.Row) (*Recipe, error) {
	r := &Recipe{}
	var taste []byte
	err := row.Scan(&r.ID, &r.AuthorID, &r.Slug, &r.Title, &r.Subtitle, &r.DescriptionMd, &r.Lang,
		&r.IR, &r.IRVersion, &r.GlassID, &r.Method, &r.Family, &r.Source, &r.IsCanonical, &r.ClassicKey,
		&r.DerivedFrom, &r.DerivedCount, &r.IbaCategory, &r.CoverURL, &r.Status,
		&r.AbvEst, &r.TotalVolumeMl, &taste, &r.Difficulty,
		&r.LikeCount, &r.CommentCount, &r.CollectCount, &r.ViewCount, &r.HotScore,
		&r.CreatedAt, &r.UpdatedAt, &r.PublishedAt, &r.DeletedAt)
	return scanRecipeErr(err, r, taste)
}

func scanRecipeWithAuthor(row pgx.Row) (*Recipe, error) {
	r := &Recipe{}
	var authorID, authorHandle, authorName, authorAvatar *string
	var authorOfficial *bool
	var taste []byte
	err := row.Scan(&r.ID, &r.AuthorID, &r.Slug, &r.Title, &r.Subtitle, &r.DescriptionMd, &r.Lang,
		&r.IR, &r.IRVersion, &r.GlassID, &r.Method, &r.Family, &r.Source, &r.IsCanonical, &r.ClassicKey,
		&r.DerivedFrom, &r.DerivedCount, &r.IbaCategory, &r.CoverURL, &r.Status,
		&r.AbvEst, &r.TotalVolumeMl, &taste, &r.Difficulty,
		&r.LikeCount, &r.CommentCount, &r.CollectCount, &r.ViewCount, &r.HotScore,
		&r.CreatedAt, &r.UpdatedAt, &r.PublishedAt, &r.DeletedAt,
		&authorID, &authorHandle, &authorName, &authorAvatar, &authorOfficial)
	if err == nil && authorID != nil {
		r.Author = &AuthorBrief{
			ID: *authorID, Handle: *authorHandle, DisplayName: *authorName,
			AvatarURL: authorAvatar, IsOfficial: *authorOfficial,
		}
	}
	return scanRecipeErr(err, r, taste)
}

// scanRecipeErr 公共收尾：错误翻译 + taste_profile 反序列化。
func scanRecipeErr(err error, r *Recipe, taste []byte) (*Recipe, error) {
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if taste != nil {
		tp := &TasteProfile{}
		if err := json.Unmarshal(taste, tp); err == nil {
			r.TasteProfile = tp
		}
	}
	return r, nil
}

// loadTags 填充 r.Tags（id 升序，稳定输出）。
func (s *Store) loadTags(ctx context.Context, r *Recipe) error {
	rows, err := s.pool.Query(ctx, `SELECT tag_id FROM recipe_tags WHERE recipe_id = $1 ORDER BY tag_id`, r.ID)
	if err != nil {
		return fmt.Errorf("查询配方标签: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return fmt.Errorf("扫描配方标签: %w", err)
		}
		r.Tags = append(r.Tags, t)
	}
	return rows.Err()
}

// Get 按 UUID 取（不含已软删）。可见性由 handler 裁决。
func (s *Store) Get(ctx context.Context, id uuid.UUID) (*Recipe, error) {
	r, err := scanRecipeWithAuthor(s.pool.QueryRow(ctx, `
		SELECT `+recipeCols+authorCols+`
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE r.id = $1 AND r.deleted_at IS NULL`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询配方 %s: %w", id, err)
	}
	if err := s.loadTags(ctx, r); err != nil {
		return nil, err
	}
	return r, nil
}

// GetBySlug 按 slug 取已发布配方（公开页面，SEO 用）。
func (s *Store) GetBySlug(ctx context.Context, slug string) (*Recipe, error) {
	r, err := scanRecipeWithAuthor(s.pool.QueryRow(ctx, `
		SELECT `+recipeCols+authorCols+`
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE r.slug = $1 AND r.status = 'published' AND r.deleted_at IS NULL`, slug))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询配方 slug=%s: %w", slug, err)
	}
	if err := s.loadTags(ctx, r); err != nil {
		return nil, err
	}
	return r, nil
}

/* ────────────────────────── 创建草稿 ────────────────────────── */

func (s *Store) Create(ctx context.Context, authorID uuid.UUID, in CreateInput) (*Recipe, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("生成 UUIDv7: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // 提交后是 no-op

	if err := checkReferences(ctx, tx, in.IR.Glass, in.Tags, in.DerivedFrom, in.ClassicKey); err != nil {
		return nil, err
	}

	abv, total := derivedValues(irv.ComputeDerived(in.IR, in.Vocab))
	var taste any
	if in.TasteProfile != nil {
		if taste, err = json.Marshal(in.TasteProfile); err != nil {
			return nil, fmt.Errorf("序列化口味: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO recipes (id, author_id, slug, title, subtitle, description_md, lang,
			ir, ir_version, glass_id, method, family, classic_key, derived_from,
			taste_profile, difficulty, abv_est, total_volume_ml, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7,
			$8, 1, $9, $10, $11, $12, $13,
			$14, $15, $16, $17, 'draft')`,
		id, authorID, draftSlug(id.String()), in.Title, in.Subtitle, in.DescriptionMd, in.Lang,
		in.IRRaw, in.IR.Glass, in.IR.Method, in.Family, in.ClassicKey, in.DerivedFrom,
		taste, in.Difficulty, abv, total); err != nil {
		return nil, fmt.Errorf("创建草稿: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO recipe_revisions (recipe_id, version, ir, ir_version, title, editor_id, note)
		VALUES ($1, 1, $2, 1, $3, $4, '创建草稿')`,
		id, in.IRRaw, in.Title, authorID); err != nil {
		return nil, fmt.Errorf("写入初始版本: %w", err)
	}

	for _, tag := range in.Tags {
		if _, err := tx.Exec(ctx, `INSERT INTO recipe_tags (recipe_id, tag_id) VALUES ($1, $2)`, id, tag); err != nil {
			return nil, fmt.Errorf("写入配方标签 %s: %w", tag, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return s.Get(ctx, id)
}

/* ────────────────────────── 更新（乐观锁） ────────────────────────── */

func (s *Store) Update(ctx context.Context, id, authorID uuid.UUID, in UpdateInput) (*Recipe, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	r, err := lockRecipe(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if r.AuthorID == nil || *r.AuthorID != authorID {
		return nil, ErrForbidden
	}
	if r.IRVersion != in.IfMatch {
		return nil, &VersionConflict{Current: r.IRVersion}
	}

	/* ── IR 变更：已发布跑完整校验，草稿只拦外键（glass）── */
	if in.IRRaw != nil {
		if err := checkReferences(ctx, tx, in.IR.Glass, nil, nil, nil); err != nil {
			return nil, err
		}
		if r.Status == "published" {
			if _, res := irv.Check(in.IRRaw, in.Vocab); !res.OK {
				return nil, &ValidationError{Details: res.Errors}
			}
		}
	}

	/* ── 元数据引用检查 ── */
	if in.Tags != nil {
		if err := checkReferences(ctx, tx, "", in.Tags, nil, nil); err != nil {
			return nil, err
		}
	}
	if in.DerivedFrom != nil || in.ClassicKey != nil {
		if err := checkReferences(ctx, tx, "", nil, in.DerivedFrom, in.ClassicKey); err != nil {
			return nil, err
		}
	}

	/* ── 拼装 UPDATE ── */
	sets := []string{}
	args := []any{}
	add := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if in.Title != nil {
		add("title", *in.Title)
	}
	if in.Subtitle != nil {
		add("subtitle", *in.Subtitle)
	}
	if in.DescriptionMd != nil {
		add("description_md", *in.DescriptionMd)
	}
	if in.Lang != nil {
		add("lang", *in.Lang)
	}
	if in.Family != nil {
		add("family", *in.Family)
	}
	if in.ClassicKey != nil {
		add("classic_key", *in.ClassicKey)
	}
	if in.DerivedFrom != nil {
		add("derived_from", *in.DerivedFrom)
	}
	if in.CoverURL != nil {
		add("cover_url", *in.CoverURL)
	}
	if in.Difficulty != nil {
		add("difficulty", *in.Difficulty)
	}
	if in.TasteProfile != nil {
		taste, err := json.Marshal(in.TasteProfile)
		if err != nil {
			return nil, fmt.Errorf("序列化口味: %w", err)
		}
		add("taste_profile", taste)
	}
	if in.IRRaw != nil {
		abv, total := derivedValues(irv.ComputeDerived(in.IR, in.Vocab))
		n := len(args) + 1 // 追加的 5 个参数占据 $n..$(n+4)
		args = append(args, in.IRRaw, in.IR.Glass, in.IR.Method, abv, total)
		sets = append(sets, fmt.Sprintf(
			"ir = $%d, ir_version = ir_version + 1, glass_id = $%d, method = $%d, abv_est = $%d, total_volume_ml = $%d",
			n, n+1, n+2, n+3, n+4))
	}

	if len(sets) > 0 {
		args = append(args, id)
		if _, err := tx.Exec(ctx,
			`UPDATE recipes SET `+strings.Join(sets, ", ")+fmt.Sprintf(` WHERE id = $%d`, len(args)), args...); err != nil {
			return nil, fmt.Errorf("更新配方: %w", err)
		}
	}

	/* ── 版本历史与投影 ── */
	if in.IRRaw != nil {
		newVersion := r.IRVersion + 1
		title := r.Title
		if in.Title != nil {
			title = *in.Title
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO recipe_revisions (recipe_id, version, ir, ir_version, title, editor_id, note)
			VALUES ($1, $2, $3, $2, $4, $5, $6)`,
			id, newVersion, in.IRRaw, title, in.EditorID, revisionNote(r.Status)); err != nil {
			return nil, fmt.Errorf("写入版本 %d: %w", newVersion, err)
		}
		if r.Status == "published" {
			oldIDs, err := projectedIngredientIDs(ctx, tx, id)
			if err != nil {
				return nil, err
			}
			if err := projectIngredients(ctx, tx, id, in.IR); err != nil {
				return nil, err
			}
			if err := refreshIngredientCounts(ctx, tx, unionIDs(oldIDs, ingredientIDs(in.IR))); err != nil {
				return nil, err
			}
		}
	}

	if in.Tags != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM recipe_tags WHERE recipe_id = $1`, id); err != nil {
			return nil, fmt.Errorf("清空配方标签: %w", err)
		}
		for _, tag := range in.Tags {
			if _, err := tx.Exec(ctx, `INSERT INTO recipe_tags (recipe_id, tag_id) VALUES ($1, $2)`, id, tag); err != nil {
				return nil, fmt.Errorf("写入配方标签 %s: %w", tag, err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return s.Get(ctx, id)
}

func revisionNote(status string) string {
	if status == "published" {
		return "编辑已发布配方"
	}
	return "保存草稿"
}

/* ────────────────────────── 发布事务（API 定义 §3） ────────────────────────── */

func (s *Store) Publish(ctx context.Context, id, authorID uuid.UUID, vocab *irv.Vocab) (*Recipe, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	r, err := lockRecipe(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if r.AuthorID == nil || *r.AuthorID != authorID {
		return nil, ErrForbidden
	}
	if r.Status == "published" {
		return s.Get(ctx, id) // 幂等：重复发布返回当前状态
	}
	if r.Status != "draft" {
		return nil, ErrNotPublishable
	}

	// 1. 完整校验（JSON Schema + 全部业务规则）
	ir, res := irv.Check(r.IR, vocab)
	if !res.OK {
		return nil, &ValidationError{Details: res.Errors}
	}

	// 2-4. 派生值 + 原料投影（DELETE + INSERT）
	abv, total := derivedValues(irv.ComputeDerived(ir, vocab))
	oldIDs, err := projectedIngredientIDs(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err := projectIngredients(ctx, tx, id, ir); err != nil {
		return nil, err
	}

	// 5. slug：占位值换成标题派生的正式 slug（已分配过则保持，URL 稳定）
	slug := r.Slug
	if slug == draftSlug(r.ID.String()) {
		if slug, err = allocateSlug(ctx, tx, r.Title, r.ID); err != nil {
			return nil, err
		}
	}

	// 6-7. 状态、发布时间与投影列
	if _, err := tx.Exec(ctx, `
		UPDATE recipes SET status = 'published', published_at = now(),
			slug = $2, glass_id = $3, method = $4, abv_est = $5, total_volume_ml = $6
		WHERE id = $1`,
		id, slug, ir.Glass, ir.Method, abv, total); err != nil {
		return nil, fmt.Errorf("发布配方: %w", err)
	}

	// 8. 计数维护（v1 内联执行，多实例后由 river 异步化）
	if _, err := tx.Exec(ctx, `UPDATE users SET recipe_count = recipe_count + 1 WHERE id = $1`, authorID); err != nil {
		return nil, fmt.Errorf("更新作者配方数: %w", err)
	}
	if err := refreshIngredientCounts(ctx, tx, unionIDs(oldIDs, ingredientIDs(ir))); err != nil {
		return nil, err
	}
	if r.DerivedFrom != nil {
		if _, err := tx.Exec(ctx, `UPDATE recipes SET derived_count = derived_count + 1 WHERE id = $1`, *r.DerivedFrom); err != nil {
			return nil, fmt.Errorf("更新血缘改编数: %w", err)
		}
	}

	// 初始热度（v1 内联；见 TouchHot 注释）
	if err := TouchHot(ctx, tx, id); err != nil {
		return nil, err
	}

	// 9. 给关注者发发布动态（v1 内联扇出，上量后由 river 异步化）
	if err := notify.FanoutToFollowers(ctx, tx, authorID, "recipe", id,
		map[string]any{"kind": "publish", "title": r.Title}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return s.Get(ctx, id)
}

// Unpublish 撤回为草稿。幂等：未发布状态直接返回。
func (s *Store) Unpublish(ctx context.Context, id, authorID uuid.UUID) (*Recipe, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	r, err := lockRecipe(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if r.AuthorID == nil || *r.AuthorID != authorID {
		return nil, ErrForbidden
	}
	if r.Status != "published" {
		return s.Get(ctx, id)
	}

	if _, err := tx.Exec(ctx, `UPDATE recipes SET status = 'draft', published_at = NULL WHERE id = $1`, id); err != nil {
		return nil, fmt.Errorf("撤回配方: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET recipe_count = recipe_count - 1 WHERE id = $1`, authorID); err != nil {
		return nil, fmt.Errorf("回退作者配方数: %w", err)
	}
	ids, err := projectedIngredientIDs(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err := refreshIngredientCounts(ctx, tx, ids); err != nil {
		return nil, err
	}
	if r.DerivedFrom != nil {
		if _, err := tx.Exec(ctx, `UPDATE recipes SET derived_count = derived_count - 1 WHERE id = $1`, *r.DerivedFrom); err != nil {
			return nil, fmt.Errorf("回退血缘改编数: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return s.Get(ctx, id)
}

// Delete 软删除。幂等。
func (s *Store) Delete(ctx context.Context, id, authorID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	r, err := lockRecipe(ctx, tx, id)
	if err != nil {
		return err
	}
	if r.AuthorID == nil || *r.AuthorID != authorID {
		return ErrForbidden
	}

	if _, err := tx.Exec(ctx, `UPDATE recipes SET status = 'removed', deleted_at = now() WHERE id = $1`, id); err != nil {
		return fmt.Errorf("删除配方: %w", err)
	}
	if r.Status == "published" {
		if _, err := tx.Exec(ctx, `UPDATE users SET recipe_count = recipe_count - 1 WHERE id = $1`, authorID); err != nil {
			return fmt.Errorf("回退作者配方数: %w", err)
		}
		ids, err := projectedIngredientIDs(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := refreshIngredientCounts(ctx, tx, ids); err != nil {
			return err
		}
		if r.DerivedFrom != nil {
			if _, err := tx.Exec(ctx, `UPDATE recipes SET derived_count = derived_count - 1 WHERE id = $1`, *r.DerivedFrom); err != nil {
				return fmt.Errorf("回退血缘改编数: %w", err)
			}
		}
	}

	return tx.Commit(ctx)
}

/* ────────────────────────── 版本历史 ────────────────────────── */

func (s *Store) Revisions(ctx context.Context, id uuid.UUID) ([]Revision, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT version, title, note, editor_id, created_at
		FROM recipe_revisions WHERE recipe_id = $1 ORDER BY version DESC`, id)
	if err != nil {
		return nil, fmt.Errorf("查询版本历史: %w", err)
	}
	defer rows.Close()
	var out []Revision
	for rows.Next() {
		var rev Revision
		if err := rows.Scan(&rev.Version, &rev.Title, &rev.Note, &rev.EditorID, &rev.CreatedAt); err != nil {
			return nil, fmt.Errorf("扫描版本历史: %w", err)
		}
		out = append(out, rev)
	}
	return out, rows.Err()
}

// Revision 取某个历史版本的 IR。
func (s *Store) Revision(ctx context.Context, id uuid.UUID, version int) (*Revision, []byte, error) {
	rev := &Revision{}
	var ir []byte
	err := s.pool.QueryRow(ctx, `
		SELECT version, title, note, editor_id, created_at, ir
		FROM recipe_revisions WHERE recipe_id = $1 AND version = $2`, id, version).
		Scan(&rev.Version, &rev.Title, &rev.Note, &rev.EditorID, &rev.CreatedAt, &ir)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, fmt.Errorf("查询版本 %d: %w", version, err)
	}
	return rev, ir, nil
}

/* ────────────────────────── 读取辅助 ────────────────────────── */

// ViewerState 认证用户的互动状态（API 定义 §2.3：免去逐张卡片反查「我点赞了吗」）。
type ViewerState struct {
	Liked            bool
	CollectedInMenus []string
}

func (s *Store) ViewerState(ctx context.Context, userID, recipeID uuid.UUID) (*ViewerState, error) {
	vs := &ViewerState{}
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM likes WHERE user_id = $1 AND recipe_id = $2)`, userID, recipeID).
		Scan(&vs.Liked); err != nil {
		return nil, fmt.Errorf("查询点赞状态: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT m.id FROM menus m
		JOIN menu_items mi ON mi.menu_id = m.id
		WHERE m.owner_id = $1 AND mi.recipe_id = $2 AND m.deleted_at IS NULL`, userID, recipeID)
	if err != nil {
		return nil, fmt.Errorf("查询收藏酒单: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var menuID string
		if err := rows.Scan(&menuID); err != nil {
			return nil, fmt.Errorf("扫描收藏酒单: %w", err)
		}
		vs.CollectedInMenus = append(vs.CollectedInMenus, menuID)
	}
	return vs, rows.Err()
}

// VizData expand=viz 的载荷：IR 引用到的原料/杯型完整视觉数据。
type VizData struct {
	Ingredients map[string]VizIngredient
	Glassware   map[string]VizGlass
}

type VizIngredient struct {
	NameZh string
	NameEn string
	Viz    []byte
}

type VizGlass struct {
	NameZh     string
	NameEn     string
	CapacityMl int
	Shape      []byte
}

// VizFor 收集 ir 引用到的视觉数据（首屏免 /vocab 往返）。
// 引用了已下架的原料/杯型时静默跳过 —— 渲染器对未知 ID 自有降级策略（规范 §11）。
func (s *Store) VizFor(ctx context.Context, ir *irv.IR) (*VizData, error) {
	out := &VizData{
		Ingredients: make(map[string]VizIngredient),
		Glassware:   make(map[string]VizGlass),
	}

	if ids := ingredientIDs(ir); len(ids) > 0 {
		rows, err := s.pool.Query(ctx, `
			SELECT id, name_zh, name_en, viz FROM ingredients WHERE id = ANY($1)`, ids)
		if err != nil {
			return nil, fmt.Errorf("查询原料视觉数据: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			v := VizIngredient{}
			if err := rows.Scan(&id, &v.NameZh, &v.NameEn, &v.Viz); err != nil {
				return nil, fmt.Errorf("扫描原料视觉数据: %w", err)
			}
			out.Ingredients[id] = v
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("遍历原料视觉数据: %w", err)
		}
	}

	g := VizGlass{}
	err := s.pool.QueryRow(ctx, `
		SELECT name_zh, name_en, capacity_ml, shape FROM glassware WHERE id = $1`, ir.Glass).
		Scan(&g.NameZh, &g.NameEn, &g.CapacityMl, &g.Shape)
	if err == nil {
		out.Glassware[ir.Glass] = g
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("查询杯型视觉数据: %w", err)
	}
	return out, nil
}

// IncrementView 浏览计数（已发布配方的详情读取）。
func (s *Store) IncrementView(ctx context.Context, id uuid.UUID) {
	if _, err := s.pool.Exec(ctx, `
		UPDATE recipes SET view_count = view_count + 1
		WHERE id = $1 AND status = 'published' AND deleted_at IS NULL`, id); err != nil {
		slog.Warn("浏览计数失败", "recipe", id, "err", err)
	}
}

/* ────────────────────────── 内部辅助 ────────────────────────── */

// lockRecipe 事务内锁行。recipes 触发器会维护 updated_at。
func lockRecipe(ctx context.Context, q querier, id uuid.UUID) (*Recipe, error) {
	r, err := scanRecipe(q.QueryRow(ctx, `
		SELECT `+recipeCols+` FROM recipes r
		WHERE r.id = $1 AND r.deleted_at IS NULL FOR UPDATE`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("锁定配方 %s: %w", id, err)
	}
	return r, nil
}

// checkReferences 保存前拦截会触外键/约束失败的引用。
func checkReferences(ctx context.Context, q querier, glass string, tags []string, derivedFrom *uuid.UUID, classicKey *string) error {
	if glass != "" {
		var exists bool
		if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM glassware WHERE id = $1)`, glass).Scan(&exists); err != nil {
			return fmt.Errorf("查询杯型 %s: %w", glass, err)
		}
		if !exists {
			return fmt.Errorf("%w: %s", ErrUnknownGlass, glass)
		}
	}
	if len(tags) > 0 {
		var n int
		if err := q.QueryRow(ctx, `SELECT count(*) FROM tags WHERE id = ANY($1)`, tags).Scan(&n); err != nil {
			return fmt.Errorf("查询标签: %w", err)
		}
		if n != len(unique(tags)) {
			return fmt.Errorf("%w: %v", ErrUnknownTag, tags)
		}
	}
	if derivedFrom != nil {
		var exists bool
		if err := q.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM recipes WHERE id = $1 AND deleted_at IS NULL)`, *derivedFrom).Scan(&exists); err != nil {
			return fmt.Errorf("查询血缘配方: %w", err)
		}
		if !exists {
			return fmt.Errorf("%w: %s", ErrUnknownDerived, derivedFrom)
		}
	}
	if classicKey != nil {
		var exists bool
		if err := q.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM recipes WHERE classic_key = $1 AND is_canonical)`, *classicKey).Scan(&exists); err != nil {
			return fmt.Errorf("查询经典锚点: %w", err)
		}
		if !exists {
			return fmt.Errorf("%w: %s", ErrUnknownClassicKey, *classicKey)
		}
	}
	return nil
}

// projectIngredients 从 ir 重建原料投影（数据库设计：保存时 DELETE + INSERT）。
func projectIngredients(ctx context.Context, q querier, recipeID uuid.UUID, ir *irv.IR) error {
	if _, err := q.Exec(ctx, `DELETE FROM recipe_ingredients WHERE recipe_id = $1`, recipeID); err != nil {
		return fmt.Errorf("清空原料投影: %w", err)
	}
	for pos, ref := range ir.Ingredients {
		var amountMl any
		if ml, ok := irv.RefToMl(ref); ok {
			amountMl = math.Round(ml*100) / 100 // numeric(8,2)
		}
		if _, err := q.Exec(ctx, `
			INSERT INTO recipe_ingredients (recipe_id, slot, ingredient_id, amount, unit, amount_ml, role, position)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			recipeID, ref.Slot, ref.IngredientID, ref.Amount, ref.Unit, amountMl, ref.Role, pos); err != nil {
			return fmt.Errorf("写入原料投影 %s: %w", ref.Slot, err)
		}
	}
	return nil
}

// projectedIngredientIDs 当前投影里的原料 ID 集合。
func projectedIngredientIDs(ctx context.Context, q querier, recipeID uuid.UUID) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT ingredient_id FROM recipe_ingredients WHERE recipe_id = $1`, recipeID)
	if err != nil {
		return nil, fmt.Errorf("查询原料投影: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("扫描原料投影: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// refreshIngredientCounts 重算受影响原料的「被多少配方使用」计数（只数已发布）。
func refreshIngredientCounts(ctx context.Context, q querier, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if _, err := q.Exec(ctx, `
		UPDATE ingredients SET recipe_count = (
			SELECT count(DISTINCT r.id) FROM recipe_ingredients ri
			JOIN recipes r ON r.id = ri.recipe_id
			WHERE ri.ingredient_id = ingredients.id AND r.status = 'published' AND r.deleted_at IS NULL
		) WHERE id = ANY($1)`, ids); err != nil {
		return fmt.Errorf("重算原料配方数: %w", err)
	}
	return nil
}

// ingredientIDs ir 引用到的原料 ID（ingredients 数组；garnish 不进投影表）。
func ingredientIDs(ir *irv.IR) []string {
	ids := make([]string, 0, len(ir.Ingredients))
	for _, ref := range ir.Ingredients {
		ids = append(ids, ref.IngredientID)
	}
	return unique(ids)
}

func unique(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := in[:0]
	for _, v := range in {
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func unionIDs(a, b []string) []string {
	return unique(append(append([]string{}, a...), b...))
}

// derivedValues numeric(4,1)/(6,1) 的四舍五入；不可估算时为 nil。
func derivedValues(d irv.Derived) (abv, total any) {
	if d.AbvEst != nil {
		abv = math.Round(*d.AbvEst*10) / 10
	}
	if d.TotalVolumeMl != nil {
		total = math.Round(*d.TotalVolumeMl*10) / 10
	}
	return
}

// TouchHot 重算单条配方的时间衰减热度（DB 设计 §5 公式）：
//
//	hot = (like_count + 2·collect_count + 0.5·comment_count + 1) / (age_hours + 2)^1.6
//
// 正式设计里由 river worker 周期重算（ADR-006）；v1 单实例在互动与发布的
// 同一事务内联刷新——新鲜度足够，多实例后换成异步任务。
func TouchHot(ctx context.Context, q DBTX, id uuid.UUID) error {
	if _, err := q.Exec(ctx, `
		UPDATE recipes SET hot_score = (
			like_count + 2 * collect_count + 0.5 * comment_count + 1
		) / power(extract(epoch FROM (now() - published_at)) / 3600 + 2, 1.6)
		WHERE id = $1 AND published_at IS NOT NULL`, id); err != nil {
		return fmt.Errorf("重算热度 %s: %w", id, err)
	}
	return nil
}
