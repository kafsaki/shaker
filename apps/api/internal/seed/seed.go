// Package seed 幂等导入冷启动内容（ADR-016）：受控词表、官方账号、五款经典配方。
//
// 数据真相源在 packages/seed（TS），由 export.ts 双写到本包 data/seed.json。
// 导入全部用 upsert —— 可随启动反复执行，词表更新后重启即生效。
// 经典配方入库前跑 irv.Check 全链路校验并计算派生值，种子数据本身不合法时启动失败（fail loud）。
package seed

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/irv"
)

//go:embed data/seed.json
var seedFS embed.FS

/* ────────────────────────── 数据形状（镜像 seed.json） ────────────────────────── */

type Data struct {
	OfficialUser   OfficialUser    `json:"officialUser"`
	Ingredients    []Ingredient    `json:"ingredients"`
	Glassware      []Glass         `json:"glassware"`
	Techniques     []Technique     `json:"techniques"`
	Tags           []Tag           `json:"tags"`
	ClassicRecipes []ClassicRecipe `json:"classicRecipes"`
}

type OfficialUser struct {
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Bio         string `json:"bio"`
}

type Ingredient struct {
	ID          string          `json:"id"`
	NameZh      string          `json:"nameZh"`
	NameEn      string          `json:"nameEn"`
	Category    string          `json:"category"`
	Subcategory *string         `json:"subcategory"`
	ABV         *float64        `json:"abv"`
	Density     *float64        `json:"density"`
	Viz         json.RawMessage `json:"viz"`
	Aliases     []Alias         `json:"aliases"`
}

type Alias struct {
	Alias string `json:"alias"`
	Lang  string `json:"lang"`
}

type Glass struct {
	ID         string          `json:"id"`
	NameZh     string          `json:"nameZh"`
	NameEn     string          `json:"nameEn"`
	CapacityMl int             `json:"capacityMl"`
	Shape      json.RawMessage `json:"shape"`
}

type Technique struct {
	ID        string `json:"id"`
	NameZh    string `json:"nameZh"`
	NameEn    string `json:"nameEn"`
	IconID    string `json:"iconId"`
	SortOrder int    `json:"sortOrder"`
}

type Tag struct {
	ID     string `json:"id"`
	NameZh string `json:"nameZh"`
	NameEn string `json:"nameEn"`
	Kind   string `json:"kind"`
}

type TasteProfile struct {
	Sweet    int `json:"sweet"`
	Sour     int `json:"sour"`
	Bitter   int `json:"bitter"`
	Strength int `json:"strength"`
}

type ClassicRecipe struct {
	Title         string          `json:"title"`
	Subtitle      string          `json:"subtitle"`
	ClassicKey    string          `json:"classicKey"`
	IBACategory   *string         `json:"ibaCategory"` // 指针：非 IBA 经典为 null（DB 允许 NULL，空串会被 CHECK 拒绝）
	Family        string          `json:"family"`
	DescriptionMd string          `json:"descriptionMd"`
	Lang          string          `json:"lang"`
	TasteProfile  TasteProfile    `json:"tasteProfile"`
	Difficulty    int             `json:"difficulty"`
	Tags          []string        `json:"tags"`
	IR            json.RawMessage `json:"ir"`
}

func Load() (*Data, error) {
	raw, err := seedFS.ReadFile("data/seed.json")
	if err != nil {
		return nil, fmt.Errorf("读取内嵌 seed.json: %w", err)
	}
	var d Data
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("解析 seed.json: %w", err)
	}
	return &d, nil
}

// Vocab 从种子数据构建词表视图，供经典配方的校验与派生计算。
func (d *Data) Vocab() *irv.Vocab {
	v := &irv.Vocab{
		Ingredients:   make(map[string]irv.IngredientMeta, len(d.Ingredients)),
		GlassCapacity: make(map[string]float64, len(d.Glassware)),
	}
	for _, ing := range d.Ingredients {
		v.Ingredients[ing.ID] = irv.IngredientMeta{ID: ing.ID, ABV: ing.ABV, Density: ing.Density}
	}
	for _, g := range d.Glassware {
		v.GlassCapacity[g.ID] = float64(g.CapacityMl)
	}
	return v
}

/* ────────────────────────── 导入 ────────────────────────── */

