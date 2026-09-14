package irv

import (
	"fmt"
	"math"
	"strings"
)

// 业务规则校验（validate.ts 移植，规范 §10）。
// JSON Schema 管结构，这里管语义：引用完整性、容器状态合法性、物理合理性。
// error 阻止发布；warn 只提示（草稿保存时 error 降级为 warn，API 定义 §3）。

var icePorosity = map[string]float64{
	"cube": 0.4, "large_cube": 0.45, "sphere": 0.48,
	"cracked": 0.35, "crushed": 0.28, "block": 0.5, "dry_ice": 1.0,
}

var iceDisplacesLiquid = map[string]bool{
	"cube": true, "large_cube": true, "sphere": true,
	"cracked": true, "crushed": true, "block": true, "dry_ice": false,
}

// iceOccupancy（glass.ts 移植）：
//
//	冰实体积     = capacityMl × fill × (1 − porosity)
//	可容液体上限 = capacityMl × (1 − fill × (1 − porosity))
func iceOccupancy(capacityMl float64, iceType string, fill float64) (solidMl, liquidCapacityMl float64) {
	if !iceDisplacesLiquid[iceType] {
		return 0, capacityMl
	}
	f := math.Max(0, math.Min(1, fill))
	porosity := icePorosity[iceType]
	solidFraction := f * (1 - porosity)
	return capacityMl * solidFraction, capacityMl * (1 - solidFraction)
}

// 工作容器容量（毫升）。成品杯的容量来自词表。
var workCapacity = map[string]float64{
	"shaker": 530, "mixing_glass": 600, "blender": 1200, "glass": 240, "secondary": 400,
}

type simContainer struct {
	liquidMl float64
	iceMl    float64
	iceTypes []string
}

func (c *simContainer) hasContent() bool { return c.liquidMl > 0 || c.iceMl > 0 }

