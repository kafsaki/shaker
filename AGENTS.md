# Agent 工作约定

面向在这个仓库里工作的 AI agent。产品与架构决策见 `README.md` 与 `docs/00-决策记录.md`。

## Git

**只在本地 commit，永不 push。** 推送由作者手动进行。

- 完成一个可独立验证的单元就提交一次（不要攒一大堆）
- 提交前跑通类型检查与测试，别提交红的状态
- 提交信息用中文，正文说明**为什么**，不只是改了什么
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
- **本机没有 Docker** —— 数据库相关的东西改了也跑不起来，别假装验证过了

## 改动后必须跑的

```bash
# 逐包类型检查
cd packages/<pkg> && ../../node_modules/.bin/tsc --noEmit

# 测试（纯 TS，无需构建）
cd packages/recipe-ir     && node --experimental-strip-types --test src/ir.test.ts
cd packages/animator-core && node --experimental-strip-types --test src/compile.test.ts

# 改了 zod schema 后必须重新生成，否则 Go 侧校验会漂移
node --experimental-strip-types packages/recipe-ir/scripts/gen-schema.ts
```

## 诚实汇报

这个仓库里有两件**尚未真正验证**的东西，不要在报告里含糊过去：

- `apps/api/db/migrations/00001_init.sql` **从未在真实 Postgres 上执行**（本机无 Docker）
- 动画的**观感**没有经过人眼确认 —— 能验证的只有数学正确性、seek 幂等、编译确定性

改到这两块时，说清楚哪些验证了、哪些没有。
