package irv

import (
	"encoding/json"
	"math"
	"os"
	"strings"
	"testing"
)

/* ────────────────────────── 黄金测试（与 TS 逐位一致） ────────────────────────── */

type goldenFile struct {
	Ingredients map[string]goldenIngredient `json:"ingredients"`
	Glassware   map[string]goldenGlass      `json:"glassware"`
	Cases       []goldenCase                `json:"cases"`
}

type goldenIngredient struct {
	ABV     *float64 `json:"abv"`
	Density *float64 `json:"density"`
}

type goldenGlass struct {
	CapacityMl float64 `json:"capacityMl"`
}

type goldenCase struct {
	Name        string          `json:"name"`
	IR          json.RawMessage `json:"ir"`
	ExpectedAbv *float64        `json:"expectedAbv"`
}

func loadGolden(t *testing.T) (*goldenFile, *Vocab) {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatalf("读取 golden.json: %v", err)
	}
	var gf goldenFile
	if err := json.Unmarshal(raw, &gf); err != nil {
		t.Fatalf("解析 golden.json: %v", err)
	}
	vocab := &Vocab{
		Ingredients:   make(map[string]IngredientMeta, len(gf.Ingredients)),
		GlassCapacity: make(map[string]float64, len(gf.Glassware)),
	}
	for id, ing := range gf.Ingredients {
		vocab.Ingredients[id] = IngredientMeta{ID: id, ABV: ing.ABV, Density: ing.Density}
	}
	for id, g := range gf.Glassware {
		vocab.GlassCapacity[id] = g.CapacityMl
	}
	return &gf, vocab
}

// TestGoldenAbv：gen-golden.ts 用 TS 实现算出的期望值，锁死 Go 侧一致性。
// 容差 1e-9（相对）—— 常数或公式漂移（如 ML_PER_OZ、稀释率）会立刻爆表。
func TestGoldenAbv(t *testing.T) {
	gf, vocab := loadGolden(t)
	for _, c := range gf.Cases {
		t.Run(c.Name, func(t *testing.T) {
			ir, res := Check(c.IR, vocab)
			if !res.OK {
				t.Fatalf("黄金用例未通过校验（它们都必须是合法配方）: %+v", res.Errors)
			}
			abv, ok := EstimateAbv(ir, vocab)
			if c.ExpectedAbv == nil {
				if ok {
					t.Fatalf("期望不可估算，实际得到 %v", abv)
				}
				return
			}
			if !ok {
				t.Fatalf("期望 ABV=%v，实际不可估算", *c.ExpectedAbv)
			}
			if math.Abs(abv-*c.ExpectedAbv) > 1e-9*math.Max(1, math.Abs(*c.ExpectedAbv)) {
				t.Fatalf("ABV 漂移: 期望 %v，实际 %v", *c.ExpectedAbv, abv)
			}
		})
	}
}

// TestGoldenDerived：总量 = 液体 + 冰融水，同样锁死。
func TestGoldenDerived(t *testing.T) {
	gf, vocab := loadGolden(t)
	byName := map[string]*goldenCase{}
	for i := range gf.Cases {
		byName[gf.Cases[i].Name] = &gf.Cases[i]
	}

	c := byName["daiquiri-硬摇12秒-25%稀释"]
	ir, _ := Check(c.IR, vocab)
	d := ComputeDerived(ir, vocab)
	// 60+25+15=100ml 液体，硬摇 12s → 25% 稀释 → 125ml
	if d.TotalVolumeMl == nil || math.Abs(*d.TotalVolumeMl-125) > 1e-9 {
		t.Fatalf("总量期望 125ml，实际 %v", d.TotalVolumeMl)
	}
	if d.AbvEst == nil || math.Abs(*d.AbvEst-19.2) > 1e-9 {
		t.Fatalf("ABV 期望 19.2，实际 %v", d.AbvEst)
	}

	c = byName["negroni-搅拌不计稀释"]
	ir, _ = Check(c.IR, vocab)
	d = ComputeDerived(ir, vocab)
	// STIR 不计稀释 → 90ml
	if d.TotalVolumeMl == nil || math.Abs(*d.TotalVolumeMl-90) > 1e-9 {
		t.Fatalf("总量期望 90ml，实际 %v", d.TotalVolumeMl)
	}
}

/* ────────────────────────── Schema 拒收 ────────────────────────── */

