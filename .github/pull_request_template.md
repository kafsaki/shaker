<!--
标题沿用 Angular 规范：type(scope): subject，与提交信息一致（见 AGENTS.md「Git」）。
多个提交按功能拆分的 PR，合并时用 Rebase and merge 或 merge commit，不要 squash。
用不上的小节直接删掉。
-->

## 为什么

<!-- 要解决什么问题、为什么现在做。只写改了什么不够。 -->

## 改了什么

<!-- 按功能列；有对应决策的写上 ADR 编号（docs/00-决策记录.md）。 -->

| 改动 | ADR | 提交 |
| --- | --- | --- |
|  |  |  |

## 部署注意

<!-- 没有就写「无」。 -->

- 数据库迁移：<!-- 新增的 apps/api/db/migrations/*.sql；只加列/建表，还是会改写或删除数据 -->
- 环境变量：<!-- 新增或改了默认值的 SHAKER_*；deploy/.env.example 与 docker-compose.yml 是否已同步 -->
- 种子数据：<!-- 是否改了 apps/api/internal/seed/data/seed.json -->

## 检查

<!-- 按改动范围勾选；没跑的不要勾，在下面写原因。 -->

- [ ] `pnpm -r typecheck` 与 `pnpm -r test` 通过
- [ ] `go vet ./...` 与 `go test ./...` 通过（动了 `apps/api`）
- [ ] `pnpm check` 通过：三条架构纪律、schema 漂移
- [ ] 生成物已重新生成，没有手改：`schema/recipe-ir.schema.json`、`schema/openapi.yaml`
- [ ] 改了 API 行为时，对应的 `scripts/e2e-<域>.ps1` 已跑通
- [ ] 改了界面或动画时，已看过截图或在浏览器里过了一遍
- [ ] 密钥、令牌只在环境变量里，没有进 diff，也不会打进前端 bundle

<!-- 手工验证了什么、怎么验证的，写在这里。 -->

## 遗留

<!-- 没做完的、没验证的，记进 docs/ROADMAP.md，这里只列条目。
     完成了 ROADMAP 里的某项，就在本 PR 里把它从 ROADMAP 删掉。 -->

-
