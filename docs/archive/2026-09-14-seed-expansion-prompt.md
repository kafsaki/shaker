# 任务：为鸡尾酒平台 Shaker 批量生成种子数据（AI 离线数据准备）

## 背景与目标

仓库：`d:\DEV\apps\shaker`。这是一个鸡尾酒社区平台，后端在 `apps/api`（Go），
种子数据是单文件 `apps/api/internal/seed/data/seed.json`，API 启动时幂等导入。

冷启动目标：约 150~250 个原料条目 + 30~80 款经典配方 IR。当前只有 20 原料 + 5 配方，
你的任务是**保留现有条目原样**，扩充到目标量级。配比是公开事实不涉版权，
但 descriptionMd 文字描述必须自己重写，不得照抄任何书籍/网站原文。

## 产出物

直接修改 `apps/api/internal/seed/data/seed.json`（文件会很大，分批写入，每批写完自查 JSON 合法）：

- `ingredients`：现有 20 个保留，扩充到 **160~220 个**
- `classicRecipes`：现有 5 个保留，扩充到 **40~60 款**（以 IBA 官方鸡尾酒名单为骨架，
  可补少量广为人知的非 IBA 经典，如 Penicillin、Paper Plane、Espresso Martini 属 IBA new_era 注意核对）
- `tags`：现有 10 个保留，扩充到 **25~35 个**（覆盖口味/场合/季节/风格）
- `glassware`：现有 6 个保留，可补 nick-and-nora、flute、margarita、shot、tiki-mug、irish-coffee 等
- `officialUser`、`techniques`：**不动**（21 个手法已齐）

开工前必读（按顺序）：
1. `apps/api/internal/seed/data/seed.json` —— 现有数据与格式范本
2. `packages/recipe-ir/src/vocab.ts` —— 全部闭集枚举的真相源
3. `packages/recipe-ir/src/ir.ts` —— 步骤对象的完整字段定义
4. `docs/01-配方IR规范.md` —— IR 规范与单位语义
5. `apps/api/internal/seed/seed.go` —— 导入逻辑（种子不合法会启动失败，fail loud）

## 数据格式（字段名一个都不能差）

### ingredients 元素

```json
{
  "id": "cointreau",              // 小写 slug，如 triple-sec、cointreau
  "nameZh": "君度",
  "nameEn": "Cointreau",
  "category": "liqueur",          // 闭集，见下
  "subcategory": null,            // 可选字符串，如 spirit 下可分 "whisky"/"brandy"
  "abv": 40,                      // 酒精度 %，非酒精饮料为 0，装饰物/固体为 null
  "density": 0.94,                // g/ml 相对密度；装饰物/固体为 null；糖浆类 1.1~1.3
  "viz": {
    "color": "#f7f3e4",           // 十六进制，取原料真实近似色
    "opacity": 0.9,               // 0~1
    "carbonated": false,          // 含气 true
    "viscosity": "low",           // low | medium | high
    "texture": "clear",           // clear | cloudy | creamy | foam
    "foaming": 0                  // 0~1，起泡性（蛋清=1）
  },
  "aliases": [
    { "alias": "君度橙酒", "lang": "zh" },
    { "alias": "triple sec", "lang": "en" }
  ]                               // 每个原料至少 2 个别名，中英都要有
}
```

### classicRecipes 元素

```json
{
  "title": "Margarita",
  "subtitle": "龙舌兰 · 君度 · 青柠",        // 一行短句，主料串
  "slug": "margarita",                       // 小写 slug，与 classicKey 一致
  "classicKey": "margarita",                 // 经典锚点键，slug 形式
  "ibaCategory": "contemporary",             // unforgettable | contemporary | new_era；非 IBA 为 null
  "family": "sour",                          // 闭集，见下
  "descriptionMd": "……",                     // 2~3 句中文重写描述，Markdown
  "lang": "zh",
  "tasteProfile": { "sweet": 2, "sour": 4, "bitter": 0, "strength": 3 },  // 各 0~5 整数
  "difficulty": 2,                           // 1~5
  "tags": ["refreshing", "sour", "summer"],  // 只能引用 tags 段里已有的 id
  "ir": { /* 见下 */ }
}
```

### IR（ir 字段）

