# Shaker · 调酒社区

结构化配方库 + 可视化调酒播放器 + UGC 社区。

差异点不是"又一个菜谱站"，而是**任何人写的配方都能自动生成一段调制动画** —— 配方以结构化 IR 存储，动画是 IR 的纯函数投影，没有一步需要人工逐配方编排。

需求原文：`D:\DEV\docs\调酒社区网站.md`

v1（需求 1~5）功能已实现。进度、待办与未验证项见 **[`docs/ROADMAP.md`](docs/ROADMAP.md)**。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/00-决策记录.md`](docs/00-决策记录.md) | ADR：每条决策的结论与理由 |
| [`docs/01-配方IR规范.md`](docs/01-配方IR规范.md) | Recipe IR：21 个动作、单位、物理与混色模型 |
| [`docs/02-数据库设计.md`](docs/02-数据库设计.md) | 表结构与冗余计数策略；DDL 在 `apps/api/db/migrations/` |
| [`docs/03-API定义.md`](docs/03-API定义.md) | 端点设计；机器可读的权威版本是生成的 `schema/openapi.yaml` |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 进度、待办、未验证项 —— **唯一**记录「还没做什么」的地方 |
| [`AGENTS.md`](AGENTS.md) | 在本仓库工作的规则（AI agent 与人都适用） |
| `docs/archive/` | 一次性过程文档，不随代码维护 |

---

## 跑起来

### 后端 API（Go）

```bash
docker compose up -d        # Postgres 17 + MinIO（建桶 + 匿名读）
cd apps/api
D:/DevApps/Go/bin/go.exe run ./cmd/api
# 监听 :8080。启动时自动做：goose 迁移 → 种子导入（全量 upsert，改 seed.json 后重启即生效；SHAKER_SEED=false 跳过）
```

**反复重启时建议构建到固定路径。** `go run` 每次把二进制编到 `%TEMP%` 下的随机路径，而 Windows 防火墙按程序路径放行，于是每次重启都会弹「是否允许访问网络」。固定路径只需放行一次，还省掉每次编译：

```bash
cd apps/api
go build -o bin/api.exe ./cmd/api   # 改了 Go 代码才需要这一步
./bin/api.exe                       # 只是重启：直接跑这个
```

`bin/` 已在 .gitignore 里。

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

### 动画原型（验证装置）

```bash
cd D:/DEV/apps/shaker
pnpm install
pnpm --filter @shaker/prototype build
node scripts/serve.mjs prototype
# 浏览器打开 http://localhost:5173/
```

### 前端（Nuxt 4 SPA）

```bash
# 前置：docker compose up -d + apps/api 的 go run ./cmd/api（devProxy 假定 API 在 :8080）
pnpm --filter @shaker/web dev
# 浏览器打开 http://localhost:3000/
```

原型不是产品代码，是**验证装置**，回答三个问题：

1. 自动生成的动画能看吗？（表现力）
2. 拖时间轴、单步回看正确吗？（seek 正确性）
3. **在中端安卓 WebView 里能稳住 60fps 吗？**（决定移动端框架，ADR-005）

第 3 问是它存在的主要理由 —— 页面右下角有帧率与绘制耗时读数。服务器监听 `0.0.0.0`，启动时会打印局域网地址，**用手机连同一 WiFi 打开那个地址实测**。稳 60fps → Capacitor + Ionic Vue；掉帧 → Expo + Skia。

改代码后：`pnpm --filter @shaker/prototype watch` 自动重建。

### 测试、类型检查与代码生成

```bash
# TS：纯 TS 包可以被 node 直接跑，不需要构建（见 ADR-021）
cd packages/recipe-ir     && node --experimental-strip-types --test src/ir.test.ts
cd packages/animator-core && node --experimental-strip-types --test src/compile.test.ts
pnpm -r typecheck          # 全部 TS 包 + 前端（nuxt typecheck）

# Go（在 apps/api 下）
go build ./... && go vet ./... && go test ./...
```

两条生成链都是单向的，生成物禁止手改：

```bash
# 改了 zod schema → 重新生成 JSON Schema（供 Go 校验），否则 Go 侧校验会漂移
node --experimental-strip-types packages/recipe-ir/scripts/gen-schema.ts

# 改了 API 端点 → 重新生成 OpenAPI（code-first，ADR-017）
cd apps/api && go run ./cmd/gen-openapi > ../../schema/openapi.yaml
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
  web/       Nuxt 4 SPA + Tailwind v4 + shadcn-vue + Pinia + vue-query
  api/       Go + chi + huma + pgx + goose + MinIO 预签名
             internal/seed/data/seed.json  ★ 种子数据唯一真相源（词表 + 经典配方，直接编辑，ADR-022）
  mobile/    二期，消费优先，框架待原型实测定
packages/
  recipe-ir/      ★ 配方 IR 唯一真相源：zod schema、校验、单位换算、混色、杯型物理
  animator-core/  ★ IR → Timeline 编译器（纯 TS，零渲染依赖）
  animator-web/     Canvas 2D 像素风绘制后端（ADR-024）
  visual-assets/    像素精灵 + 容器剖面，素材唯一来源（ADR-025）
  fixtures/         动画测试夹具（小词表 + 高风险路径配方 + asset_test 虚构配方）；不是种子
  api-client/       openapi-typescript 生成 + openapi-fetch 封装
schema/
  recipe-ir.schema.json   由 zod 生成 → Go go:embed 校验
  openapi.yaml            由 Go huma 生成 → 前端 client
scripts/
  e2e-*.ps1             对运行中 API 的端到端验证（8 套）
  classic-covers/       经典配方封面批量截帧导入（一次性工具，可幂等重跑）
prototype/        动画验证装置
docs/             设计文档 00~03、ROADMAP（进度与待办）、archive/（一次性过程文档）
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

这三条都应该在 CI 里加检查（见 ROADMAP）。

---

## 关键决策速查

| 项 | 结论 | ADR |
| --- | --- | --- |
| 后端 | Go 1.27 + chi + huma + pgx（v1 未引入 sqlc / river） | 003 |
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
| 种子数据 | `seed.json` 唯一真相源；`packages/fixtures` 只是测试夹具 | 022 |
| 配方标识 | base58 短号 `/r/{code}`，不用 slug | 023 |
| 渲染风格 | 低分辨率像素风 + Bayer 抖动 | 024 |
| 视觉素材 | 独立 `@shaker/visual-assets` 纯数据包 | 025 |

完整理由见 `docs/00-决策记录.md`。**理由比结论重要** —— 要推翻某条决策，先驳倒它的理由。

---

## 许可证

Copyright (C) 2026 kafsaki

本项目以 [GNU Affero General Public License v3.0](LICENSE)（`AGPL-3.0-only`）发布。

简言之：可以自由使用、修改、再分发，**包括把它部署成对外提供服务的网站** —— 但这种情况下必须以 AGPL-3.0 向该服务的用户公开完整的对应源代码（含修改）。

如需在不履行上述开源义务的前提下使用（闭源集成、商业授权），请联系作者：kafsaki.moe@outlook.com。