func TestCheckSchemaRejections(t *testing.T) {
	_, vocab := loadGolden(t)
	cases := []struct {
		name    string
		ir      string
		wantErr bool
		wantSub string // 期望的 code 或消息片段
	}{
		{
			name:    "不是JSON",
			ir:      `{`,
			wantErr: true,
			wantSub: "schema.invalid_json",
		},
		{
			name: "未知动作",
			ir: `{"schemaVersion":1,"glass":"coupe","method":"shaken",
				"ingredients":[{"slot":"i1","ingredientId":"rum-white","role":"base","unit":"ml","amount":60}],
				"steps":[{"id":"s1","action":"FLY_TO_MOON","target":"glass","items":["i1"]}]}`,
			wantErr: true,
			wantSub: "schema.no_branch",
		},
		{
			name: "多余字段",
			ir: `{"schemaVersion":1,"glass":"coupe","method":"shaken",
				"ingredients":[{"slot":"i1","ingredientId":"rum-white","role":"base","unit":"ml","amount":60,"oops":1}],
				"steps":[{"id":"s1","action":"ADD","target":"glass","items":["i1"]}]}`,
			wantErr: true,
			wantSub: "oops", // 死因穿透 anyOf：报 additional property，而非 no_branch
		},
		{
			name: "缺少必填",
			ir: `{"schemaVersion":1,"glass":"coupe","method":"shaken",
				"ingredients":[{"slot":"i1","ingredientId":"rum-white","role":"base","unit":"ml","amount":60}],
				"steps":[{"id":"s1","action":"ADD","target":"glass"}]}`,
			wantErr: true,
			wantSub: "items", // 死因穿透 oneOf：报 missing property
		},
		{
			name: "量词单位不匹配分支",
			ir: `{"schemaVersion":1,"glass":"coupe","method":"shaken",
				"ingredients":[{"slot":"i1","ingredientId":"rum-white","role":"base","unit":"top_up","amount":60}],
				"steps":[{"id":"s1","action":"ADD","target":"glass","items":["i1"]}]}`,
			wantErr: true,
			wantSub: "amount", // top_up 不许带 amount
		},
		{
			name: "方法枚举外取值",
			ir: `{"schemaVersion":1,"glass":"coupe","method":"teleported",
				"ingredients":[{"slot":"i1","ingredientId":"rum-white","role":"base","unit":"ml","amount":60}],
				"steps":[{"id":"s1","action":"ADD","target":"glass","items":["i1"]}]}`,
			wantErr: true,
			wantSub: "schema",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ir, res := Check([]byte(c.ir), vocab)
			if !c.wantErr {
				if !res.OK {
					t.Fatalf("期望通过，实际: %+v", res.Errors)
				}
				return
			}
			if res.OK {
				t.Fatal("期望拒收，实际通过")
			}
			if ir != nil {
				t.Fatal("结构非法时不应返回 IR")
			}
			if len(res.Errors) == 0 {
				t.Fatal("拒收时必须有 error 诊断")
			}
			hit := false
			for _, d := range res.Errors {
				if d.Code == c.wantSub || strings.Contains(d.Message, c.wantSub) {
					hit = true
					break
				}
			}
			if !hit {
				t.Fatalf("诊断里找不到 %q，实际: %+v", c.wantSub, res.Errors)
			}
		})
	}
}

/* ────────────────────────── 业务规则 ────────────────────────── */

func ruleIR() *IR {
	return &IR{
		SchemaVersion: 1,
		Glass:         "coupe",
		Method:        "shaken",
		Ingredients: []IngredientRef{
			{Slot: "i1", IngredientID: "rum-white", Role: "base", Unit: "ml", Amount: amountPtr(60)},
		},
		Steps: []Step{
			{ID: "s1", Action: "ADD", Target: "glass", Items: []string{"i1"}},
		},
	}
}

func amountPtr(v float64) *float64 { return &v }

func findDiag(res Result, severity, code string) bool {
	var list []Diagnostic
	if severity == "error" {
		list = res.Errors
	} else {
		list = res.Warnings
	}
	for _, d := range list {
		if d.Code == code {
			return true
		}
	}
	return false
}