```json
{
  "schemaVersion": 1,
  "glass": "coupe",                  // 只能引用 glassware 段已有的 id
  "method": "shaken",                // 闭集，见下
  "servings": 1,
  "ingredients": [
    { "slot": "i1", "ingredientId": "tequila-blanco", "role": "base", "unit": "ml", "amount": 50 },
    { "slot": "i2", "ingredientId": "lime-juice", "role": "souring", "unit": "ml", "amount": 25 },
    { "slot": "i5", "ingredientId": "soda-water", "role": "lengthener", "unit": "top_up" }
  ],
  "steps": [ /* 因 action 而异，字段定义见 ir.ts；下方给常用示例 */ ]
}
```

slot 命名：`i1`、`i2`…；step id：`s1`、`s2`…。

常用步骤示例（其余 action 见 `packages/recipe-ir/src/ir.ts`）：

```json
{ "action": "CHILL",   "id": "s1", "target": "glass", "method": "freezer" }
{ "action": "RIM",     "id": "s2", "target": "glass", "material": "i6", "coverage": "half" }
{ "action": "RINSE",   "id": "s3", "target": "glass", "items": ["i5"], "discard": true }
{ "action": "ADD",     "id": "s4", "target": "shaker", "items": ["i1", "i2"] }
{ "action": "ICE",     "id": "s5", "target": "shaker", "iceType": "cube", "fill": 0.8 }
{ "action": "MUDDLE",  "id": "s6", "target": "glass", "items": ["i3"], "intensity": "gentle" }
{ "action": "SHAKE",   "id": "s7", "target": "shaker", "durationSec": 12, "intensity": "hard", "dryShake": true }
{ "action": "STIR",    "id": "s8", "target": "glass", "durationSec": 25 }
{ "action": "STRAIN",  "id": "s9", "from": "shaker", "to": "glass", "strainer": "hawthorne", "double": true }
{ "action": "TOP_UP",  "id": "s10", "target": "glass", "items": ["i5"] }
{ "action": "FLOAT",   "id": "s11", "target": "glass", "items": ["i4"], "technique": "over_spoon" }
{ "action": "GARNISH", "id": "s12", "target": "glass", "garnishId": "lime-wheel", "position": "rim", "prep": "wheel" }
{ "action": "WAIT",    "id": "s13", "target": "glass", "durationSec": 20, "reason": "settle" }
```

## 闭集枚举（只能用这些值，一个都不能自造）

- `ingredients[].category`（14）：spirit | liqueur | amaro_bitter | fortified_wine |
  wine_beer | juice | syrup_sweetener | mixer | dairy_egg | coffee_tea | spice_herb |
  garnish | ice | other
- `role`（10）：base | modifier | sweetener | souring | bittering | lengthener | texture |
  rinse | garnish | ice
- `unit`（15）：ml | cl | oz | barspoon | tsp | dash | drop | piece | leaf | wedge |
  slice | top_up | rim | to_taste
- `action`（21）：CHILL | RIM | RINSE | ADD | ICE | MUDDLE | SHAKE | STIR | SWIZZLE |
  ROLL | THROW | BLEND | STRAIN | DUMP | TOP_UP | FLOAT | GARNISH | SPRITZ | FLAME |
  SMOKE | WAIT
- `family`（12）：sour | fizz_collins | old_fashioned | martini_duo | equal_parts |
  highball | smash_julep | punch_tiki | flip_creamy | spritz_wine | hot | layered_shot
- `method`（8）：shaken | stirred | built | blended | thrown | swizzled | rolled | layered
- `iceType`（7）：cube | large_cube | sphere | cracked | crushed | block | dry_ice
- `ibaCategory`（3）：unforgettable | contemporary | new_era
- `strainer`：hawthorne | julep | fine | none；`shakeIntensity`：gentle | standard | hard
- `muddleIntensity`：gentle | firm；`garnish.position`：rim | in_glass | float | skewer | side
- `garnish.prep`：wheel | wedge | expressed | flamed | zested | twisted | whole | slapped |
  grated | stuffed
- `viz.viscosity`：low | medium | high；`viz.texture`：clear | cloudy | creamy | foam
- `tags[].kind`：taste | occasion | season | other

## IR 业务规则（违反任何一条 error 级规则，API 启动直接失败）

