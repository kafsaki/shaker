package irv

// 词表快照：发布校验与 ABV 估算需要的最小原料/杯型数据，由 store 从 DB 装载。

type IngredientMeta struct {
	ID      string
	ABV     *float64
	Density *float64
}

type Vocab struct {
	Ingredients   map[string]IngredientMeta
	GlassCapacity map[string]float64
}

func (v *Vocab) Ingredient(id string) (IngredientMeta, bool) {
	m, ok := v.Ingredients[id]
	return m, ok
}

func (v *Vocab) CapacityOf(glassID string) (float64, bool) {
	c, ok := v.GlassCapacity[glassID]
	return c, ok
}
