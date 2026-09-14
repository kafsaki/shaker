/**
 * 从 zod 生成 JSON Schema，供 Go 后端 go:embed 校验（ADR-017）。
 *
 * IR 从 TS 流向 Go，API 从 Go 流向 TS —— 每个方向只有一个真相源。
 *
 * CI 里跑：
 *   pnpm gen:schema && git diff --exit-code schema/recipe-ir.schema.json
 * 漂移就红。
 *
 * 同一份产物写两处：仓库根 schema/（文档与前端引用）与 apps/api/internal/irv/
 * （go:embed 不能引用模块外路径，只能靠同脚本双写保证一致）。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RecipeIR, SCHEMA_VERSION } from "../src/ir.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outPaths = [
  resolve(here, "../../../schema/recipe-ir.schema.json"),
  resolve(here, "../../../apps/api/internal/irv/recipe-ir.schema.json"),
];

/**
 * `io: "input"` 是必须的，不是可选优化。
 *
 * 默认的 "output" 模式会把带 .default() 的字段（servings）标为 required ——
 * 那样客户端省略 servings 时 zod 会放行（填默认值），Go 却会拒收。
 * Go 校验的是**入站**数据，所以必须用 input 视角。
 *
 * 配套约定：**每个消费者都要经 zod 解析** IR，由 zod 统一填默认值。
 * Go 只负责把关结构，不负责补默认值（它不建模 IR）。
 */
const jsonSchema = z.toJSONSchema(RecipeIR, { target: "draft-2020-12", io: "input" });

const doc = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://shaker.local/schema/recipe-ir/v1.json",
  title: `Recipe IR v${SCHEMA_VERSION}`,
  description:
    "配方中间表示。由 packages/recipe-ir 的 zod schema 生成 —— 不要手改这个文件，改 zod 再跑 pnpm gen:schema。",
  ...jsonSchema,
};

for (const outPath of outPaths) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`已写出 ${outPath}`);
}

