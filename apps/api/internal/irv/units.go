package irv

// 单位换算（units.ts + physics.ts 移植）。常量必须与 TS 侧完全一致，
// ABV 黄金测试依赖它们。

const (
	MLPerOz       = 29.5735
	MLPerCl       = 10.0
	MLPerBarSpoon = 5.0
	MLPerTsp      = 5.0
	MLPerDash     = 0.6
	MLPerDrop     = 0.05
)

type UnitKind string

const (
	UnitVolume      UnitKind = "volume"       // ml/cl/oz，全额计入液面
	UnitSpoon       UnitKind = "spoon"        // barspoon/tsp，按 5ml 折算
	UnitQuasiVolume UnitKind = "quasi_volume" // dash/drop，只贡献色调
	UnitCount       UnitKind = "count"        // piece/leaf/wedge/slice，固体
	UnitNoAmount    UnitKind = "no_amount"    // top_up/rim/to_taste
)

func UnitKindOf(unit string) UnitKind {
	switch unit {
	case "ml", "cl", "oz":
		return UnitVolume
	case "barspoon", "tsp":
		return UnitSpoon
	case "dash", "drop":
		return UnitQuasiVolume
	case "piece", "leaf", "wedge", "slice":
		return UnitCount
	default: // top_up / rim / to_taste
		return UnitNoAmount
	}
}

func RequiresAmount(unit string) bool        { return UnitKindOf(unit) != UnitNoAmount }
func RequiresIntegerAmount(unit string) bool { return UnitKindOf(unit) == UnitCount }
func ContributesToLiquidLevel(unit string) bool {
	k := UnitKindOf(unit)
	return k == UnitVolume || k == UnitSpoon
}

// ToMl 派生 amountMl；不可换算单位返回 false。
func ToMl(amount *float64, unit string) (float64, bool) {
	if amount == nil {
		return 0, false
	}
	switch unit {
	case "ml":
		return *amount, true
	case "cl":
		return *amount * MLPerCl, true
	case "oz":
		return *amount * MLPerOz, true
	case "barspoon":
		return *amount * MLPerBarSpoon, true
	case "tsp":
		return *amount * MLPerTsp, true
	case "dash":
		return *amount * MLPerDash, true
	case "drop":
		return *amount * MLPerDrop, true
	default:
		return 0, false
	}
}

func RefToMl(ref IngredientRef) (float64, bool) {
	return ToMl(ref.Amount, ref.Unit)
}

// TotalLiquidMl 计入液面的总液体量，不含冰融水与 top_up。
func TotalLiquidMl(refs []IngredientRef) float64 {
	sum := 0.0
	for _, r := range refs {
		if !ContributesToLiquidLevel(r.Unit) {
			continue
		}
		if ml, ok := RefToMl(r); ok {
			sum += ml
		}
	}
	return sum
}
