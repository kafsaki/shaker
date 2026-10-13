package agent

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kafsaki/shaker/apps/api/internal/vocab"
)

// Families 与 packages/recipe-ir/src/vocab.ts 的 FAMILIES 一致（Go 侧没有这份词表）。
var Families = map[string]string{
	"sour": "酸酒", "fizz_collins": "菲兹·柯林斯", "old_fashioned": "古典",
	"martini_duo": "马天尼型", "equal_parts": "等份型", "highball": "高球",
	"smash_julep": "捣压类", "punch_tiki": "潘趣·提基", "flip_creamy": "蛋奶类",
	"spritz_wine": "起泡·葡萄酒基", "hot": "热饮", "layered_shot": "分层·子弹",
}

// irSpec 是 Recipe IR 的精简说明，真相源是 packages/recipe-ir 的 zod schema；
// 写给模型看，求短而准，不求面面俱到。
const irSpec = `## Recipe IR（schemaVersion 1）
顶层：{"schemaVersion":1,"glass":杯型id,"method":手法,"servings":1,"ingredients":[...],"steps":[...]}，所有对象不允许出现未列出的字段。
- method：shaken / stirred / built / blended / thrown / swizzled / rolled / layered（仅作标记，动画由 steps 决定）
- id 一律小写短横线；槽位 slot 依次写 i1、i2…；步骤 id 依次写 s1、s2…

### ingredients（1–30 行）
{"slot":"i1","ingredientId":原料id,"role":角色,"unit":单位,"amount":数量,"note":可选说明,"optional":可选布尔}
- role：base 基酒 / modifier 调味酒 / sweetener 甜 / souring 酸 / bittering 苦精 / lengthener 补充液（苏打、汤力等）/ texture 质地（蛋清、奶油）/ rinse 洗杯 / garnish 装饰 / ice 冰
- unit 与 amount：ml、cl、oz 必填 amount（≤5000）；barspoon、tsp ≤50；dash、drop ≤100；piece、leaf、wedge、slice 必须是整数 ≤100；top_up（补满）、rim（杯口蘸边）、to_taste（适量）不能写 amount
- 每一行原料都必须在某个步骤里被用到，否则报 ref.orphan_ingredient
- 冰块不写进 ingredients，用 ICE 步骤表示

### steps（1–40 步，按 action 区分）
容器 target/from/to 取值：shaker 摇壶 / mixing_glass 调酒杯 / glass 出品杯 / blender 搅拌机 / secondary 第二个杯
每步都有 "id"，可选 "note"。items 是槽位数组（如 ["i1","i2"]）。
- CHILL 冰杯：target, method: ice_water|freezer
- RIM 杯口蘸边：target, material: 一个 unit 为 rim 的槽位, coverage: full|half
- RINSE 洗杯：target, items, discard: 布尔
- ADD 加入：target, items, pour?: sequential|simultaneous
- ICE 加冰：target, iceType: cube|large_cube|sphere|cracked|crushed|block|dry_ice, fill: 0–1
- MUDDLE 捣压：target, items, intensity: gentle|firm
- SHAKE 摇：target, durationSec, intensity: gentle|standard|hard, dryShake?: 布尔（蛋清类先干摇）
- STIR 搅拌：target, durationSec, revolutions?
- SWIZZLE 旋搅：target, durationSec（只用于杯里是碎冰 crushed 的酒；方冰长饮在杯里轻搅用 STIR）
- ROLL 滚动：from, to, times
- THROW 抛酒：from, to, times（1–10）, height?: low|high
- BLEND 打碎：target, durationSec, speed?: low|high
- STRAIN 滤冰倒出：from, to, strainer: hawthorne|julep|fine|none, double?: 布尔
- DUMP 整杯倒入：from, to
- TOP_UP 补满：target, items（槽位的 unit 必须是 top_up）
- FLOAT 漂浮：target, items, technique: over_spoon|gentle_pour
- GARNISH 装饰：target, position: rim|in_glass|float|skewer|side, items（装饰槽位）, prep?: twist|wheel|wedge|flag|dehydrated|expressed|slapped|none
- SPRITZ 喷雾：target, items, sprays?（1–10）
- FLAME 点火：target, subject?: garnish|surface|peel_oil, durationSec?
- SMOKE 烟熏：target, method?: smoking_gun|torched_wood|dry_ice, cover?: 布尔, durationSec?
- WAIT 静置：target, durationSec, reason?: settle|bloom|infuse
- durationSec 都是真实操作秒数（≤600）；GARNISH 也可以不写 items 改写 "garnishId": 装饰原料id，二者只能有一个

### 容器规则
- 倒出之前源容器里必须有东西；最后出品杯里必须有液体
- 摇和/搅拌前要先 ICE；从摇壶或调酒杯到出品杯用 STRAIN
- 直调（built）在 glass 里完成：ADD → ICE → TOP_UP 等
- 装饰放在最后`

const exampleSour = `{"schemaVersion":1,"glass":"coupe","method":"shaken","servings":1,
"ingredients":[{"slot":"i1","ingredientId":"rum-white","role":"base","unit":"ml","amount":60},
{"slot":"i2","ingredientId":"lime-juice","role":"souring","unit":"ml","amount":25},
{"slot":"i3","ingredientId":"simple-syrup","role":"sweetener","unit":"ml","amount":15},
{"slot":"i4","ingredientId":"lime-wheel","role":"garnish","unit":"piece","amount":1}],
"steps":[{"action":"CHILL","id":"s1","target":"glass","method":"freezer"},
{"action":"ADD","id":"s2","target":"shaker","items":["i1","i2","i3"]},
{"action":"ICE","id":"s3","target":"shaker","iceType":"cube","fill":0.8},
{"action":"SHAKE","id":"s4","target":"shaker","durationSec":12,"intensity":"hard"},
{"action":"STRAIN","id":"s5","from":"shaker","to":"glass","strainer":"hawthorne","double":true},
{"action":"GARNISH","id":"s6","target":"glass","items":["i4"],"position":"rim","prep":"wheel"}]}`