1. **单位-用量组合**：ml/cl/oz/barspoon/tsp/dash/drop/piece/leaf/wedge/slice 必须带 `amount`
   （正数；计数单位必须正整数）；top_up/rim/to_taste **禁止**带 `amount`。
2. **引用完整**：步骤里引用的 slot 必须在 ingredients 里声明；每个声明的 slot 必须被至少
   一个步骤使用，不能有孤儿。
3. **TOP_UP** 引用的原料 unit 必须是 `top_up`；**RIM** 的 `material` 指向的原料 unit 必须是 `rim`。
4. **GARNISH** 必须且只能提供 `garnishId` 或 `items` 之一（二选一）。
5. **容器状态机**（按步骤顺序模拟）：STRAIN/DUMP/ROLL/THROW 的源容器在那一刻必须有内容
   （液体或冰）。比如不能在 ADD 之前 STRAIN。
6. **成品杯必须有酒**：步骤序列结束时 glass 里必须有内容。
7. **容量**：液体总量 + 冰 ≈ 不超过杯容量（coupe 180ml、rocks 240ml、highball 300ml、
   collins 350ml、martini 150ml、sour-glass 180ml，新增杯型按真实容量）。大杯配方别装进小杯。
8. **物理常识**：估算 ABV 应在 3~40% 之间（除非该经典确实极高/极低度）；
   含 texture 角色（蛋清等）的摇和配方应有一段 `dryShake: true`；
   SWIZZLE 通常要 crushed ice；FLOAT 的原料密度应 ≤1.06（否则沉底）。
9. **ABV/密度用真实值**：这是服务端 ABV 计算的输入。糖浆密度 1.1~1.3、果汁 ~1.03~1.05、
   利口酒按酒精度和含糖量给 0.95~1.1。

## ID 规范与冲突

- 全部 id 是小写 slug（`^[a-z0-9]+(-[a-z0-9]+)*$`，≤64 字符）。
- 不得与现有 id 冲突。现有 ingredient id：rum-white, gin-london-dry, tequila-blanco,
  bourbon, campari, angostura, vermouth-rosso, lime-juice, lemon-juice, orange-juice,
  simple-syrup, grenadine, soda-water, egg-white, mint-leaf, lime-wheel, orange-peel,
  orange-wheel, cherry, mint-sprig。现有 classicKey：daiquiri, negroni, tequila-sunrise,
  mojito, whiskey-sour。新增前先读一遍 seed.json 核对。
- 装饰物（青柠片、柠檬皮、橄榄、洋葱等）统一放 ingredients，`category: "garnish"`。
- 同类不同牌的基础料拆条目时保持克制：通用型给条目（triple-sec、dry-vermouth、
  rye-whiskey…），品牌型只给不可替代的（campari、cointreau 可以，gin 不要按品牌拆）。

## 内容要求

- nameZh 用大陆通用译名（金酒/味美思/君度/查特绿），nameEn 规范英文名。
- 别名覆盖常见叫法：中文译名变体 + 英文常用名/缩写（"gin"、"干金"、"barrel-aged"等）。
- 配方配比按权威来源（IBA 官方配比优先），数字取整到 5ml 或按 oz 换算后取整。
- descriptionMd 2~3 句，讲平衡结构、历史一句话或适饮场景，不要营销腔。
- tasteProfile 与配比一致（酸酒 sour≥3、等份苦饮 bitter≥3…）。
- tags 只引用最终 tags 列表里存在的 id。

## 验证（必做，不许跳过）

1. JSON 合法性：`node -e "JSON.parse(require('fs').readFileSync('apps/api/internal/seed/data/seed.json','utf8')); console.log('OK')"`
2. 全链路校验（种子不合法会启动失败）：
   ```
   cd apps/api
   docker compose up -d postgres   # 若未运行
   go run ./cmd/api                 # 看到「种子导入完成（幂等）」即通过，Ctrl+C 退出
   ```
   启动失败时按报错修数据再验，循环直到通过。
3. 抽查 3 款新配方的 ABV：`curl -s http://localhost:8080/api/v1/recipes/{slug}` 看 `abvEst`
   是否与常识相符（Daiquiri≈24%、Negroni≈24%、Martini≈30% 量级）。

## 汇报格式

完成后报告：各段条目数、新增经典名单（title + classicKey + family）、验证结果。
