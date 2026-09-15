// Package menu 酒单（API 定义 §2.9）：收藏夹语义的配方清单。
//
// position 用 numeric(20,10) 中点插值（DB 设计 §9.1）：拖拽重排取两项中点，
// 不重写整列表。精度约 30 次同点插入后耗尽，由对账任务重整（v1 不做）。
// shareToken 是 unlisted 酒单的分享凭证：32 字节随机数 base64url，不可猜。
package menu

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/base58"
	"github.com/kafsaki/shaker/apps/api/internal/cursor"
)

var (
	ErrNotFound    = errors.New("酒单不存在")
	ErrForbidden   = errors.New("只能操作自己的酒单")
	ErrRecipeGone  = errors.New("配方不存在")
	ErrNotInMenu   = errors.New("配方不在酒单里")
	ErrBadCursor   = errors.New("分页游标无效")
	ErrBadReorder  = errors.New("锚点配方不在酒单里")
)

// Menu 酒单本体。
type Menu struct {
	ID          uuid.UUID
	OwnerID     uuid.UUID
	Title       string
	Description *string
	CoverURL    *string
	Visibility  string // private | unlisted | public
	ShareToken  *string
	ItemCount   int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// RecipeCard 酒单条目里的配方卡片（比 Feed 卡片更瘦：列表场景够用即可）。
// Deleted：配方已被作者软删——条目保留（历史/笔记），前端置灰不可点。
type RecipeCard struct {
	ID          uuid.UUID
	ShortNo     int64 // 对外短号（base58 编码后即 /r/{code}）
	Title       string
	ClassicKey  *string
	IsCanonical bool
	CoverURL    *string
	LikeCount   int
	CommentCount int
	Deleted     bool
}

// Code 对外短号。
func (c RecipeCard) Code() string { return base58.Encode(c.ShortNo) }

// Item 酒单条目。
type Item struct {
	Recipe  RecipeCard
	Note    *string
	AddedAt time.Time
}

// Store 酒单数据访问。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

const menuCols = `id, owner_id, title, description, cover_url, visibility, share_token, item_count, created_at, updated_at`

func scanMenu(row pgx.Row) (*Menu, error) {
	m := &Menu{}
	if err := row.Scan(&m.ID, &m.OwnerID, &m.Title, &m.Description, &m.CoverURL,
		&m.Visibility, &m.ShareToken, &m.ItemCount, &m.CreatedAt, &m.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return m, nil
}

/* ────────────────────────── CRUD ────────────────────────── */

// Create 建酒单。
func (s *Store) Create(ctx context.Context, ownerID uuid.UUID, title string, description *string, visibility string) (*Menu, error) {
	return scanMenu(s.pool.QueryRow(ctx, `
		INSERT INTO menus (id, owner_id, title, description, visibility)
		VALUES ($1, $2, $3, $4, $5) RETURNING `+menuCols,
		uuid.Must(uuid.NewV7()), ownerID, title, description, visibility))
}

// Get 按 ID 取（不校验可见性——那是 handler 的事：private/unlisted 仅主人，
// public 对所有人；unlisted 的分享访问走 GetByShareToken）。
func (s *Store) Get(ctx context.Context, id uuid.UUID) (*Menu, error) {
	m, err := scanMenu(s.pool.QueryRow(ctx, `
		SELECT `+menuCols+` FROM menus WHERE id = $1 AND deleted_at IS NULL`, id))
	if err != nil {
		return nil, fmt.Errorf("查询酒单: %w", err)
	}
	return m, nil
}

// GetByShareToken 通过分享链接取 unlisted 酒单。token 对不上 → 不存在。
func (s *Store) GetByShareToken(ctx context.Context, token string) (*Menu, error) {
	m, err := scanMenu(s.pool.QueryRow(ctx, `
		SELECT `+menuCols+` FROM menus
		WHERE share_token = $1 AND visibility = 'unlisted' AND deleted_at IS NULL`, token))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询分享酒单: %w", err)
	}
	return m, nil
}

// UpdateInput 只改元数据；nil 字段不动。
type UpdateInput struct {
	Title       *string
	Description *string
	Visibility  *string
}

// Update 改标题/描述/可见性。他人 PATCH → 403（与配方一致）；不存在 → 404。
func (s *Store) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateInput) (*Menu, error) {
	m, err := scanMenu(s.pool.QueryRow(ctx, `
		UPDATE menus SET
			title       = COALESCE($3, title),
			description = COALESCE($4, description),
			visibility  = COALESCE($5, visibility)
		WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
		RETURNING `+menuCols, id, ownerID, in.Title, in.Description, in.Visibility))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// 区分「不存在」和「不是主人」
			var exists bool
			if e := s.pool.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM menus WHERE id = $1 AND deleted_at IS NULL)`, id).Scan(&exists); e != nil {
				return nil, fmt.Errorf("查询酒单: %w", e)
			}
			if exists {
				return nil, ErrForbidden
			}
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("更新酒单: %w", err)
	}
	return m, nil
}

// Delete 软删除（幂等：别人的/已删的都报 403/404 由调用方区分）。
func (s *Store) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE menus SET deleted_at = now()
		WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`, id, ownerID)
	if err != nil {
		return fmt.Errorf("删除酒单: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// 区分不了「不存在」和「不是主人」——先查存在性再给准确错误
		var exists bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM menus WHERE id = $1 AND deleted_at IS NULL)`, id).Scan(&exists); err != nil {
			return fmt.Errorf("查询酒单: %w", err)
		}
		if !exists {
			return ErrNotFound
		}
		return ErrForbidden
	}
	return nil
}

// RotateShareToken 生成/轮换分享令牌（仅主人）。
func (s *Store) RotateShareToken(ctx context.Context, id, ownerID uuid.UUID) (*Menu, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, fmt.Errorf("生成令牌: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return scanMenu(s.pool.QueryRow(ctx, `
		UPDATE menus SET share_token = $3
		WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
		RETURNING `+menuCols, id, ownerID, token))
}

/* ────────────────────────── 条目 ────────────────────────── */

// AddItem 加入配方（幂等）：已存在则更新 note。position 追加到末尾。
// 只收已发布配方（草稿不泄露存在性 → 404 语义）。
func (s *Store) AddItem(ctx context.Context, menuID, ownerID, recipeID uuid.UUID, note *string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := assertOwner(ctx, tx, menuID, ownerID); err != nil {
		return err
	}
	var ok bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM recipes
			WHERE id = $1 AND status = 'published' AND deleted_at IS NULL)`, recipeID).Scan(&ok); err != nil {
		return fmt.Errorf("查询配方: %w", err)
	}
	if !ok {
		return ErrRecipeGone
	}

	// ON CONFLICT：重复加入幂等（note 刷新）；新增时 position 追加
	if _, err := tx.Exec(ctx, `
		INSERT INTO menu_items (menu_id, recipe_id, position, note)
		VALUES ($1, $2, COALESCE((SELECT max(position) + 1 FROM menu_items WHERE menu_id = $1), 1), $3)
		ON CONFLICT (menu_id, recipe_id) DO UPDATE SET note = EXCLUDED.note`,
		menuID, recipeID, note); err != nil {
		return fmt.Errorf("写条目: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE menus SET item_count = (SELECT count(*) FROM menu_items WHERE menu_id = $1) WHERE id = $1`,
		menuID); err != nil {
		return fmt.Errorf("更新计数: %w", err)
	}
	return tx.Commit(ctx)
}