// Run 在单个事务里完成全部导入。任何一步失败整体回滚。
func Run(ctx context.Context, pool *pgxpool.Pool) error {
	data, err := Load()
	if err != nil {
		return err
	}
	vocab := data.Vocab()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // 提交后是 no-op

	officialID, err := upsertOfficialUser(ctx, tx, data.OfficialUser)
	if err != nil {
		return err
	}
	if err := importIngredients(ctx, tx, officialID, data.Ingredients); err != nil {
		return err
	}
	if err := importGlassware(ctx, tx, data.Glassware); err != nil {
		return err
	}
	if err := importTechniques(ctx, tx, data.Techniques); err != nil {
		return err
	}
	if err := importTags(ctx, tx, data.Tags); err != nil {
		return err
	}
	for i := range data.ClassicRecipes {
		if err := importClassic(ctx, tx, officialID, vocab, &data.ClassicRecipes[i]); err != nil {
			return err
		}
	}

	// 计数对账：种子直插投影不走 Publish 事务，recipe_count 类冗余列
	// 不会被动维护。这里整表重算，幂等，天然收敛到真实值。
	if _, err := tx.Exec(ctx, `
		UPDATE ingredients SET recipe_count = (
			SELECT count(DISTINCT r.id) FROM recipe_ingredients ri
			JOIN recipes r ON r.id = ri.recipe_id
			WHERE ri.ingredient_id = ingredients.id AND r.status = 'published' AND r.deleted_at IS NULL
		)`); err != nil {
		return fmt.Errorf("重算原料配方数: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE users SET recipe_count = (
			SELECT count(*) FROM recipes r
			WHERE r.author_id = users.id AND r.status = 'published' AND r.deleted_at IS NULL
		)`); err != nil {
		return fmt.Errorf("重算用户配方数: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("提交事务: %w", err)
	}
	return nil
}

func upsertOfficialUser(ctx context.Context, tx pgx.Tx, u OfficialUser) (uuid.UUID, error) {
	// 先查后插而非 ON CONFLICT：唯一索引建在 lower(handle) 表达式上，
	// 种子是单线程启动逻辑，不需要并发安全的 upsert。
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE lower(handle) = lower($1)`, u.Handle).Scan(&id)
	if err == nil {
		if _, err := tx.Exec(ctx, `
			UPDATE users SET display_name = $2, email = $3, bio = $4, is_official = true
			WHERE id = $1`, id, u.DisplayName, u.Email, u.Bio); err != nil {
			return uuid.Nil, fmt.Errorf("更新官方账号: %w", err)
		}
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return uuid.Nil, fmt.Errorf("查询官方账号: %w", err)
	}

	id, err = uuid.NewV7()
	if err != nil {
		return uuid.Nil, fmt.Errorf("生成 UUIDv7: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, handle, display_name, email, bio, is_official, status)
		VALUES ($1, $2, $3, $4, $5, true, 'active')`,
		id, u.Handle, u.DisplayName, u.Email, u.Bio)
	if err != nil {
		return uuid.Nil, fmt.Errorf("创建官方账号: %w", err)
	}
	return id, nil
}

func importIngredients(ctx context.Context, tx pgx.Tx, officialID uuid.UUID, list []Ingredient) error {
	for _, ing := range list {
		_, err := tx.Exec(ctx, `
			INSERT INTO ingredients (id, name_zh, name_en, category, subcategory, abv, density, viz, is_official, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
			ON CONFLICT (id) DO UPDATE SET
				name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
				category = EXCLUDED.category, subcategory = EXCLUDED.subcategory,
				abv = EXCLUDED.abv, density = EXCLUDED.density, viz = EXCLUDED.viz,
				is_official = true, updated_at = now()`,
			ing.ID, ing.NameZh, ing.NameEn, ing.Category, ing.Subcategory, ing.ABV, ing.Density, ing.Viz, officialID)
		if err != nil {
			return fmt.Errorf("导入原料 %s: %w", ing.ID, err)
		}
		// 别名整表重建：seed.json 是别名的唯一真相源
		if _, err := tx.Exec(ctx, `DELETE FROM ingredient_aliases WHERE ingredient_id = $1`, ing.ID); err != nil {
			return fmt.Errorf("清空原料别名 %s: %w", ing.ID, err)
		}
		for _, a := range ing.Aliases {
			if _, err := tx.Exec(ctx, `
				INSERT INTO ingredient_aliases (ingredient_id, alias, lang) VALUES ($1, $2, $3)`,
				ing.ID, a.Alias, a.Lang); err != nil {
				return fmt.Errorf("导入原料别名 %s/%s: %w", ing.ID, a.Alias, err)
			}
		}
	}
	return nil
}

func importGlassware(ctx context.Context, tx pgx.Tx, list []Glass) error {
	for _, g := range list {
		_, err := tx.Exec(ctx, `
			INSERT INTO glassware (id, name_zh, name_en, capacity_ml, shape)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (id) DO UPDATE SET
				name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
				capacity_ml = EXCLUDED.capacity_ml, shape = EXCLUDED.shape, updated_at = now()`,
			g.ID, g.NameZh, g.NameEn, g.CapacityMl, g.Shape)
		if err != nil {
			return fmt.Errorf("导入杯型 %s: %w", g.ID, err)
		}
	}
	return nil
}

func importTechniques(ctx context.Context, tx pgx.Tx, list []Technique) error {
	for _, t := range list {
		_, err := tx.Exec(ctx, `
			INSERT INTO techniques (id, name_zh, name_en, icon_id, sort_order)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (id) DO UPDATE SET
				name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
				icon_id = EXCLUDED.icon_id, sort_order = EXCLUDED.sort_order`,
			t.ID, t.NameZh, t.NameEn, t.IconID, t.SortOrder)
		if err != nil {
			return fmt.Errorf("导入技法 %s: %w", t.ID, err)
		}
	}
	return nil
}

func importTags(ctx context.Context, tx pgx.Tx, list []Tag) error {
	for _, t := range list {
		_, err := tx.Exec(ctx, `
			INSERT INTO tags (id, name_zh, name_en, kind)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (id) DO UPDATE SET
				name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, kind = EXCLUDED.kind`,
			t.ID, t.NameZh, t.NameEn, t.Kind)
		if err != nil {
			return fmt.Errorf("导入标签 %s: %w", t.ID, err)
		}
	}
	return nil
}

func importClassic(ctx context.Context, tx pgx.Tx, officialID uuid.UUID, vocab *irv.Vocab, c *ClassicRecipe) error {
	// 种子配方必须通过全链路校验 —— 词表对不上、规则不过，说明 seed 数据坏了
	ir, res := irv.Check(c.IR, vocab)
	if !res.OK {
		return fmt.Errorf("经典配方 %q 未通过校验: %+v", c.Title, res.Errors)
	}
	derived := irv.ComputeDerived(ir, vocab)

	abvEst := any(nil)
	if derived.AbvEst != nil {
		abvEst = math.Round(*derived.AbvEst*10) / 10 // numeric(4,1)
	}
	totalMl := math.Round(*derived.TotalVolumeMl*10) / 10 // numeric(6,1)
	taste, err := json.Marshal(c.TasteProfile)
	if err != nil {
		return fmt.Errorf("序列化口味 %q: %w", c.Title, err)
	}

	var id uuid.UUID
	var inserted bool
	newID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("生成 UUIDv7: %w", err)
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO recipes (id, author_id, title, subtitle, description_md, lang,
			ir, ir_version, glass_id, method, family, source, is_canonical, classic_key,
			iba_category, status, abv_est, total_volume_ml, taste_profile, difficulty, published_at)
		VALUES ($1, $2, $3, $4, $5, $6,
			$7, 1, $8, $9, $10, 'classic', true, $11,
			$12, 'published', $13, $14, $15, $16, now())
		ON CONFLICT (classic_key) WHERE is_canonical DO UPDATE SET
			title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, description_md = EXCLUDED.description_md,
			lang = EXCLUDED.lang, ir = EXCLUDED.ir, glass_id = EXCLUDED.glass_id, method = EXCLUDED.method,
			family = EXCLUDED.family, is_canonical = true, classic_key = EXCLUDED.classic_key,
			iba_category = EXCLUDED.iba_category, abv_est = EXCLUDED.abv_est,
			total_volume_ml = EXCLUDED.total_volume_ml, taste_profile = EXCLUDED.taste_profile,
			difficulty = EXCLUDED.difficulty, updated_at = now()
		RETURNING id, (xmax = 0)`,
		newID, officialID, c.Title, c.Subtitle, c.DescriptionMd, c.Lang,
		c.IR, ir.Glass, ir.Method, c.Family, c.ClassicKey,
		c.IBACategory, abvEst, totalMl, taste, c.Difficulty).Scan(&id, &inserted)
	if err != nil {
		return fmt.Errorf("导入配方 %q: %w", c.Title, err)
	}

	// 版本历史只记首次（规范 §11 惰性迁移：种子迭代用 goose reset 重来）
	if inserted {
		if _, err := tx.Exec(ctx, `
			INSERT INTO recipe_revisions (recipe_id, version, ir, ir_version, title, editor_id, note)
			VALUES ($1, 1, $2, 1, $3, $4, '种子导入')`,
			id, c.IR, c.Title, officialID); err != nil {
			return fmt.Errorf("写入配方版本 %q: %w", c.Title, err)
		}
	}

	// 标签投影整表重建
	if _, err := tx.Exec(ctx, `DELETE FROM recipe_tags WHERE recipe_id = $1`, id); err != nil {
		return fmt.Errorf("清空配方标签 %q: %w", c.Title, err)
	}
	for _, tagID := range c.Tags {
		if _, err := tx.Exec(ctx, `
			INSERT INTO recipe_tags (recipe_id, tag_id) VALUES ($1, $2)`, id, tagID); err != nil {
			return fmt.Errorf("写入配方标签 %q/%s: %w", c.Title, tagID, err)
		}
	}

	// 原料投影整表重建（数据库设计 §recipe_ingredients：保存时由应用层重建）
	if _, err := tx.Exec(ctx, `DELETE FROM recipe_ingredients WHERE recipe_id = $1`, id); err != nil {
		return fmt.Errorf("清空配方原料投影 %q: %w", c.Title, err)
	}
	for pos, ref := range ir.Ingredients {
		var amountMl any
		if ml, ok := irv.RefToMl(ref); ok {
			amountMl = math.Round(ml*100) / 100 // numeric(8,2)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO recipe_ingredients (recipe_id, slot, ingredient_id, amount, unit, amount_ml, role, position)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			id, ref.Slot, ref.IngredientID, ref.Amount, ref.Unit, amountMl, ref.Role, pos); err != nil {
			return fmt.Errorf("写入配方原料投影 %q/%s: %w", c.Title, ref.Slot, err)
		}
	}
	return nil
}
