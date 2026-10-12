package menu

// 酒单广场（ADR-029）：公开酒单的发现、收藏与复制。
// 精选酒单由种子以官方账号维护（featured_key 非空），广场上单独置顶，不进社区列表。

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kafsaki/shaker/apps/api/internal/cursor"
)

var ErrSelfSave = errors.New("不能收藏自己的酒单")

// menuColsM 是带 m. 前缀的 menuCols（与 menu_saves 连接时列名会撞）。
const menuColsM = `m.id, m.owner_id, m.title, m.description, m.cover_url, m.visibility, m.item_count,
	m.save_count, m.featured_key IS NOT NULL, m.created_at, m.updated_at`

// 广场排序
const (
	SortHot = "hot" // 收藏数降序
	SortNew = "new" // 最近更新
)

// ListPublic 社区公开酒单（不含精选、不含空酒单）。
// hot：save_count DESC, id ASC（Hot 游标）；new：updated_at DESC, id ASC（Time 游标）。
func (s *Store) ListPublic(ctx context.Context, sort, cur string, limit int) (*ListResult, error) {
	const base = ` FROM menus
		WHERE deleted_at IS NULL AND visibility = 'public' AND featured_key IS NULL AND item_count > 0`
	if sort == SortHot {
		c, err := cursor.Decode[cursor.Hot](cur)
		if err != nil {
			return nil, ErrBadCursor
		}
		args := []any{}
		pred := ""
		if c != nil {
			args = append(args, int(c.H), c.ID)
			pred = " AND (save_count < $1 OR (save_count = $1 AND id > $2))"
		}
		args = append(args, limit+1)
		rows, err := s.pool.Query(ctx, `SELECT `+menuCols+base+pred+`
			ORDER BY save_count DESC, id ASC
			LIMIT $`+fmt.Sprint(len(args)), args...)
		if err != nil {
			return nil, fmt.Errorf("查询广场酒单: %w", err)
		}
		defer rows.Close()
		var menus []Menu
		for rows.Next() {
			m, err := scanMenu(rows)
			if err != nil {
				return nil, fmt.Errorf("扫描广场酒单: %w", err)
			}
			menus = append(menus, *m)
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("遍历广场酒单: %w", err)
		}
		res := &ListResult{Items: []Menu{}}
		if len(menus) > limit {
			menus = menus[:limit]
			last := menus[limit-1]
			res.NextCursor = cursor.Encode(cursor.Hot{H: float32(last.SaveCount), ID: last.ID.String()})
		}
		if menus != nil {
			res.Items = menus
		}
		return res, nil
	}

	c, err := cursor.Decode[cursor.Time](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{}
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		pred = " AND (updated_at < $1 OR (updated_at = $1 AND id > $2))"
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `SELECT `+menuCols+base+pred+`
		ORDER BY updated_at DESC, id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("查询广场酒单: %w", err)
	}
	defer rows.Close()
	return collectMenus(rows, limit)
}

// Featured 官方精选酒单（按种子顺序）。数量由种子决定，很少，不分页。
func (s *Store) Featured(ctx context.Context) ([]Menu, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+menuCols+` FROM menus
		WHERE featured_key IS NOT NULL AND visibility = 'public' AND deleted_at IS NULL
		ORDER BY featured_rank, id
		LIMIT 50`)
	if err != nil {
		return nil, fmt.Errorf("查询精选酒单: %w", err)
	}
	defer rows.Close()
	out := []Menu{}
	for rows.Next() {
		m, err := scanMenu(rows)
		if err != nil {
			return nil, fmt.Errorf("扫描精选酒单: %w", err)
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

/* ────────────────────────── 收藏 ────────────────────────── */

// visibleTo 事务内取酒单并按可见性过滤：不存在或他人的私密酒单一律 ErrNotFound（不泄露存在性）。
func visibleTo(ctx context.Context, q pgx.Tx, menuID, viewer uuid.UUID) (*Menu, error) {
	m, err := scanMenu(q.QueryRow(ctx, `SELECT `+menuCols+` FROM menus
		WHERE id = $1 AND deleted_at IS NULL`, menuID))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询酒单: %w", err)
	}
	if m.Visibility != "public" && m.OwnerID != viewer {
		return nil, ErrNotFound
	}
	return m, nil
}

// Save 收藏别人的公开酒单（幂等），返回最新收藏数。
func (s *Store) Save(ctx context.Context, userID, menuID uuid.UUID) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	m, err := visibleTo(ctx, tx, menuID, userID)
	if err != nil {
		return 0, err
	}
	if m.OwnerID == userID {
		return 0, ErrSelfSave
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO menu_saves (user_id, menu_id) VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, userID, menuID); err != nil {
		return 0, fmt.Errorf("写收藏: %w", err)
	}
	n, err := syncSaveCount(ctx, tx, menuID)
	if err != nil {
		return 0, err
	}
	return n, tx.Commit(ctx)
}

// Unsave 取消收藏（幂等：没收藏过、酒单已删或转私密也成功）。
func (s *Store) Unsave(ctx context.Context, userID, menuID uuid.UUID) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`DELETE FROM menu_saves WHERE user_id = $1 AND menu_id = $2`, userID, menuID); err != nil {
		return 0, fmt.Errorf("删收藏: %w", err)
	}
	n, err := syncSaveCount(ctx, tx, menuID)
	if err != nil {
		return 0, err
	}
	return n, tx.Commit(ctx)
}

// syncSaveCount 从源表重算收藏数（与写收藏同事务，DB 设计 §3.3）。酒单不存在时返回 0。
func syncSaveCount(ctx context.Context, q pgx.Tx, menuID uuid.UUID) (int, error) {
	var n int
	err := q.QueryRow(ctx, `
		UPDATE menus SET save_count = (SELECT count(*) FROM menu_saves WHERE menu_id = $1)
		WHERE id = $1 RETURNING save_count`, menuID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("更新收藏数: %w", err)
	}
	return n, nil
}

// SavedSet 批量判断 user 是否收藏了这些酒单。
func (s *Store) SavedSet(ctx context.Context, userID uuid.UUID, menuIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool, len(menuIDs))
	if len(menuIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT menu_id FROM menu_saves WHERE user_id = $1 AND menu_id = ANY($2)`, userID, menuIDs)
	if err != nil {
		return nil, fmt.Errorf("查询收藏: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("扫描收藏: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// ListSaved 我收藏的酒单（收藏时间倒序，Time 游标）。只返回仍然公开且未删除的。
func (s *Store) ListSaved(ctx context.Context, userID uuid.UUID, cur string, limit int) (*ListResult, error) {
	c, err := cursor.Decode[cursor.Time](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{userID}
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		pred = " AND (ms.created_at < $2 OR (ms.created_at = $2 AND m.id > $3))"
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT `+menuColsM+`, ms.created_at
		FROM menu_saves ms JOIN menus m ON m.id = ms.menu_id
		WHERE ms.user_id = $1 AND m.deleted_at IS NULL AND m.visibility = 'public'`+pred+`
		ORDER BY ms.created_at DESC, m.id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("查询收藏的酒单: %w", err)
	}
	defer rows.Close()
	var menus []Menu
	var savedAt []time.Time
	for rows.Next() {
		var m Menu
		var at time.Time
		if err := rows.Scan(&m.ID, &m.OwnerID, &m.Title, &m.Description, &m.CoverURL,
			&m.Visibility, &m.ItemCount, &m.SaveCount, &m.Featured, &m.CreatedAt, &m.UpdatedAt, &at); err != nil {
			return nil, fmt.Errorf("扫描收藏的酒单: %w", err)
		}
		menus = append(menus, m)
		savedAt = append(savedAt, at)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历收藏的酒单: %w", err)
	}
	res := &ListResult{Items: []Menu{}}
	if len(menus) > limit {
		menus = menus[:limit]
		res.NextCursor = cursor.Encode(cursor.Time{T: savedAt[limit-1].UnixNano(), ID: menus[limit-1].ID.String()})
	}
	if menus != nil {
		res.Items = menus
	}
	return res, nil
}

/* ────────────────────────── 复制 ────────────────────────── */

// Fork 把一个看得见的酒单复制成自己的私密酒单：条目顺序与笔记一并带上，
// 已删除/未发布的配方跳过。复制后两份互不影响。
func (s *Store) Fork(ctx context.Context, userID, menuID uuid.UUID) (*Menu, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	src, err := visibleTo(ctx, tx, menuID, userID)
	if err != nil {
		return nil, err
	}
	newID := uuid.Must(uuid.NewV7())
	if _, err := tx.Exec(ctx, `
		INSERT INTO menus (id, owner_id, title, description, visibility)
		VALUES ($1, $2, $3, $4, 'private')`, newID, userID, src.Title, src.Description); err != nil {
		return nil, fmt.Errorf("建酒单: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO menu_items (menu_id, recipe_id, position, note)
		SELECT $1, mi.recipe_id, mi.position, mi.note
		FROM menu_items mi JOIN recipes r ON r.id = mi.recipe_id
		WHERE mi.menu_id = $2 AND r.status = 'published' AND r.deleted_at IS NULL`, newID, menuID); err != nil {
		return nil, fmt.Errorf("复制条目: %w", err)
	}
	m, err := scanMenu(tx.QueryRow(ctx, `
		UPDATE menus SET item_count = (SELECT count(*) FROM menu_items WHERE menu_id = $1)
		WHERE id = $1 RETURNING `+menuCols, newID))
	if err != nil {
		return nil, fmt.Errorf("更新计数: %w", err)
	}
	ids, err := menuRecipeIDs(ctx, tx, newID)
	if err != nil {
		return nil, err
	}
	if err := syncRecipeCollect(ctx, tx, ids); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return m, nil
}