// RemoveItem 移出（幂等：不在里面也成功）。
func (s *Store) RemoveItem(ctx context.Context, menuID, ownerID, recipeID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := assertOwner(ctx, tx, menuID, ownerID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM menu_items WHERE menu_id = $1 AND recipe_id = $2`, menuID, recipeID); err != nil {
		return fmt.Errorf("删条目: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE menus SET item_count = (SELECT count(*) FROM menu_items WHERE menu_id = $1) WHERE id = $1`,
		menuID); err != nil {
		return fmt.Errorf("更新计数: %w", err)
	}
	return tx.Commit(ctx)
}

// ReorderItem 重排：afterRecipeID 为 nil → 移到最前；否则插到锚点之后
// （取锚点与下一项的中点；锚点是末项则 +1）。全部在 SQL 里算，numeric 不过应用层。
func (s *Store) ReorderItem(ctx context.Context, menuID, ownerID, recipeID uuid.UUID, afterRecipeID *uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := assertOwner(ctx, tx, menuID, ownerID); err != nil {
		return err
	}
	var inMenu bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM menu_items WHERE menu_id = $1 AND recipe_id = $2)`,
		menuID, recipeID).Scan(&inMenu); err != nil {
		return fmt.Errorf("查询条目: %w", err)
	}
	if !inMenu {
		return ErrNotInMenu
	}
	if afterRecipeID != nil {
		var anchor bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM menu_items WHERE menu_id = $1 AND recipe_id = $2)`,
			menuID, *afterRecipeID).Scan(&anchor); err != nil {
			return fmt.Errorf("查询锚点: %w", err)
		}
		if !anchor {
			return ErrBadReorder
		}
	}

	// 中点插值。锚点为 NULL → 移到最前（min - 1，numeric 允许负值）。
	// 聚合子查询无 GROUP BY 恒返回一行，CASE 三分支覆盖全部情况：
	//   无锚点 → min-1；锚点是末项 → +1；否则 → (锚点 + 下一项) / 2
	if _, err := tx.Exec(ctx, `
		UPDATE menu_items mi SET position = sub.new_pos
		FROM (
			SELECT CASE
				WHEN $3::uuid IS NULL THEN
					(SELECT min(position) - 1 FROM menu_items WHERE menu_id = $1)
				WHEN (SELECT min(position) FROM menu_items WHERE menu_id = $1
					AND position > (SELECT position FROM menu_items WHERE menu_id = $1 AND recipe_id = $3)) IS NULL THEN
					(SELECT position + 1 FROM menu_items WHERE menu_id = $1 AND recipe_id = $3)
				ELSE
					((SELECT position FROM menu_items WHERE menu_id = $1 AND recipe_id = $3)
					+ (SELECT min(position) FROM menu_items WHERE menu_id = $1
						AND position > (SELECT position FROM menu_items WHERE menu_id = $1 AND recipe_id = $3))) / 2
			END AS new_pos
		) AS sub
		WHERE mi.menu_id = $1 AND mi.recipe_id = $2`, menuID, recipeID, afterRecipeID); err != nil {
		return fmt.Errorf("重排: %w", err)
	}
	return tx.Commit(ctx)
}

