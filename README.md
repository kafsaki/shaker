# Shaker · 调酒社区

结构化配方库 + 可视化调酒播放器 + UGC 社区。

差异点不是"又一个菜谱站"，而是**任何人写的配方都能自动生成一段调制动画** —— 配方以结构化 IR 存储，动画是 IR 的纯函数投影，没有一步需要人工逐配方编排。

需求原文：`D:\DEV\docs\调酒社区网站.md`

---

## 当前状态

**已完成：后端 v1 功能全集（含 e2e 验证）。** 前端未动工。

| | 状态 |
| --- | --- |
| 决策记录（21 条 ADR） | ✅ `docs/00-决策记录.md` |
| 配方 IR 规范（21 个动作） | ✅ `docs/01-配方IR规范.md` |
| 数据库设计 + DDL | ✅ goose 内嵌迁移，启动自动执行，Up/Down 均经 e2e 验证 |
| API 定义 | ✅ `docs/03-API定义.md`，`schema/openapi.yaml` 由代码生成（ADR-017） |
| `packages/recipe-ir` | ✅ 53 个测试全绿 |
| `packages/animator-core` | ✅ 27 个测试全绿 |
| `packages/animator-web` | ✅ 类型检查通过，**动画观感未经人眼确认** |
| 动画原型 | ✅ 可跑，**等你打开看效果** |
| `apps/api`（Go） | ✅ v1 功能全集：认证/词表/配方/Feed/互动/用户/搜索/经典/酒单/通知/举报/媒体直传 |
| 种子数据 | ✅ 169 原料 + 59 经典配方（IBA 分类对齐 2024 官方编码），启动幂等导入 |
| e2e 验证 | ✅ 8 套 PowerShell 脚本（`scripts/e2e-*.ps1`），对运行中的 API 全绿 |
| `apps/web`（Nuxt） | ⬜ 未开始 |

---

## 跑起来

### 后端 API（Go）

```bash
docker compose up -d        # Postgres 17 + MinIO（建桶 + 匿名读）
cd apps/api
D:/DevApps/Go/bin/go.exe run ./cmd/api
# 监听 :8080。启动时自动做：goose 迁移 → 幂等种子导入（词表为空才导）
```

e2e 验证（对运行中的 API，PowerShell，可反复执行——每次注册随机新用户）：

```bash
pwsh -NoProfile -File scripts/e2e-auth.ps1      # 认证/刷新轮转/改密
pwsh -NoProfile -File scripts/e2e-vocab.ps1     # 词表/原料/杯型
pwsh -NoProfile -File scripts/e2e-recipes.ps1   # 配方 CRUD/发布校验/版本
pwsh -NoProfile -File scripts/e2e-feed.ps1      # Feed/计数
pwsh -NoProfile -File scripts/e2e-users.ps1     # 资料/关注/点赞页/分页
pwsh -NoProfile -File scripts/e2e-menus.ps1     # 酒单/分享/重排
pwsh -NoProfile -File scripts/e2e-notify.ps1    # 通知/举报
pwsh -NoProfile -File scripts/e2e-media.ps1     # 媒体预签名直传（需 MinIO）
```

注意：注册端点按 IP 限流 5 次/小时（限流器在内存里，重启 API 进程即重置）；反复跑 e2e 撞上 429 时重启服务即可。

改了端点代码后必须重新生成 spec（code-first 单向流向，禁止手改）：

```bash
cd apps/api && go run ./cmd/gen-openapi > ../../schema/openapi.yaml
```

### 动画原型（唯一现在能看的前端）

```bash
cd D:/DEV/apps/shaker
pnpm install
pnpm --filter @shaker/prototype build
node scripts/serve.mjs prototype
# 浏览器打开 http://localhost:5173/
```

原型不是产品代码，是**验证装置**，回答三个问题：

1. 自动生成的动画能看吗？（表现力）
2. 拖时间轴、单步回看正确吗？（seek 正确性）
3. **在中端安卓 WebView 里能稳住 60fps 吗？**（决定移动端框架，ADR-005）

第 3 问是它存在的主要理由 —— 页面右下角有帧率与绘制耗时读数。服务器监听 `0.0.0.0`，启动时会打印局域网地址，**用手机连同一 WiFi 打开那个地址实测**。稳 60fps → Capacitor + Ionic Vue；掉帧 → Expo + Skia。

改代码后：`pnpm --filter @shaker/prototype watch` 自动重建。

### 测试与类型检查

```bash
# 纯 TS 包可以被 node 直接跑，不需要构建（见 ADR-021）
cd packages/recipe-ir     && node --experimental-strip-types --test src/ir.test.ts
cd packages/animator-core && node --experimental-strip-types --test src/compile.test.ts

# 逐包类型检查
cd packages/<pkg> && ../../node_modules/.bin/tsc --noEmit
```

### 从 zod 重新生成 JSON Schema（供 Go 校验）

