package irv

import "math"

// estimateAbv 与稀释的移植（physics.ts + validate.ts）。
// 常量与逻辑逐行对齐 TS 侧；黄金测试（testdata/golden.json）锁死一致性。

var shakeDilution = map[string]float64{
	"gentle":   0.15,
	"standard": 0.2,
	"hard":     0.25,
}

const shakeReferenceSec = 12.0

// shakeDilutionMl 湿摇的冰融水量。干摇（dryShake）无冰，不产生稀释。
func shakeDilutionMl(steps []Step, liquidMl float64) float64 {
	dilution := 0.0
	for i := range steps {
		s := &steps[i]
		if s.Action != "SHAKE" || (s.DryShake != nil && *s.DryShake) {
			continue
		}
		rate := shakeDilution["standard"]
		if r, ok := shakeDilution[s.Intensity]; ok {
			rate = r
		}
		duration := shakeReferenceSec
		if s.DurationSec != nil {
			duration = *s.DurationSec
		}
		dilution += liquidMl * rate * math.Min(1, duration/shakeReferenceSec)
	}
	return dilution
}

// EstimateAbv：abv_est = Σ(amountMl × abv) / (totalLiquidMl + dilutionMl)。
// 无法估算（无已知度数原料或无液体）时 ok=false。
func EstimateAbv(ir *IR, vocab *Vocab) (float64, bool) {
	alcoholMl := 0.0
	liquidMl := 0.0
	known := false

	for _, ref := range ir.Ingredients {
		ml, ok := RefToMl(ref)
		if !ok {
			continue
		}
		if ContributesToLiquidLevel(ref.Unit) {
			liquidMl += ml
		} else {
			continue
		}
		meta, found := vocab.Ingredient(ref.IngredientID)
		if found && meta.ABV != nil && *meta.ABV > 0 {
			alcoholMl += ml * (*meta.ABV / 100)
			known = true
		}
	}

	if !known || liquidMl <= 0 {
		return 0, false
	}
	dilutionMl := shakeDilutionMl(ir.Steps, liquidMl)
	return (alcoholMl / (liquidMl + dilutionMl)) * 100, true
}

// Derived 保存配方时的服务端派生值（API 定义 §3 第 3 步）。
type Derived struct {
	AbvEst        *float64 // 含冰融水稀释；不可估算为 nil
	TotalVolumeMl *float64 // 液体 + 冰融水
}

func ComputeDerived(ir *IR, vocab *Vocab) Derived {
	liquidMl := TotalLiquidMl(ir.Ingredients)
	dilutionMl := shakeDilutionMl(ir.Steps, liquidMl)
	total := liquidMl + dilutionMl
	if abv, ok := EstimateAbv(ir, vocab); ok {
		return Derived{AbvEst: &abv, TotalVolumeMl: &total}
	}
	return Derived{AbvEst: nil, TotalVolumeMl: &total}
}