// Items 酒单条目（按 position 升序）。
func (s *Store) Items(ctx context.Context, menuID uuid.UUID) ([]Item, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT mi.recipe_id, mi.note, mi.added_at,
			r.short_no, r.title, r.classic_key, r.is_canonical, r.cover_url, r.like_count, r.comment_count,
			r.deleted_at IS NOT NULL
		FROM menu_items mi JOIN recipes r ON r.id = mi.recipe_id
		WHERE mi.menu_id = $1
		ORDER BY mi.position`, menuID)
	if err != nil {
		return nil, fmt.Errorf("查询条目: %w", err)
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.Recipe.ID, &it.Note, &it.AddedAt, &it.Recipe.ShortNo, &it.Recipe.Title,
			&it.Recipe.ClassicKey, &it.Recipe.IsCanonical, &it.Recipe.CoverURL,
			&it.Recipe.LikeCount, &it.Recipe.CommentCount, &it.Recipe.Deleted); err != nil {
			return nil, fmt.Errorf("扫描条目: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// assertOwner 事务内校验：酒单存在且属于 owner，否则 ErrNotFound / ErrForbidden。
func assertOwner(ctx context.Context, q pgx.Tx, menuID, ownerID uuid.UUID) error {
	var owner *uuid.UUID // 酒单在但主人删号 → NULL
	if err := q.QueryRow(ctx,
		`SELECT owner_id FROM menus WHERE id = $1 AND deleted_at IS NULL`, menuID).Scan(&owner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("查询酒单: %w", err)
	}
	if owner == nil || *owner != ownerID {
		return ErrForbidden
	}
	return nil
}

/* ────────────────────────── 列表 ────────────────────────── */

// MineSummary /me/menus 的条目：酒单 + （可选）是否含某配方。
type MineSummary struct {
	Menu
	ContainsRecipe bool // 仅当查询带 containsRecipe 时有意义
}

// ListMine 我的全部酒单（含私密）。酒单数量小，不分页（上限 200 兜底）。
// containsRecipe 非 nil 时附带每个酒单是否已含该配方（「加进酒单」弹层用）。
func (s *Store) ListMine(ctx context.Context, ownerID uuid.UUID, containsRecipe *uuid.UUID) ([]MineSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT m.id, m.owner_id, m.title, m.description, m.cover_url, m.visibility, m.share_token, m.item_count, m.created_at, m.updated_at,
			($2::uuid IS NULL OR EXISTS(SELECT 1 FROM menu_items mi
				WHERE mi.menu_id = m.id AND mi.recipe_id = $2))
		FROM menus m
		WHERE m.owner_id = $1 AND m.deleted_at IS NULL
		ORDER BY m.updated_at DESC
		LIMIT 200`, ownerID, containsRecipe)
	if err != nil {
		return nil, fmt.Errorf("查询我的酒单: %w", err)
	}
	defer rows.Close()
	out := []MineSummary{}
	for rows.Next() {
		var ms MineSummary
		if err := rows.Scan(&ms.ID, &ms.OwnerID, &ms.Title, &ms.Description, &ms.CoverURL,
			&ms.Visibility, &ms.ShareToken, &ms.ItemCount, &ms.CreatedAt, &ms.UpdatedAt, &ms.ContainsRecipe); err != nil {
			return nil, fmt.Errorf("扫描我的酒单: %w", err)
		}
		out = append(out, ms)
	}
	return out, rows.Err()
}