const exampleBuilt = `{"schemaVersion":1,"glass":"collins","method":"built","servings":1,
"ingredients":[{"slot":"i1","ingredientId":"mint-leaf","role":"garnish","unit":"leaf","amount":10},
{"slot":"i2","ingredientId":"lime-juice","role":"souring","unit":"ml","amount":25},
{"slot":"i3","ingredientId":"simple-syrup","role":"sweetener","unit":"ml","amount":20},
{"slot":"i4","ingredientId":"rum-white","role":"base","unit":"ml","amount":50},
{"slot":"i5","ingredientId":"soda-water","role":"lengthener","unit":"top_up"},
{"slot":"i6","ingredientId":"mint-sprig","role":"garnish","unit":"piece","amount":1}],
"steps":[{"action":"ADD","id":"s1","target":"glass","items":["i2","i3"]},
{"action":"MUDDLE","id":"s2","target":"glass","items":["i1"],"intensity":"gentle"},
{"action":"ADD","id":"s3","target":"glass","items":["i4"]},
{"action":"ICE","id":"s4","target":"glass","iceType":"crushed","fill":0.85},
{"action":"TOP_UP","id":"s5","target":"glass","items":["i5"]},
{"action":"SWIZZLE","id":"s6","target":"glass","durationSec":6},
{"action":"GARNISH","id":"s7","target":"glass","items":["i6"],"position":"in_glass","prep":"slapped"}]}`

const outputSpec = `## 输出
只输出一个 JSON 对象，不要 Markdown 代码块，不要解释：
{"reply": 给用户的一两句中文说明（做了什么取舍、哪些原料用了替代、需要用户确认什么）,
 "title": 酒名（经典酒用通行英文名，自创酒起个好名字）,
 "subtitle": 一行主要风味，如「金酒 · 金巴利 · 甜味美思」,
 "descriptionMd": 两三句中文介绍（来历、风味、适合场合），可用简单 Markdown,
 "family": 家族 id 或 null,
 "difficulty": 1–3（1 新手 / 2 进阶 / 3 高手）,
 "tasteProfile": {"sweet":0–5,"sour":0–5,"bitter":0–5,"strength":0–5},
 "tags": 标签 id 数组（只从标签表里选，0–5 个）,
 "ir": Recipe IR 对象}`

const rules = `## 硬性要求
1. ingredientId、glass、tags 只能使用下方词表里出现的 id，绝不编造；词表里没有的原料，换成最接近的一种，并在 reply 里说明替代关系
2. 用户描述不完整时按经典做法补全（用量、冰、杯型、装饰），量用 ml 为主
3. 用户要求修改已有配方时，在原配方基础上改，保留没被要求改动的部分，reply 里说清改了什么
4. 用户说的和调酒无关时，仍然输出 JSON，ir 给一杯合适的推荐，并在 reply 里礼貌说明
5. 未成年人或明显的过量饮酒请求：照常给配方但在 reply 里提醒适量饮酒`

// SystemPrompt 拼出系统提示：说明书 + 示例 + 词表。词表放最后且内容稳定，
// 上游的前缀缓存能命中整段说明书。
func SystemPrompt(v *vocab.Full) string {
	var b strings.Builder
	b.WriteString("你是 Shaker 调酒社区的酒保助手。用户用自然语言描述一杯酒（或要求修改当前配方），你把它写成结构化配方。\n\n")
	b.WriteString(irSpec)
	b.WriteString("\n\n### 示例：Daiquiri（摇和）\n")
	b.WriteString(exampleSour)
	b.WriteString("\n\n### 示例：Mojito（直调）\n")
	b.WriteString(exampleBuilt)
	b.WriteString("\n\n")
	b.WriteString(outputSpec)
	b.WriteString("\n\n")
	b.WriteString(rules)
	b.WriteString("\n\n")
	writeCatalog(&b, v)
	return b.String()
}

func writeCatalog(b *strings.Builder, v *vocab.Full) {
	b.WriteString("## 词表\n### 家族 family\n")
	fams := make([]string, 0, len(Families))
	for id := range Families {
		fams = append(fams, id)
	}
	sort.Strings(fams)
	for _, id := range fams {
		fmt.Fprintf(b, "%s %s；", id, Families[id])
	}

	b.WriteString("\n\n### 杯型 glass（id 中文名 容量ml）\n")
	for _, g := range v.Glassware {
		fmt.Fprintf(b, "%s %s %d；", g.ID, g.NameZh, g.CapacityMl)
	}

	b.WriteString("\n\n### 标签 tags\n")
	for _, t := range v.Tags {
		fmt.Fprintf(b, "%s %s；", t.ID, t.NameZh)
	}

	b.WriteString("\n\n### 原料 ingredientId（按类别，id 中文名/English）\n")
	byCat := map[string][]vocab.Ingredient{}
	var cats []string
	for _, ing := range v.Ingredients {
		if _, ok := byCat[ing.Category]; !ok {
			cats = append(cats, ing.Category)
		}
		byCat[ing.Category] = append(byCat[ing.Category], ing)
	}
	sort.Strings(cats)
	for _, c := range cats {
		fmt.Fprintf(b, "[%s] ", c)
		for i, ing := range byCat[c] {
			if i > 0 {
				b.WriteString("；")
			}
			fmt.Fprintf(b, "%s %s/%s", ing.ID, ing.NameZh, ing.NameEn)
		}
		b.WriteString("\n")
	}
}
