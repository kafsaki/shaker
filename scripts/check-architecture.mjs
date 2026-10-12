/**
 * 三条不许破的架构纪律的机器检查（README「三条不许破的纪律」/ AGENTS.md）。
 * 这三条靠自觉守了很久，破掉任何一条都会让后面的技术选型失去自由，所以进 CI。
 *
 *   1. animator-core 不 import 任何渲染 API —— tsconfig 的 lib 只给 ES2023，不给 DOM
 *   2. animator-core / animator-web 只许引 @shaker/recipe-ir/core，不许引 barrel
 *   3. compile() 是纯函数 —— 无 IO、无随机、无 Date.now()
 *
 * 退出码非 0 即违规，并逐条打印位置。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const violations = [];

/* ── 纪律 1：animator-core 的 lib 里不能出现 DOM ──
   （只管 animator-core：animator-web 就是 Canvas 渲染后端，本来就要 DOM） */
{
  const tsconfigPath = join(root, "packages", "animator-core", "tsconfig.json");
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  const lib = tsconfig.compilerOptions?.lib ?? [];
  for (const entry of lib) {
    if (String(entry).toUpperCase().includes("DOM")) {
      violations.push(`animator-core/tsconfig.json: lib 含 ${entry} —— 该包不能依赖任何渲染 API`);
    }
  }
}

/* ── 纪律 2：不许引 recipe-ir barrel（只许 /core）── */
const BARREL_RE = /from\s+["']@shaker\/recipe-ir(?:\/index(?:\.ts)?)?["']/;
// 测试文件不进产物，引 barrel 不影响 bundle（ADR-020 的实测差异只针对被交付的代码）
const isTest = (name) => /\.test\.ts$/.test(name);
for (const pkg of ["animator-core", "animator-web"]) {
  for (const file of walk(join(root, "packages", pkg, "src"))) {
    if (isTest(file.name)) continue;
    const src = stripComments(readFileSync(file.path, "utf8"));
    if (BARREL_RE.test(src)) {
      violations.push(`${pkg}/src/${file.name}: 引了 @shaker/recipe-ir barrel，必须改为 @shaker/recipe-ir/core`);
    }
  }
}

/* ── 纪律 3：compile() 纯度（扫 animator-core 全部非测试源码）── */
const IMPURE = [
  [/\bDate\.now\s*\(/, "Date.now()"],
  [/\bnew\s+Date\s*\(/, "new Date()"],
  [/\bMath\.random\s*\(/, "Math.random()"],
  [/\bperformance\.now\s*\(/, "performance.now()"],
  [/\bcrypto\.randomUUID\s*\(/, "crypto.randomUUID()"],
  [/\bprocess\.env\b/, "process.env"],
];
for (const file of walk(join(root, "packages", "animator-core", "src"))) {
  if (isTest(file.name)) continue;
  const src = stripComments(readFileSync(file.path, "utf8"));
  for (const [re, label] of IMPURE) {
    const line = src.split("\n").findIndex((l) => re.test(l));
    if (line >= 0) {
      violations.push(`animator-core/src/${file.name}:${line + 1}: 出现 ${label} —— compile() 必须是纯函数`);
    }
  }
}

if (violations.length > 0) {
  console.error("架构纪律检查未通过：\n");
  for (const v of violations) console.error("  ✗ " + v);
  console.error(`\n共 ${violations.length} 处。规则见 README「三条不许破的纪律」。`);
  process.exit(1);
}
console.log("架构纪律检查通过（三条）");

/* ── 工具 ── */

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith(".ts")) out.push({ name: entry, path });
  }
  return out;
}

/** 去掉行注释与块注释：纪律 3 的关键词会出现在解释性注释里，不剥掉就是误报。
    块注释用等量空白替换而非删除，这样报出的行号仍然是原文件的行号。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