func TestValidateRules(t *testing.T) {
	_, vocab := loadGolden(t)

	t.Run("slot重复", func(t *testing.T) {
		ir := ruleIR()
		ir.Ingredients = append(ir.Ingredients, IngredientRef{
			Slot: "i1", IngredientID: "lime-juice", Role: "souring", Unit: "ml", Amount: amountPtr(25),
		})
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "error", "slot.duplicate") {
			t.Fatalf("期望 slot.duplicate: %+v", res)
		}
	})

	t.Run("未知slot引用", func(t *testing.T) {
		ir := ruleIR()
		ir.Steps[0].Items = []string{"ghost"}
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "error", "ref.unknown_slot") {
			t.Fatalf("期望 ref.unknown_slot: %+v", res)
		}
	})

	t.Run("孤儿原料", func(t *testing.T) {
		ir := ruleIR()
		ir.Ingredients = append(ir.Ingredients, IngredientRef{
			Slot: "i2", IngredientID: "lime-juice", Role: "souring", Unit: "ml", Amount: amountPtr(25),
		})
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "error", "ref.orphan_ingredient") {
			t.Fatalf("期望 ref.orphan_ingredient: %+v", res)
		}
	})

	t.Run("空杯结束", func(t *testing.T) {
		ir := ruleIR()
		ir.Steps = []Step{
			{ID: "s1", Action: "ADD", Target: "shaker", Items: []string{"i1"}},
			{ID: "s2", Action: "STRAIN", From: "shaker", To: "secondary"},
		}
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "error", "flow.nothing_in_glass") {
			t.Fatalf("期望 flow.nothing_in_glass: %+v", res)
		}
	})

	t.Run("空源容器", func(t *testing.T) {
		ir := ruleIR()
		ir.Steps = []Step{
			{ID: "s1", Action: "STRAIN", From: "shaker", To: "glass"},
		}
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "error", "container.empty_source") {
			t.Fatalf("期望 container.empty_source: %+v", res)
		}
	})

	t.Run("词表外的原料", func(t *testing.T) {
		ir := ruleIR()
		ir.Ingredients[0].IngredientID = "unicorn-tears"
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "error", "vocab.unknown_ingredient") {
			t.Fatalf("期望 vocab.unknown_ingredient: %+v", res)
		}
	})

	t.Run("TOP_UP单位错误", func(t *testing.T) {
		ir := ruleIR()
		ir.Steps = append(ir.Steps, Step{ID: "s2", Action: "TOP_UP", Target: "glass", Items: []string{"i1"}})
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "error", "topup.wrong_unit") {
			t.Fatalf("期望 topup.wrong_unit: %+v", res)
		}
	})

	t.Run("ABV过高警告", func(t *testing.T) {
		ir := ruleIR()
		ir.Ingredients[0].IngredientID = "bourbon" // 45%，纯饮必超 40
		ir.Ingredients[0].Amount = amountPtr(90)
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "warn", "abv.too_high") {
			t.Fatalf("期望 abv.too_high: %+v", res.Warnings)
		}
	})

	t.Run("蛋清无干摇警告", func(t *testing.T) {
		ir := ruleIR()
		ir.Ingredients = append(ir.Ingredients, IngredientRef{
			Slot: "i2", IngredientID: "egg-white", Role: "texture", Unit: "ml", Amount: amountPtr(20),
		})
		ir.Steps = []Step{
			{ID: "s1", Action: "ADD", Target: "shaker", Items: []string{"i1", "i2"}},
			{ID: "s2", Action: "SHAKE", Target: "shaker", Intensity: "standard"},
			{ID: "s3", Action: "STRAIN", From: "shaker", To: "glass"},
		}
		res := ValidateIR(ir, vocab)
		if !findDiag(res, "warn", "foam.no_dry_shake") {
			t.Fatalf("期望 foam.no_dry_shake: %+v", res.Warnings)
		}
	})

	t.Run("vocab为nil时跳过词表检查", func(t *testing.T) {
		ir := ruleIR()
		ir.Ingredients[0].IngredientID = "unicorn-tears"
		res := ValidateIR(ir, nil)
		if findDiag(res, "error", "vocab.unknown_ingredient") {
			t.Fatal("vocab=nil 时不应报词表错误")
		}
	})
}

/* ────────────────────────── 单位换算 ────────────────────────── */

func TestToMl(t *testing.T) {
	cases := []struct {
		amount float64
		unit   string
		want   float64
	}{
		{50, "ml", 50},
		{2, "cl", 20},
		{2, "oz", 2 * MLPerOz},
		{3, "barspoon", 15},
		{2, "tsp", 10},
		{3, "dash", 3 * MLPerDash},
		{4, "drop", 4 * MLPerDrop},
	}
	for _, c := range cases {
		got, ok := ToMl(&c.amount, c.unit)
		// 相对容差 1e-12：常量折叠与运行时乘法在最后一位可能差 1 ulp（3×0.6）
		if !ok || math.Abs(got-c.want) > 1e-12*math.Max(1, c.want) {
			t.Errorf("ToMl(%v %s) = %v,%v；期望 %v,true", c.amount, c.unit, got, ok, c.want)
		}
	}
	if _, ok := ToMl(amountPtr(60), "top_up"); ok {
		t.Error("top_up 不可换算为毫升")
	}
	if _, ok := ToMl(nil, "ml"); ok {
		t.Error("nil amount 不可换算")
	}
}

/* ────────────────────────── 路径转换 ────────────────────────── */

func TestJsonPtrToPath(t *testing.T) {
	cases := []struct {
		in   []string
		want string
	}{
		{[]string{"ingredients", "0", "slot"}, "ingredients[0].slot"},
		{[]string{"steps", "3"}, "steps[3]"},
		{[]string{"glass"}, "glass"},
		{nil, ""},
	}
	for _, c := range cases {
		if got := jsonPtrToPath(c.in); got != c.want {
			t.Errorf("jsonPtrToPath(%v) = %q；期望 %q", c.in, got, c.want)
		}
	}
}
