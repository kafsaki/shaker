// Package recipe 之列表部分（API 定义 §2.7/§2.8）：用户主页 / 点赞 / 草稿 /
// 搜索 / 对比。全部 cursor 分页（§1.3），fetch limit+1 判断是否还有下一页。
package recipe

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/cursor"
)

// ListResult 通用列表页。NextCursor 为 "" 表示到底。
type ListResult struct {
	Items      []*Recipe
	NextCursor string
}

/* ────────────────────────── 用户主页 ────────────────────────── */

// ListByAuthor 某用户的已发布配方，按发布时间倒序。
func (s *Store) ListByAuthor(ctx context.Context, authorID uuid.UUID, cur string, limit int) (*ListResult, error) {
	return s.timeList(ctx, `
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE r.author_id = $1 AND r.status = 'published' AND r.deleted_at IS NULL`,
		"r.published_at", func(r *Recipe) string {
			return cursor.Encode(cursor.Time{T: tOf(r.PublishedAt), ID: r.ID.String()})
		}, []any{authorID}, cur, limit)
}

// ListDrafts 我的草稿，按更新时间倒序。
func (s *Store) ListDrafts(ctx context.Context, authorID uuid.UUID, cur string, limit int) (*ListResult, error) {
	return s.timeList(ctx, `
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE r.author_id = $1 AND r.status = 'draft' AND r.deleted_at IS NULL`,
		"r.updated_at", func(r *Recipe) string {
			return cursor.Encode(cursor.Time{T: r.UpdatedAt.UnixNano(), ID: r.ID.String()})
		}, []any{authorID}, cur, limit)
}

// LikedBy 某人点赞过的配方，按点赞时间倒序。两步查：先取 likes 键，
// 再取配方（被点赞后撤回/删除的配方自然消失，不影响游标——游标锚在 likes 行上）。
func (s *Store) LikedBy(ctx context.Context, userID uuid.UUID, cur string, limit int) (*ListResult, error) {
	c, err := cursor.Decode[cursor.Time](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{userID}
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (l.created_at < $%d OR (l.created_at = $%d AND l.recipe_id > $%d))", n-1, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT l.recipe_id, l.created_at FROM likes l
		WHERE l.user_id = $1`+pred+`
		ORDER BY l.created_at DESC, l.recipe_id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("查询点赞列表: %w", err)
	}
	defer rows.Close()

	type key struct {
		id uuid.UUID
		at time.Time
	}
	var keys []key
	for rows.Next() {
		k := key{}
		if err := rows.Scan(&k.id, &k.at); err != nil {
			return nil, fmt.Errorf("扫描点赞列表: %w", err)
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历点赞列表: %w", err)
	}
	if len(keys) == 0 {
		return &ListResult{Items: []*Recipe{}}, nil
	}

	visible := keys
	if len(keys) > limit {
		visible = keys[:limit]
	}
	ids := make([]uuid.UUID, 0, len(visible))
	for _, k := range visible {
		ids = append(ids, k.id)
	}
	byID, err := s.fetchByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}

	res := &ListResult{Items: make([]*Recipe, 0, len(visible))}
	for _, k := range visible {
		if r, ok := byID[k.id]; ok {
			res.Items = append(res.Items, r)
		}
	}
	if len(keys) > limit {
		last := visible[limit-1]
		res.NextCursor = cursor.Encode(cursor.Time{T: last.at.UnixNano(), ID: last.id.String()})
	}
	return res, nil
}

// fetchByIDs 批量取已发布配方（保持不到的静默跳过）。
func (s *Store) fetchByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*Recipe, error) {
	rows, err := s.queryRecipes(ctx, `
		SELECT `+recipeCols+authorCols+`
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE r.id = ANY($1) AND r.status = 'published' AND r.deleted_at IS NULL`, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]*Recipe, len(rows))
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

// Compare 配方对比（API 定义 §2.6）：按传入顺序返回，最多 5 个。
func (s *Store) Compare(ctx context.Context, ids []uuid.UUID) ([]*Recipe, error) {
	byID, err := s.fetchByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]*Recipe, 0, len(ids))
	for _, id := range ids {
		if r, ok := byID[id]; ok {
			out = append(out, r)
		}
	}
	return out, nil
}

/* ────────────────────────── 搜索（需求 4） ────────────────────────── */

// SearchParams /search 的全部筛选。
type SearchParams struct {
	Q              string
	Ingredients    []string // AND 语义：同时含全部
	IngredientRole string   // 与 Ingredients 组合（「以金酒为基酒」）
	Family         string
	Method         string
	Glass          string
	Tag            string
	AbvMin         *float64
	AbvMax         *float64
	DifficultyMax  *int
	Sort           string // relevance | hot | new
}

