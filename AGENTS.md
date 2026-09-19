# Agent 工作约定

面向在这个仓库里工作的 AI agent。产品与架构决策见 `README.md` 与 `docs/00-决策记录.md`。

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

这三条都还**没有** CI 检查，靠自觉。加上是好事。

## 工具链约束

- **禁用 TS 参数属性**（`constructor(private x: T)`）、enum、namespace —— `node --experimental-strip-types` 是 strip-only 模式，遇到会直接报错。这个约束换来"纯 TS 包可被 node 直接跑测试、不需构建"。
- 本机路径：Node `D:\DevApps\NodeJS\node.exe`、Go `D:\DevApps\Go\bin\go.exe`、Git `D:\DevApps\Git\cmd\git.exe`
- `pnpm` 经 corepack 启用；esbuild 的安装脚本已在根 `package.json` 的 `pnpm.onlyBuiltDependencies` 里显式放行
- **Docker Desktop 已装**：`docker compose up -d` 起 Postgres 17 + MinIO（建桶 + 匿名读）。本机镜像源（轩辕）不支持 `latest` tag 之外的某些拉取——`minio/minio` 用带 `RELEASE.*` tag 的版本再补 `latest` 本地标签；`mc` 镜像拉不动，compose 里的 minio-init 已改用 minio 服务器镜像自带的 mc。
- **OpenAPI 是 code-first 单向流向（ADR-017）**：改了端点代码必须 `go run ./cmd/gen-openapi > schema/openapi.yaml`，禁止手改 yaml。

## 改动后必须跑

TS 侧：

```bash
# 逐包类型检查
cd packages/<pkg> && ../../node_modules/.bin/tsc --noEmit

# 测试（纯 TS，无需构建）
cd packages/recipe-ir     && node --experimental-strip-types --test src/ir.test.ts
cd packages/animator-core && node --experimental-strip-types --test src/compile.test.ts

# 改了 zod schema 后必须重新生成，否则 Go 侧校验会漂移
node --experimental-strip-types packages/recipe-ir/scripts/gen-schema.ts
```

Go 侧（`apps/api`）：

```bash
go build ./... && go vet ./... && go test ./...
go run ./cmd/gen-openapi > ../../schema/openapi.yaml   # 改了端点就必须重生成
```

e2e（对运行中的 API，需先 `docker compose up -d` + `go run ./cmd/api`）：

```bash
pwsh -NoProfile -File scripts/e2e-<域>.ps1   # auth/vocab/recipes/feed/users/menus/notify/media
```

坑：注册端点按 IP 限流 5 次/小时，反复跑 e2e 撞 429 属预期——限流器在内存里，重启 API 进程即重置。

## 诚实汇报

这个仓库里有一件**尚未真正验证**的东西，不要在报告里含糊过去：

- 动画的**观感**没有经过人眼确认 —— 能验证的只有数学正确性、seek 幂等、编译确定性

已经验证过、不用再打问号的：数据库迁移（goose 内嵌，启动自动执行）、全部 API 端点（8 套 e2e 脚本全绿）、媒体直传（真实 MinIO PUT/HEAD/匿名读）。改到这些时正常回归即可。
