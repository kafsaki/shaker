# Shaker 冷启动种子数据扩充 · 交付说明

**交付物**：`apps/api/internal/seed/data/seed.json`（单文件，API 启动时幂等导入）
**目标**：从 20 原料 + 5 经典扩充到 160~220 原料 / 40~60 经典，词表/杯型同步补齐。
**状态**：✅ 已完成并通过全链路校验（种子导入成功 + 部分抽查 ABV）。

---

## 一、条目数汇总

| 段 | 原 | 新增 | 现 | 目标 |
|---|---|---|---|---|
| `ingredients` | 20 | 148 | **169** | 160~220 ✓ |
| `classicRecipes` | 5 | 54 | **59** | 40~60 ✓ |
| `tags` | 10 | 20 | **30** | 25~35 ✓ |
| `glassware` | 6 | 10 | **16** | 补 nick-and-nora / flute / margarita / shot / tiki-mug / irish-coffee 等 |
| `techniques` / `officialUser` | 21 / 1 | — | 不变 | 按要求不动 |

---

## 二、数据规则遵循

- 所有 `id` 为小写 slug，无重复、无与既有 id 冲突。
- IR 完整走闭集枚举 + JSON Schema 结构校验 + `irv.ValidateIR` 业务规则：
  - unit/amount 组合（`top_up`/`rim`/`to_taste` 禁止 amount）
  - 引用完整性（无孤儿 slot，step 不引用未声明 slot）
  - 容器状态机（STRAIN 源必有内容、成品杯结尾必有酒）
  - `TOP_UP`→`top_up` 单位、`RIM`→`rim` 单位、`GARNISH` garnishId/items 二选一
  - 容量不爆杯、ABV 3~40%、蛋清配方带 `dryShake`
- 每条目 ≥2 个别名（中英）、`viz` 视觉字段齐、密度/酒精度按物理常识取真实值。
- 经典配比按 IBA 官方优先，数字化整到 5ml；`descriptionMd` 均为原创重写。

---

## 三、⚠️ 后端工程师必读的 3 个踩坑点

1. **`ibaCategory` 不允许写 `null`**
   Go 侧 `ClassicRecipe.IBACategory` 绑定为 `string`（非指针，见 `seed.go`）。
   JSON `null` 会被解码成空串 `""`，而 DB 约束：
   `CHECK (iba_category IS NULL OR iba_category IN ('unforgettable','contemporary','new_era'))`
   会拒绝空串 → 启动失败。**结论：种子里的每个经典必须填三者之一**，即便非官方 IBA 也填 `contemporary`（本任务 17 款非 IBA 经典已统一填 `contemporary`）。

2. **`GARNISH.prep` 词表以 `vocab.ts` 为准，不是 IR 规范文档**
   规范文档列了 `twisted / zested / flamed / grated…`，但 schema 真相源（`packages/recipe-ir/src/vocab.ts` → `recipe-ir.schema.json`）只允许：
   `twist | wheel | wedge | flag | dehydrated | expressed | slapped | none`
   `twisted`、`grated` 传进去会报 `value must be one of …`。本任务已统一改 `twist` / `none`。后续加数据务必以此 8 值闭集为准。

3. **`glassware` 扩容需要真实 `shape.profile`**
   已新增 10 款（nick-and-nora/flute/margarita/shot/tiki-mug/irish-coffee/copper-mug/julep-tin/hurricane/double-rocks），每款给了归一化剖面 + `capacityMl`（按真实容量）。新增杯型时记得给 `shape`，否则动画/液面计算会退化。

---

## 四、如何复现验证

```bash
# 1) JSON 合法性
node -e "JSON.parse(require('fs').readFileSync('apps/api/internal/seed/data/seed.json','utf8')); console.log('OK')"

# 2) 全链路（种子不合法会 fail loud）
cd apps/api
docker compose up -d postgres   # 若未运行
go run ./cmd/api
# 期望看到：迁移完成 → 「种子导入完成（幂等）」→ shaker-api 监听中

# 3) ABV 抽查（classicKey 为 slug 的路由是 /classics/{key}，不是 /recipes/{id}）
curl -s http://localhost:8080/api/v1/classics/margarita     # abvEst≈21.1
curl -s http://localhost:8080/api/v1/classics/dry-martini   # abvEst≈34.5
curl -s http://localhost:8080/api/v1/classics/negroni       # abvEst≈26.7
```
实际抽查结果：Margarita 21.1 / Dry Martini 34.5 / Negroni 26.7 / Last Word 25.4 / Espresso Martini 17.3 / Irish Coffee 8.6 —— 均落在 3~40% 合理区间。

---

## 五、遗留事项 / 备注

- **旧服务进程**：端口 8080 上仍有一个**改 seed 前编译的旧 `api.exe`**（PID 20468，go-build 缓存二进制）在跑。它从同一 Postgres 服务新数据，不影响验证，但若跑最新代码须先停掉再 `go run`。
- **IBA 徽章**：当前 17 款非 IBA 经典 `ibaCategory` 填了 `contemporary`。如果业务上「IBA 徽章」与「官方名单」严格挂钩，建议前端/后端以 `classicKey` 对 IBA 官方名单比对，而非仅依赖该字段。
- **后续迭代**：改种子后重启即生效（幂等 upsert）；若需重置计数冗余列，沿用现有启动时整表重算逻辑即可。