// ValidateIR 跑全部业务规则。vocab 为 nil 时跳过词表相关检查（草稿阶段词表未定稿也允许保存）。
func ValidateIR(ir *IR, vocab *Vocab) Result {
	res := Result{OK: true}

	/* ── slot / step id 唯一性 ── */
	slotSet := make(map[string]bool, len(ir.Ingredients))
	for i, ref := range ir.Ingredients {
		if slotSet[ref.Slot] {
			res.add(errDiag("slot.duplicate",
				fmt.Sprintf("原料 slot %q 重复", ref.Slot), fmt.Sprintf("ingredients[%d].slot", i)))
		}
		slotSet[ref.Slot] = true
	}
	stepIDs := make(map[string]bool, len(ir.Steps))
	for i, s := range ir.Steps {
		if stepIDs[s.ID] {
			res.add(errDiag("step.duplicate_id",
				fmt.Sprintf("步骤 id %q 重复", s.ID), fmt.Sprintf("steps[%d].id", i)))
		}
		stepIDs[s.ID] = true
	}

	/* ── unit / amount 组合（schema 层已机器校验，这里给人看消息）── */
	for i, ref := range ir.Ingredients {
		path := fmt.Sprintf("ingredients[%d]", i)
		switch {
		case RequiresAmount(ref.Unit) && ref.Amount == nil:
			res.add(errDiag("unit.amount_required",
				fmt.Sprintf("单位 %q 必须填写用量", ref.Unit), path))
		case !RequiresAmount(ref.Unit) && ref.Amount != nil:
			res.add(errDiag("unit.amount_forbidden",
				fmt.Sprintf("单位 %q 不能带用量（实际量由系统计算或本身无量）", ref.Unit), path))
		case ref.Amount != nil && RequiresIntegerAmount(ref.Unit) && *ref.Amount != math.Trunc(*ref.Amount):
			res.add(errDiag("unit.amount_not_integer",
				fmt.Sprintf("单位 %q 的用量必须是整数", ref.Unit), path))
		}
	}

	/* ── 引用完整性 ── */
	bySlot := make(map[string]*IngredientRef, len(ir.Ingredients))
	for i := range ir.Ingredients {
		bySlot[ir.Ingredients[i].Slot] = &ir.Ingredients[i]
	}
	referenced := map[string]bool{}
	for i := range ir.Steps {
		s := &ir.Steps[i]
		for _, slot := range SlotsReferenced(s) {
			referenced[slot] = true
			if !slotSet[slot] {
				res.add(errDiag("ref.unknown_slot",
					fmt.Sprintf("步骤 %q 引用了不存在的原料 slot %q", s.ID, slot),
					fmt.Sprintf("steps[%d]", i)))
			}
		}
	}
	for i, ref := range ir.Ingredients {
		if !referenced[ref.Slot] {
			res.add(errDiag("ref.orphan_ingredient",
				fmt.Sprintf("原料 %q 没有被任何步骤使用（疑似笔误）", ref.Slot),
				fmt.Sprintf("ingredients[%d]", i)))
		}
	}

	/* ── 特定动作的 slot 单位要求 ── */
	for i := range ir.Steps {
		s := &ir.Steps[i]
		path := fmt.Sprintf("steps[%d]", i)
		if s.Action == "TOP_UP" {
			for _, slot := range s.Items {
				if ref, ok := bySlot[slot]; ok && ref.Unit != "top_up" {
					res.add(errDiag("topup.wrong_unit",
						fmt.Sprintf("TOP_UP 引用的原料 %q 单位必须是 top_up，当前是 %s", slot, ref.Unit), path))
				}
			}
		}
		if s.Action == "RIM" {
			if ref, ok := bySlot[s.Material]; ok && ref.Unit != "rim" {
				res.add(errDiag("rim.wrong_unit",
					fmt.Sprintf("RIM 的材料 %q 单位必须是 rim，当前是 %s", s.Material, ref.Unit), path))
			}
		}
		if s.Action == "GARNISH" {
			hasID := s.GarnishID != ""
			hasItems := len(s.Items) > 0
			if hasID == hasItems {
				res.add(errDiag("garnish.ambiguous",
					"GARNISH 必须且只能提供 garnishId 或 items 之一", path))
			}
		}
	}

	/* ── 词表存在性 ── */
	if vocab != nil {
		if _, ok := vocab.CapacityOf(ir.Glass); !ok {
			res.add(errDiag("vocab.unknown_glass",
				fmt.Sprintf("杯型 %q 不在词表中", ir.Glass), "glass"))
		}
		for i, ref := range ir.Ingredients {
			if _, ok := vocab.Ingredient(ref.IngredientID); !ok {
				res.add(errDiag("vocab.unknown_ingredient",
					fmt.Sprintf("原料 %q 不在词表中", ref.IngredientID),
					fmt.Sprintf("ingredients[%d].ingredientId", i)))
			}
		}
		for i := range ir.Steps {
			s := &ir.Steps[i]
			if s.Action == "GARNISH" && s.GarnishID != "" {
				if _, ok := vocab.Ingredient(s.GarnishID); !ok {
					res.add(errDiag("vocab.unknown_garnish",
						fmt.Sprintf("装饰物 %q 不在词表中", s.GarnishID),
						fmt.Sprintf("steps[%d].garnishId", i)))
				}
			}
		}
	}

	/* ── 容器状态模拟 ── */
	capacityOf := func(id string) float64 {
		if id == "glass" {
			if vocab != nil {
				if c, ok := vocab.CapacityOf(ir.Glass); ok {
					return c
				}
			}
			return workCapacity["glass"]
		}
		return workCapacity[id]
	}
	containers := map[string]*simContainer{}
	touch := func(id string) *simContainer {
		c, ok := containers[id]
		if !ok {
			c = &simContainer{}
			containers[id] = c
		}
		return c
	}

	addedDirectlyToGlass := false
	strainedIntoGlass := false

	for i := range ir.Steps {
		s := &ir.Steps[i]
		path := fmt.Sprintf("steps[%d]", i)

		if s.From != "" {
			if src, ok := containers[s.From]; !ok || !src.hasContent() {
				res.add(errDiag("container.empty_source",
					fmt.Sprintf("步骤 %q（%s）的源容器 %s 此时是空的", s.ID, s.Action, s.From), path))
			}
		}

		switch s.Action {
		case "ADD", "FLOAT", "RINSE":
			c := touch(s.Target)
			for _, slot := range s.Items {
				ref, ok := bySlot[slot]
				if !ok {
					continue
				}
				if ContributesToLiquidLevel(ref.Unit) {
					if ml, ok := RefToMl(*ref); ok {
						c.liquidMl += ml
					}
				}
			}
			if s.Action == "RINSE" && s.Discard != nil && *s.Discard {
				c.liquidMl = 0 // 涮杯倒掉多余，只留挂壁
			}
			if s.Action == "ADD" && s.Target == "glass" {
				addedDirectlyToGlass = true
			}
		case "ICE":
			c := touch(s.Target)
			fill := 0.0
			if s.Fill != nil {
				fill = *s.Fill
			}
			solid, _ := iceOccupancy(capacityOf(s.Target), s.IceType, fill)
			c.iceMl += solid
			c.iceTypes = append(c.iceTypes, s.IceType)
		case "TOP_UP":
			c := touch(s.Target)
			// 补满量在编译期算，这里只标记已满
			c.liquidMl = math.Max(c.liquidMl, capacityOf(s.Target)-c.iceMl)
		case "STRAIN":
			src := containers[s.From]
			if src == nil {
				src = &simContainer{}
			}
			dst := touch(s.To)
			dst.liquidMl += src.liquidMl
			src.liquidMl = 0 // 冰留在源容器
			if s.To == "glass" {
				strainedIntoGlass = true
			}
		case "DUMP":
			src := containers[s.From]
			if src == nil {
				src = &simContainer{}
			}
			dst := touch(s.To)
			dst.liquidMl += src.liquidMl
			dst.iceMl += src.iceMl
			dst.iceTypes = append(dst.iceTypes, src.iceTypes...)
			src.liquidMl, src.iceMl, src.iceTypes = 0, 0, nil
			if s.To == "glass" {
				strainedIntoGlass = true
			}
		case "ROLL", "THROW":
			src := containers[s.From]
			if src == nil {
				src = &simContainer{}
			}
			dst := touch(s.To)
			dst.liquidMl += src.liquidMl
			src.liquidMl = 0
			if s.To == "glass" {
				strainedIntoGlass = true
			}
		case "SWIZZLE":
			c := touch(s.Target)
			if !contains(c.iceTypes, "crushed") {
				res.add(warnDiag("swizzle.no_crushed_ice",
					"SWIZZLE 通常要求容器内有碎冰（crushed）", path))
			}
		default:
			if s.Target != "" {
				touch(s.Target)
			} else {
				touch("glass")
			}
		}
	}

	/* ── 必须以内容进入成品杯结束 ── */
	glass := containers["glass"]
	if glass == nil || !glass.hasContent() {
		res.add(errDiag("flow.nothing_in_glass",
			"步骤序列结束时成品杯是空的 —— 酒没有被倒进杯子里", "steps"))
	}
	if addedDirectlyToGlass && strainedIntoGlass {
		res.add(warnDiag("flow.double_target_glass",
			"既直接往成品杯加料、又从别的容器滤入成品杯（疑似笔误）", "steps"))
	}

	/* ── 容量 ── */
	if glass != nil && vocab != nil {
		cap := capacityOf("glass")
		if glass.liquidMl+glass.iceMl > cap*1.02 {
			res.add(warnDiag("capacity.overflow",
				fmt.Sprintf("总量约 %dml，超过 %s 的 %dml 容量",
					int(math.Round(glass.liquidMl+glass.iceMl)), ir.Glass, int(cap)),
				"steps"))
		}
	}

	/* ── 蛋清配方通常需要干摇 ── */
	hasTextureRole := false
	for _, r := range ir.Ingredients {
		if r.Role == "texture" {
			hasTextureRole = true
			break
		}
	}
	if hasTextureRole {
		hasShake, hasDry := false, false
		for _, s := range ir.Steps {
			if s.Action != "SHAKE" {
				continue
			}
			hasShake = true
			if s.DryShake != nil && *s.DryShake {
				hasDry = true
			}
		}
		if hasShake && !hasDry {
			res.add(warnDiag("foam.no_dry_shake",
				"含蛋清/泡沫剂的配方通常需要一段干摇（SHAKE + dryShake）来起泡", "steps"))
		}
	}

	/* ── FLOAT 的密度合理性 ── */
	if vocab != nil {
		for i := range ir.Steps {
			s := &ir.Steps[i]
			if s.Action != "FLOAT" {
				continue
			}
			for _, slot := range s.Items {
				ref, ok := bySlot[slot]
				if !ok {
					continue
				}
				meta, found := vocab.Ingredient(ref.IngredientID)
				if found && meta.Density != nil && *meta.Density > 1.06 {
					res.add(warnDiag("float.dense_ingredient",
						fmt.Sprintf("%q 密度 %s 偏高，浮层可能自己沉下去 —— 确认是否真要 FLOAT",
							ref.IngredientID, trimFloat(*meta.Density)),
						fmt.Sprintf("steps[%d]", i)))
				}
			}
		}
	}

	/* ── ABV 合理性 ── */
	if vocab != nil {
		if abv, ok := EstimateAbv(ir, vocab); ok {
			switch {
			case abv > 40:
				res.add(warnDiag("abv.too_high",
					fmt.Sprintf("估算酒精度约 %.1f%%，偏高，确认用量是否填错", abv), "ingredients"))
			case abv > 0 && abv < 3:
				res.add(warnDiag("abv.too_low",
					fmt.Sprintf("估算酒精度约 %.1f%%，偏低，确认用量是否填错", abv), "ingredients"))
			}
		}
	}

	res.OK = len(res.Errors) == 0
	return res
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func trimFloat(f float64) string {
	s := fmt.Sprintf("%.3g", f)
	return strings.TrimRight(strings.TrimRight(s, "0"), ".")
}