// Search 配方搜索。relevance：权威条目置顶 + trgm 相似度（ADR-012）；
// hot/new 同 Feed。q 为空时 relevance 退化为 hot（相似度无意义）。
func (s *Store) Search(ctx context.Context, p SearchParams, cur string, limit int) (*ListResult, error) {
	where, args := searchWhere(p)
	base := `
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE ` + strings.Join(where, " AND ")

	// 排序 + 游标谓词
	relevance := p.Sort == "relevance" && p.Q != ""
	var rows []*Recipe
	switch {
	case relevance:
		c, err := cursor.Decode[cursor.Relevance](cur)
		if err != nil {
			return nil, ErrBadCursor
		}
		args = append(args, p.Q) // similarity 参数
		qn := len(args)
		pred := ""
		if c != nil {
			args = append(args, c.C, c.S, c.ID)
			n := len(args)
			pred = fmt.Sprintf(` AND (r.is_canonical < $%d OR (r.is_canonical = $%d AND (similarity(r.title, $%d) < $%d
				OR (similarity(r.title, $%d) = $%d AND r.id > $%d))))`, n-2, n-2, qn, n-1, qn, n-1, n)
		}
		args = append(args, limit+1)
		sql := `SELECT similarity(r.title, $` + fmt.Sprint(qn) + `), ` + recipeCols + authorCols + base + pred + `
			ORDER BY r.is_canonical DESC, similarity(r.title, $` + fmt.Sprint(qn) + `) DESC, r.id ASC
			LIMIT $` + fmt.Sprint(len(args))
		if rows, err = s.queryRecipesSim(ctx, sql, args...); err != nil {
			return nil, err
		}
		return cutList(rows, limit, func(r *Recipe) string {
			return cursor.Encode(cursor.Relevance{C: r.IsCanonical, S: r.Sim, ID: r.ID.String()})
		}), nil

	case p.Sort == "new":
		c, err := cursor.Decode[cursor.Time](cur)
		if err != nil {
			return nil, ErrBadCursor
		}
		pred := ""
		if c != nil {
			args = append(args, time.Unix(0, c.T).UTC(), c.ID)
			n := len(args)
			pred = fmt.Sprintf(" AND (r.published_at < $%d OR (r.published_at = $%d AND r.id > $%d))", n-1, n-1, n)
		}
		args = append(args, limit+1)
		rows, err := s.queryRecipes(ctx, `SELECT `+recipeCols+authorCols+base+pred+`
			ORDER BY r.published_at DESC, r.id ASC
			LIMIT $`+fmt.Sprint(len(args)), args...)
		if err != nil {
			return nil, err
		}
		return cutList(rows, limit, func(r *Recipe) string {
			return cursor.Encode(cursor.Time{T: tOf(r.PublishedAt), ID: r.ID.String()})
		}), nil

	default: // hot（含 q 为空的 relevance 退化）
		c, err := cursor.Decode[cursor.Hot](cur)
		if err != nil {
			return nil, ErrBadCursor
		}
		pred := ""
		if c != nil {
			args = append(args, c.H, c.ID)
			n := len(args)
			pred = fmt.Sprintf(" AND (r.hot_score < $%d OR (r.hot_score = $%d AND r.id > $%d))", n-1, n-1, n)
		}
		args = append(args, limit+1)
		rows, err := s.queryRecipes(ctx, `SELECT `+recipeCols+authorCols+base+pred+`
			ORDER BY r.hot_score DESC, r.id ASC
			LIMIT $`+fmt.Sprint(len(args)), args...)
		if err != nil {
			return nil, err
		}
		return cutList(rows, limit, func(r *Recipe) string {
			return cursor.Encode(cursor.Hot{H: r.HotScore, ID: r.ID.String()})
		}), nil
	}
}

/* ────────────────────────── 内部辅助 ────────────────────────── */