```bash
node --experimental-strip-types packages/recipe-ir/scripts/gen-schema.ts
```

### 数据库（手动迁移，日常开发不需要）

启动时 goose 已内嵌自动迁移；手动操作（如验证 Down）用：

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
DSN="postgres://shaker:shaker_dev@localhost:5432/shaker?sslmode=disable"
goose -dir apps/api/db/migrations postgres "$DSN" up
goose -dir apps/api/db/migrations postgres "$DSN" down   # Down 也要验，写了没跑过等于没写
```

---

## 目录结构

```
apps/
  web/       Nuxt 4 + Vue 3 + Tailwind + shadcn-vue + Pinia     [待建]
  api/       Go + chi + huma + pgx + goose + MinIO 预签名        [v1 功能全集]
  mobile/    二期，消费优先，框架待原型实测定
packages/
  recipe-ir/      ★ 配方 IR 唯一真相源：zod schema、校验、单位换算、混色、杯型物理
  animator-core/  ★ IR → Timeline 编译器（纯 TS，零渲染依赖）
  animator-web/     Canvas 2D 绘制后端
  seed/             词表与经典配方种子数据（TS 源 → 种子 JSON）
  api-client/       openapi-typescript 生成                     [待建]
  ui/               设计 token                                  [待建]
schema/
  recipe-ir.schema.json   由 zod 生成 → Go go:embed 校验
  openapi.yaml            由 Go huma 生成 → 前端 client          [已生成]
scripts/
  e2e-*.ps1             对运行中 API 的端到端验证（8 套）
prototype/        动画验证装置
docs/             设计文档
```

---

## 三条不许破的纪律

这三条是整个架构灵活性的来源。破掉任何一条，后面的选型自由就没了。

### 1. `animator-core` 不许 import 任何渲染 API

它的 `tsconfig.json` 里 `lib` 只给 `ES2023`，**不给 `DOM`** —— 从类型层面强制。这是"Web 用 Vue、移动端用 Skia 或 WebView"这些选择能并存的唯一原因（ADR-004、ADR-005）。

### 2. `animator-core` / `animator-web` 只许引 `@shaker/recipe-ir/core`

不许引 barrel 入口。实测差 **7.5 倍**：引 barrel 的只读播放 bundle 是 107 KB gzip，引 `/core` 是 14.3 KB。省的正是 99% 访客走的路径（ADR-020）。

### 3. `compile()` 是纯函数

无 IO、无随机、无 `Date.now()`。同一份 IR 在浏览器、Node、WebView 里必须产出**逐字节相同**的 Timeline。任何"随机"都必须来自显式 seed。

配套两条：

- **关键帧是完整场景快照，不是增量** → seek 是 O(1)，不需重放历史
- **粒子是 `t` 的纯函数** → 否则 seek 回退时粒子位置会跳变，拖时间轴的体验立刻崩坏

这三条都应该在 CI 里加检查，目前**还没加**。

---

## 下一步

按不可逆性排序（ADR-018），最该优先的是前两项：

1. **打开原型确认动画观感**，在手机 WebView 实测帧率 → 定移动端框架
2. `apps/web` 骨架：Nuxt 4 + 配方页 + 结构化编辑器（消费 `schema/openapi.yaml` 生成 client）
3. 孤儿媒体清理任务（未 commit 的 asset + 对象，契约预留了 river 周期任务位）
4. 三条架构纪律 + openapi 同步检查进 CI

---

## 关键决策速查

| 项 | 结论 | ADR |
| --- | --- | --- |
| 后端 | Go 1.27 + chi + huma + pgx/sqlc + river | 003 |
| 前端 | Nuxt 4 + Vue 3 + Tailwind + shadcn-vue | 004 |
| 移动端 | 二期，独立 UI，消费优先，框架待实测 | 005 |
| 基础设施 | v1 仅 Postgres + MinIO，无 Redis | 006 |
| AI（需求 6/7） | 二期，平台默认额度 + BYOK | 008 |
| 原料分类 | 14 类品类（挂原料）+ 10 种角色（挂关系） | 009 |
| 鸡尾酒分类 | 家族做主轴 + IBA 徽章 + 自由标签 | 010 |
| 双语 | 词表强制双语，UGC 单语带 `lang` | 011 |
| 搜索 | pg_trgm 主力 + 英文 tsvector | 012 |
| 配方变体 | classic_key 锚点 + derived_from 血缘 + Feed 层折叠 | 013 |
| 用量单位 | 原始值 + amountMl 双存 | 014 |
| 封面图 | 前端 canvas 截帧，预签名直传 | 015 |
| v1 范围 | 需求 1~5 | 016 |
| 渲染器 | Canvas 2D，不用 SVG | 019 |
| bundle | `recipe-ir/core` 零 zod 子入口 | 020 |

完整理由见 `docs/00-决策记录.md`。**理由比结论重要** —— 要推翻某条决策，先驳倒它的理由。
