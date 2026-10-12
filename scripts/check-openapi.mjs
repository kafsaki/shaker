/**
 * openapi.yaml 漂移检查：改了端点忘记重生成 spec 时，CI 必须红。
 * 生成链是单向的（ADR-017：Go huma code-first → schema/openapi.yaml → 前端 client），
 * 生成物禁止手改，所以这里只做「重新生成一遍，与仓库里的比对」。
 *
 * 不退化成 `git diff --exit-code` 是为了给出可操作的提示，并且不依赖 git 状态。
 * recipe-ir.schema.json 的同类检查是根 package.json 的 check:schema（那条本来就在）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const target = join(root, "schema", "openapi.yaml");

let generated;
try {
  generated = execFileSync("go", ["run", "./cmd/gen-openapi"], {
    cwd: join(root, "apps", "api"),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (err) {
  console.error("生成 openapi.yaml 失败：", err.message);
  process.exit(1);
}

// Windows 上 git 可能把仓库里的文件检出成 CRLF，比较前统一换行符
const normalize = (s) => s.replace(/\r\n/g, "\n");
const committed = readFileSync(target, "utf8");

if (normalize(generated) !== normalize(committed)) {
  console.error("schema/openapi.yaml 与代码不一致（端点改了但没重生成 spec）。\n");
  console.error("  cd apps/api && go run ./cmd/gen-openapi > ../../schema/openapi.yaml\n");
  console.error("生成物禁止手改，改完记得同步前端 client：pnpm --filter @shaker/api-client generate");
  process.exit(1);
}
console.log("openapi.yaml 与代码一致");