// ListResult 公开酒单分页页。
type ListResult struct {
	Items      []Menu
	NextCursor string
}

// ListPublicByUser 某人的公开酒单（updated_at DESC，Time 游标）。
func (s *Store) ListPublicByUser(ctx context.Context, ownerID uuid.UUID, cur string, limit int) (*ListResult, error) {
	c, err := cursor.Decode[cursor.Time](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{ownerID}
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (updated_at < $%d OR (updated_at = $%d AND id > $%d))", n-1, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT `+menuCols+` FROM menus
		WHERE owner_id = $1 AND visibility = 'public' AND deleted_at IS NULL`+pred+`
		ORDER BY updated_at DESC, id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("查询公开酒单: %w", err)
	}
	defer rows.Close()
	var menus []Menu
	var times []time.Time
	for rows.Next() {
		m, err := scanMenu(rows)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue // scanMenu 把 ErrNoRows 归一成 NotFound；rows.Next 场景不该发生
			}
			return nil, fmt.Errorf("扫描公开酒单: %w", err)
		}
		menus = append(menus, *m)
		times = append(times, m.UpdatedAt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历公开酒单: %w", err)
	}
	res := &ListResult{Items: []Menu{}}
	if len(menus) > limit {
		menus = menus[:limit]
		times = times[:limit]
		res.Items = menus
		res.NextCursor = cursor.Encode(cursor.Time{T: times[limit-1].UnixNano(), ID: menus[limit-1].ID.String()})
	} else {
		res.Items = menus
	}
	return res, nil
}