// searchWhere Search 与 SearchCount 共用的 WHERE 构建。
func searchWhere(p SearchParams) ([]string, []any) {
	where := []string{"r.status = 'published'", "r.deleted_at IS NULL"}
	var args []any
	add := func(v any, cond string) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}

	if p.Q != "" {
		args = append(args, p.Q)
		n := len(args)
		where = append(where, fmt.Sprintf(`(r.title %% $%d OR r.title ILIKE '%%' || $%d || '%%')`, n, n))
	}
	for _, ing := range p.Ingredients {
		args = append(args, ing)
		n := len(args)
		sub := fmt.Sprintf(`EXISTS(SELECT 1 FROM recipe_ingredients ri
			WHERE ri.recipe_id = r.id AND ri.ingredient_id = $%d`, n)
		if p.IngredientRole != "" {
			args = append(args, p.IngredientRole)
			sub += fmt.Sprintf(` AND ri.role = $%d)`, len(args))
		} else {
			sub += ")"
		}
		where = append(where, sub)
	}
	if p.Family != "" {
		add(p.Family, `r.family = $%d`)
	}
	if p.Method != "" {
		add(p.Method, `r.method = $%d`)
	}
	if p.Glass != "" {
		add(p.Glass, `r.glass_id = $%d`)
	}
	if p.Tag != "" {
		add(p.Tag, `EXISTS(SELECT 1 FROM recipe_tags rt WHERE rt.recipe_id = r.id AND rt.tag_id = $%d)`)
	}
	if p.AbvMin != nil {
		add(*p.AbvMin, `r.abv_est >= $%d`)
	}
	if p.AbvMax != nil {
		add(*p.AbvMax, `r.abv_est <= $%d`)
	}
	if p.DifficultyMax != nil {
		add(*p.DifficultyMax, `(r.difficulty IS NULL OR r.difficulty <= $%d)`)
	}
	return where, args
}

// SearchCount 与 Search 同条件的总数（type=all 分组里的 total）。
func (s *Store) SearchCount(ctx context.Context, p SearchParams) (int, error) {
	where, args := searchWhere(p)
	var n int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM recipes r WHERE `+strings.Join(where, " AND "), args...).Scan(&n); err != nil {
		return 0, fmt.Errorf("统计搜索结果: %w", err)
	}
	return n, nil
}

// timeList 时间倒序列表通用实现：timeCol 为任意 timestamptz 表达式。
func (s *Store) timeList(ctx context.Context, from string, timeCol string,
	cursorOf func(*Recipe) string, extraArgs []any, cur string, limit int) (*ListResult, error) {
	c, err := cursor.Decode[cursor.Time](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := append([]any{}, extraArgs...)
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (%s < $%d OR (%s = $%d AND r.id > $%d))", timeCol, n-1, timeCol, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.queryRecipes(ctx, `SELECT `+recipeCols+authorCols+from+pred+`
		ORDER BY `+timeCol+` DESC, r.id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	return cutList(rows, limit, cursorOf), nil
}

// cutList 多取的那条只用来判断还有没有下一页。
func cutList(rows []*Recipe, limit int, cursorOf func(*Recipe) string) *ListResult {
	res := &ListResult{Items: rows}
	if len(rows) > limit {
		rows = rows[:limit]
		res.Items = rows
		res.NextCursor = cursorOf(rows[limit-1])
	}
	return res
}

// queryRecipesSim 搜索相关度版：第一列是 similarity 分数，随后是配方列。
func (s *Store) queryRecipesSim(ctx context.Context, sql string, args ...any) ([]*Recipe, error) {
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("查询搜索: %w", err)
	}
	defer rows.Close()
	var out []*Recipe
	for rows.Next() {
		r := &Recipe{}
		var authorID, authorHandle, authorName, authorAvatar *string
		var authorOfficial *bool
		var taste []byte
		err := rows.Scan(&r.Sim, &r.ID, &r.AuthorID, &r.ShortNo, &r.Title, &r.Subtitle, &r.DescriptionMd, &r.Lang,
			&r.IR, &r.IRVersion, &r.GlassID, &r.Method, &r.Family, &r.Source, &r.IsCanonical, &r.ClassicKey,
			&r.DerivedFrom, &r.DerivedCount, &r.IbaCategory, &r.CoverURL, &r.Status,
			&r.AbvEst, &r.TotalVolumeMl, &taste, &r.Difficulty,
			&r.LikeCount, &r.CommentCount, &r.CollectCount, &r.ViewCount, &r.HotScore,
			&r.CreatedAt, &r.UpdatedAt, &r.PublishedAt, &r.DeletedAt,
			&authorID, &authorHandle, &authorName, &authorAvatar, &authorOfficial)
		if err != nil {
			return nil, fmt.Errorf("扫描搜索行: %w", err)
		}
		if authorID != nil {
			r.Author = &AuthorBrief{
				ID: *authorID, Handle: *authorHandle, DisplayName: *authorName,
				AvatarURL: authorAvatar, IsOfficial: *authorOfficial,
			}
		}
		if taste != nil {
			tp := &TasteProfile{}
			if err := json.Unmarshal(taste, tp); err == nil {
				r.TasteProfile = tp
			}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历搜索: %w", err)
	}
	if err := s.loadTagsBatch(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

// tOf 时间指针的 unix nano（published_at 对已发布配方非空，防御而已）。
func tOf(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return t.UnixNano()
}
