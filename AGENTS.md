# Agent 工作约定

面向在这个仓库里工作的 AI agent。**这里只写规则**；怎么跑起来、测试与生成命令见 `README.md`「跑起来」，决策理由见 `docs/00-决策记录.md`。

## Git

**只在本地 commit，永不 push。** 推送由作者手动进行。

- 完成一个可独立验证的单元就提交一次（不要攒一大堆）
- 提交前跑通类型检查与测试，别提交红的状态
- 提交信息遵循 **Angular commit 规范**：`type(scope): subject`（2026-09-19 起生效）
  - type：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `build` 等
  - scope 可选（如 `api` / `web` / `ir` / `seed`）；subject 用祈使语气、一句话说清
  - 正文用中文，说明**为什么**，不只是改了什么
  - 例：`feat(web): add amber archive hero to classic recipe pages`
- 分支 `main`，远端 `git@github.com:kafsaki/shaker.git`
- 身份已配：`kafsaki` / `kafsaki.moe@outlook.com`

作者推送用：

```bash
cd D:/DEV/apps/shaker && D:/DevApps/Git/cmd/git.exe push
```

## 三条不许破的架构纪律

破掉任何一条，后面的技术选型自由就没了。详见 README。

1. **`animator-core` 不许 import 任何渲染 API。** 它的 `tsconfig.json` 里 `lib` 只给 `ES2023` 不给 `DOM`，从类型层面强制。
2. **`animator-core` / `animator-web` 只许引 `@shaker/recipe-ir/core`**，不许引 barrel 入口。实测差 7.5 倍 bundle 体积（107 KB → 14.3 KB gzip）。
3. **`compile()` 是纯函数。** 无 IO、无随机、无 `Date.now()`。任何"随机"必须来自显式 seed。配套：关键帧是完整场景快照（seek 为 O(1)）；粒子是 `t` 的纯函数（否则 seek 会跳变）。

这三条都还**没有** CI 检查，靠自觉（CI 已列入 ROADMAP）。

## 数据与生成物

- **种子数据只改 `apps/api/internal/seed/data/seed.json`**（ADR-022）。`packages/fixtures` 是动画测试夹具，不是种子，两者互不同步。
- **生成物禁止手改**：`schema/recipe-ir.schema.json`（改了 zod 必须重生成）、`schema/openapi.yaml`（改了端点必须重生成，ADR-017）。命令见 README「测试、类型检查与代码生成」。

## 改动后必须跑

按改动范围跑 README「测试、类型检查与代码生成」里对应的命令；动了 API 行为再跑对应的 `scripts/e2e-<域>.ps1`（需先起 Postgres/MinIO 与 API）。

坑：注册端点按 IP 限流 5 次/小时，反复跑 e2e 撞 429 属预期——限流器在内存里，重启 API 进程即重置。

## 工具链约束

- **禁用 TS 参数属性**（`constructor(private x: T)`）、enum、namespace —— `node --experimental-strip-types` 是 strip-only 模式，遇到会直接报错（ADR-021）。这个约束换来"纯 TS 包可被 node 直接跑测试、不需构建"。
- 本机路径：Node `D:\DevApps\NodeJS\node.exe`、Go `D:\DevApps\Go\bin\go.exe`、Git `D:\DevApps\Git\cmd\git.exe`
- `pnpm` 经 corepack 启用；esbuild 的安装脚本已在根 `package.json` 的 `pnpm.onlyBuiltDependencies` 里显式放行
- **Docker Desktop 已装**：`docker compose up -d` 起 Postgres 17 + MinIO（建桶 + 匿名读）。本机镜像源（轩辕）不支持 `latest` tag 之外的某些拉取——`minio/minio` 用带 `RELEASE.*` tag 的版本再补 `latest` 本地标签；`mc` 镜像拉不动，compose 里的 minio-init 已改用 minio 服务器镜像自带的 mc。
- **`nuxt typecheck` 可用**，`pnpm -r typecheck` 覆盖全部 TS 包与前端。输出里的 `[Vue] Resolve plugin path failed: vue-router/volar/sfc-route-blocks … ERR_PACKAGE_PATH_NOT_EXPORTED` 是 volar 插件路径告警，**不是类型错误**，看 exit code（2026-10-12 埋错验证：真实类型错误会报 TS 错误并以 EXIT=2 退出）。
- 本地起 API 要构建到固定路径，否则每次重启都弹防火墙（见 README）。

## 诚实汇报

已经验证过、不用再打问号的：数据库迁移（goose 内嵌，启动自动执行）、全部 API 端点（8 套 e2e 脚本全绿）、媒体直传（真实 MinIO PUT/HEAD/匿名读）。改到这些时正常回归即可。

**尚未验证的事项与未实现的功能都记在 `docs/ROADMAP.md`**，汇报时以它为准，不要含糊过去，也不要把未实现的东西当成已有。

## 文档归属

每类信息只有一个家，别在第二处复述 —— 复述的那份迟早过时。

| 信息 | 放在 |
| --- | --- |
| 项目是什么、怎么跑、命令 | `README.md` |
| 决策与理由 | `docs/00-决策记录.md`（ADR）；涉及待办时链接 ROADMAP，不自列清单 |
| 进度、待办、未验证项 | `docs/ROADMAP.md` |
| 工作规则 | `AGENTS.md` |
| 一次性的任务说明 / 交付报告 | `docs/archive/` |

完成一件 ROADMAP 里的事，就在同一个提交里把它从 ROADMAP 删掉。
