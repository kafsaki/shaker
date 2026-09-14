// Package vocab 提供受控词表的读取（编辑器 /vocab 全量 + 原料/杯型单查）。
//
// 词表是受控数据（ADR-011）：双语、由 seed 导入、v1 没有用户写入路径。
// GET /vocab 的强缓存依赖 ETag，版本号取各表最新 updated_at 的最大值。
package vocab

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/irv"
)

type Ingredient struct {
	ID            string
	NameZh        string
	NameEn        string
	Category      string
	Subcategory   *string
	ABV           *float64
	Density       *float64
	Viz           []byte
	Aliases       []string
	DescriptionZh *string
	DescriptionEn *string
	RecipeCount   int
}

type Glass struct {
	ID         string
	NameZh     string
	NameEn     string
	CapacityMl int
	Shape      []byte
}

type Technique struct {
	ID     string
	NameZh string
	NameEn string
	IconID *string
}

type Tag struct {
	ID     string
	NameZh string
	NameEn string
	Kind   string
}

// Full 是 GET /vocab 的完整载荷。
type Full struct {
	Version     time.Time
	Ingredients []Ingredient
	Glassware   []Glass
	Techniques  []Technique
	Tags        []Tag
}

// Store 词表读取。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Version 返回词表内容的版本（各表 updated_at/created_at 的最大值）。
// 词表为空时返回零值。
func (s *Store) Version(ctx context.Context) (time.Time, error) {
	var v *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT greatest(
			(SELECT max(updated_at) FROM ingredients WHERE is_official),
			(SELECT max(updated_at) FROM glassware),
			(SELECT max(created_at) FROM tags))`).Scan(&v)
	if err != nil {
		return time.Time{}, fmt.Errorf("查询词表版本: %w", err)
	}
	if v == nil {
		return time.Time{}, nil
	}
	return *v, nil
}

// ingredientCols 详情与列表共用的列（不含 description，列表不需要）。
const ingredientCols = `i.id, i.name_zh, i.name_en, i.category, i.subcategory, i.abv, i.density, i.viz,
	coalesce(array_agg(a.alias ORDER BY a.alias) FILTER (WHERE a.ingredient_id IS NOT NULL), '{}')`

const ingredientFrom = `
	FROM ingredients i
	LEFT JOIN ingredient_aliases a ON a.ingredient_id = i.id
	WHERE i.is_official`

func scanIngredient(row pgx.Row, withDesc bool) (*Ingredient, error) {
	ing := &Ingredient{}
	var dest []any
	if withDesc {
		dest = []any{&ing.ID, &ing.NameZh, &ing.NameEn, &ing.Category, &ing.Subcategory,
			&ing.ABV, &ing.Density, &ing.Viz, &ing.Aliases, &ing.DescriptionZh, &ing.DescriptionEn, &ing.RecipeCount}
	} else {
		dest = []any{&ing.ID, &ing.NameZh, &ing.NameEn, &ing.Category, &ing.Subcategory,
			&ing.ABV, &ing.Density, &ing.Viz, &ing.Aliases}
	}
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	return ing, nil
}

// Full 加载全部词表。
func (s *Store) Full(ctx context.Context) (*Full, error) {
	f := &Full{}

	rows, err := s.pool.Query(ctx, `SELECT `+ingredientCols+ingredientFrom+` GROUP BY i.id ORDER BY i.category, i.id`)
	if err != nil {
		return nil, fmt.Errorf("查询原料: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		ing, err := scanIngredient(rows, false)
		if err != nil {
			return nil, fmt.Errorf("扫描原料: %w", err)
		}
		f.Ingredients = append(f.Ingredients, *ing)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历原料: %w", err)
	}

	rows, err = s.pool.Query(ctx, `SELECT id, name_zh, name_en, capacity_ml, shape FROM glassware ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("查询杯型: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		g := Glass{}
		if err := rows.Scan(&g.ID, &g.NameZh, &g.NameEn, &g.CapacityMl, &g.Shape); err != nil {
			return nil, fmt.Errorf("扫描杯型: %w", err)
		}
		f.Glassware = append(f.Glassware, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历杯型: %w", err)
	}

	rows, err = s.pool.Query(ctx, `SELECT id, name_zh, name_en, icon_id FROM techniques ORDER BY sort_order, id`)
	if err != nil {
		return nil, fmt.Errorf("查询手法: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		t := Technique{}
		if err := rows.Scan(&t.ID, &t.NameZh, &t.NameEn, &t.IconID); err != nil {
			return nil, fmt.Errorf("扫描手法: %w", err)
		}
		f.Techniques = append(f.Techniques, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历手法: %w", err)
	}

	rows, err = s.pool.Query(ctx, `SELECT id, name_zh, name_en, kind FROM tags ORDER BY kind, id`)
	if err != nil {
		return nil, fmt.Errorf("查询标签: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		t := Tag{}
		if err := rows.Scan(&t.ID, &t.NameZh, &t.NameEn, &t.Kind); err != nil {
			return nil, fmt.Errorf("扫描标签: %w", err)
		}
		f.Tags = append(f.Tags, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历标签: %w", err)
	}

	if f.Version, err = s.Version(ctx); err != nil {
		return nil, err
	}
	return f, nil
}

// IngredientFilter 列表筛选。After* 是游标（排序键元组）。
type IngredientFilter struct {
	Category    string
	Subcategory string
	Q           string
	Limit       int
	AfterCat    string
	AfterName   string
	AfterID     string
}

// ListIngredients 分类浏览 + 模糊搜索，按 (category, name_en, id) 排序。
// q 对中英文名与别名做 ILIKE；词表行数小，短词不需要 trgm 也能接受。
func (s *Store) ListIngredients(ctx context.Context, f IngredientFilter) ([]Ingredient, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+ingredientCols+ingredientFrom+`
			AND ($1 = '' OR i.category = $1)
			AND ($2 = '' OR i.subcategory = $2)
			AND ($3 = '' OR i.name_zh ILIKE '%' || $3 || '%'
			              OR i.name_en ILIKE '%' || $3 || '%'
			              OR EXISTS (SELECT 1 FROM ingredient_aliases x
			                          WHERE x.ingredient_id = i.id AND x.alias ILIKE '%' || $3 || '%'))
			AND (i.category, i.name_en, i.id) > ($4, $5, $6)
		GROUP BY i.id
		ORDER BY i.category, i.name_en, i.id
		LIMIT $7`,
		f.Category, f.Subcategory, f.Q, f.AfterCat, f.AfterName, f.AfterID, f.Limit)
	if err != nil {
		return nil, fmt.Errorf("查询原料列表: %w", err)
	}
	defer rows.Close()

	var out []Ingredient
	for rows.Next() {
		ing, err := scanIngredient(rows, false)
		if err != nil {
			return nil, fmt.Errorf("扫描原料: %w", err)
		}
		out = append(out, *ing)
	}
	return out, rows.Err()
}

// CountIngredients 与 ListIngredients 同条件的总数（搜索分组里的 total）。
func (s *Store) CountIngredients(ctx context.Context, q string) (int, error) {
	var n int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM ingredients i
		WHERE i.is_official
			AND ($1 = '' OR i.name_zh ILIKE '%' || $1 || '%'
			              OR i.name_en ILIKE '%' || $1 || '%'
			              OR EXISTS (SELECT 1 FROM ingredient_aliases x
			                          WHERE x.ingredient_id = i.id AND x.alias ILIKE '%' || $1 || '%'))`,
		q).Scan(&n); err != nil {
		return 0, fmt.Errorf("统计原料搜索: %w", err)
	}
	return n, nil
}

// Ingredient 按 ID 取详情（含双语介绍与配方计数）。
func (s *Store) Ingredient(ctx context.Context, id string) (*Ingredient, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+ingredientCols+`,
			i.description_zh_md, i.description_en_md, i.recipe_count`+ingredientFrom+`
			AND i.id = $1
		GROUP BY i.id`, id)
	ing, err := scanIngredient(row, true)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询原料 %s: %w", id, err)
	}
	return ing, nil
}

// Glass 按 ID 取杯型。
func (s *Store) Glass(ctx context.Context, id string) (*Glass, error) {
	g := &Glass{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name_zh, name_en, capacity_ml, shape FROM glassware WHERE id = $1`, id).
		Scan(&g.ID, &g.NameZh, &g.NameEn, &g.CapacityMl, &g.Shape)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("查询杯型 %s: %w", id, err)
	}
	return g, nil
}

// IrvVocab 构建校验/派生计算用的词表快照（irv.Check / ComputeDerived）。
func (s *Store) IrvVocab(ctx context.Context) (*irv.Vocab, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, abv, density FROM ingredients WHERE is_official`)
	if err != nil {
		return nil, fmt.Errorf("查询原料: %w", err)
	}
	defer rows.Close()

	v := &irv.Vocab{
		Ingredients:   make(map[string]irv.IngredientMeta),
		GlassCapacity: make(map[string]float64),
	}
	for rows.Next() {
		var id string
		var abv, density *float64
		if err := rows.Scan(&id, &abv, &density); err != nil {
			return nil, fmt.Errorf("扫描原料: %w", err)
		}
		v.Ingredients[id] = irv.IngredientMeta{ABV: abv, Density: density}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历原料: %w", err)
	}

	rows, err = s.pool.Query(ctx, `SELECT id, capacity_ml FROM glassware`)
	if err != nil {
		return nil, fmt.Errorf("查询杯型: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var ml int
		if err := rows.Scan(&id, &ml); err != nil {
			return nil, fmt.Errorf("扫描杯型: %w", err)
		}
		v.GlassCapacity[id] = float64(ml)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历杯型: %w", err)
	}
	return v, nil
}
