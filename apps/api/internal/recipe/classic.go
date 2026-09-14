// Package recipe 之经典条目部分（API 定义 §2.6）：经典列表 / 权威条目 /
// 社区变体 / 规格分布。分布全部来自 recipe_ingredients 投影的聚合——
// IR 白拿的产品亮点（ADR-013），普通菜谱站做不到。
package recipe

import (
	"context"
	"errors"
	"fmt"

	"github.com/kafsaki/shaker/apps/api/internal/cursor"
)

/* ────────────────────────── 列表 / 权威条目 / 变体 ────────────────────────── */

// Classics 经典列表（权威条目），按发布时间倒序。
func (s *Store) Classics(ctx context.Context, ibaCategory, family, cur string, limit int) (*ListResult, error) {
	where := []string{"r.is_canonical", "r.status = 'published'", "r.deleted_at IS NULL"}
	var args []any
	if ibaCategory != "" {
		args = append(args, ibaCategory)
		where = append(where, fmt.Sprintf("r.iba_category = $%d", len(args)))
	}
	if family != "" {
		args = append(args, family)
		where = append(where, fmt.Sprintf("r.family = $%d", len(args)))
	}
	return s.timeList(ctx, `
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE `+joinAnd(where), "r.published_at",
		func(r *Recipe) string {
			return cursor.Encode(cursor.Time{T: tOf(r.PublishedAt), ID: r.ID.String()})
		}, args, cur, limit)
}

// CanonicalByKey 某经典的权威条目。
func (s *Store) CanonicalByKey(ctx context.Context, classicKey string) (*Recipe, error) {
	r, err := scanRecipeWithAuthor(s.pool.QueryRow(ctx, `
		SELECT `+recipeCols+authorCols+`
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE r.classic_key = $1 AND r.is_canonical AND r.status = 'published' AND r.deleted_at IS NULL`,
		classicKey))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询经典 %s: %w", classicKey, err)
	}
	if err := s.loadTags(ctx, r); err != nil {
		return nil, err
	}
	return r, nil
}

// Variants 某经典的社区变体（不含权威条目本身）。sort: hot | new。
func (s *Store) Variants(ctx context.Context, classicKey, sort, cur string, limit int) (*ListResult, error) {
	const from = `
		FROM recipes r LEFT JOIN users u ON u.id = r.author_id
		WHERE r.classic_key = $1 AND NOT r.is_canonical
			AND r.status = 'published' AND r.deleted_at IS NULL`
	if sort == "new" {
		return s.timeList(ctx, from, "r.published_at",
			func(r *Recipe) string {
				return cursor.Encode(cursor.Time{T: tOf(r.PublishedAt), ID: r.ID.String()})
			}, []any{classicKey}, cur, limit)
	}

	// hot（默认）
	c, err := cursor.Decode[cursor.Hot](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{classicKey}
	pred := ""
	if c != nil {
		args = append(args, c.H, c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (r.hot_score < $%d OR (r.hot_score = $%d AND r.id > $%d))", n-1, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.queryRecipes(ctx, `SELECT `+recipeCols+authorCols+from+pred+`
		ORDER BY r.hot_score DESC, r.id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	return cutList(rows, limit, func(r *Recipe) string {
		return cursor.Encode(cursor.Hot{H: r.HotScore, ID: r.ID.String()})
	}), nil
}

func joinAnd(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " AND "
		}
		out += p
	}
	return out
}

/* ────────────────────────── 规格分布 ────────────────────────── */

// DistStats 分位数统计。空集（无人填该数值）时全为 nil。
type DistStats struct {
	P10    *float64
	P25    *float64
	Median *float64
	P75    *float64
	P90    *float64
}

// DistIngredient 一种原料在变体里的分布。
type DistIngredient struct {
	IngredientID string
	Role         string
	PresentIn    int
	AmountMl     *DistStats // 不可换算单位（top_up 等）的行不进分位
}

// Distribution 规格分布（API 定义 §2.6）。
type Distribution struct {
	ClassicKey   string
	VariantCount int
	Ingredients  []DistIngredient
	AbvEst       *DistStats
}

// Distribution 某经典的社区规格分布。classicKey 无权威条目 → ErrNotFound。
func (s *Store) Distribution(ctx context.Context, classicKey string) (*Distribution, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM recipes
			WHERE classic_key = $1 AND is_canonical AND status = 'published' AND deleted_at IS NULL)`,
		classicKey).Scan(&exists); err != nil {
		return nil, fmt.Errorf("查询经典锚点 %s: %w", classicKey, err)
	}
	if !exists {
		return nil, ErrNotFound
	}

	dist := &Distribution{ClassicKey: classicKey, AbvEst: &DistStats{}, Ingredients: []DistIngredient{}}

	// 变体数 + ABV 分布（一个查询；percentile 忽略 NULL 行）
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*),
			percentile_cont(0.1) WITHIN GROUP (ORDER BY abv_est),
			percentile_cont(0.25) WITHIN GROUP (ORDER BY abv_est),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY abv_est),
			percentile_cont(0.75) WITHIN GROUP (ORDER BY abv_est),
			percentile_cont(0.9) WITHIN GROUP (ORDER BY abv_est)
		FROM recipes
		WHERE classic_key = $1 AND NOT is_canonical
			AND status = 'published' AND deleted_at IS NULL`, classicKey).
		Scan(&dist.VariantCount, &dist.AbvEst.P10, &dist.AbvEst.P25, &dist.AbvEst.Median,
			&dist.AbvEst.P75, &dist.AbvEst.P90); err != nil {
		return nil, fmt.Errorf("统计变体 ABV: %w", err)
	}
	if dist.VariantCount == 0 {
		return dist, nil
	}

	// 每原料的用量分布
	rows, err := s.pool.Query(ctx, `
		SELECT ri.ingredient_id, ri.role, count(*) AS present_in,
			percentile_cont(0.1) WITHIN GROUP (ORDER BY ri.amount_ml),
			percentile_cont(0.25) WITHIN GROUP (ORDER BY ri.amount_ml),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY ri.amount_ml),
			percentile_cont(0.75) WITHIN GROUP (ORDER BY ri.amount_ml),
			percentile_cont(0.9) WITHIN GROUP (ORDER BY ri.amount_ml)
		FROM recipe_ingredients ri
		JOIN recipes r ON r.id = ri.recipe_id
		WHERE r.classic_key = $1 AND NOT r.is_canonical
			AND r.status = 'published' AND r.deleted_at IS NULL
		GROUP BY ri.ingredient_id, ri.role
		ORDER BY present_in DESC, ri.ingredient_id`, classicKey)
	if err != nil {
		return nil, fmt.Errorf("统计原料分布: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		d := DistIngredient{AmountMl: &DistStats{}}
		if err := rows.Scan(&d.IngredientID, &d.Role, &d.PresentIn,
			&d.AmountMl.P10, &d.AmountMl.P25, &d.AmountMl.Median, &d.AmountMl.P75, &d.AmountMl.P90); err != nil {
			return nil, fmt.Errorf("扫描原料分布: %w", err)
		}
		dist.Ingredients = append(dist.Ingredients, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历原料分布: %w", err)
	}
	return dist, nil
}
