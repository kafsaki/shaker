/**
 * ABV 估算的黄金测试用例（API 定义 §3）。
 *
 * 服务端必须自己算 ABV（筛选值不能信客户端），而算法必须与
 * packages/recipe-ir 的 estimateAbv 逐位一致——所以用同一份 IR
 * 在 TS 侧算出期望值，Go 测试对着这份文件断言。改 estimateAbv
 * 必须重跑本脚本，两侧一起红/一起绿。
 *
 * 产物：apps/api/internal/irv/testdata/golden.json
 * 运行：node --experimental-strip-types packages/recipe-ir/scripts/gen-golden.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RecipeIR, compileVessel, estimateAbv, type VocabLookup } from "../src/index.ts";
// seed 依赖 recipe-ir（不是反向），这里用相对路径避免 workspace 循环依赖
import { INGREDIENTS, VESSEL_LIST } from "../../seed/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../../apps/api/internal/irv/testdata/golden.json");

/* 用真实种子词表做 lookup，Go 侧拿着同样的数据断言 */
const vocab: VocabLookup = {
  ingredient: (id) => INGREDIENTS.find((i) => i.id === id),
  vessel: (id) => {
    const def = VESSEL_LIST.find((v) => v.id === id);
    return def ? compileVessel(def) : undefined;
  },
};

/* 用例刻意覆盖 estimateAbv 的全部分支 */
const cases: Array<{ name: string; ir: unknown }> = [
  {
    name: "daiquiri-硬摇12秒-25%稀释",
    ir: {
      schemaVersion: 1,
      glass: "coupe",
      method: "shaken",
      ingredients: [
        { slot: "i1", ingredientId: "rum-white", amount: 60, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "lime-juice", amount: 25, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", amount: 15, unit: "ml", role: "sweetener" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "shaker", items: ["i1", "i2", "i3"] },
        { id: "s2", action: "ICE", target: "shaker", iceType: "cube", fill: 0.8 },
        { id: "s3", action: "SHAKE", target: "shaker", durationSec: 12, intensity: "hard" },
        { id: "s4", action: "STRAIN", from: "shaker", to: "glass", strainer: "hawthorne" },
      ],
    },
  },
  {
    name: "negroni-搅拌不计稀释",
    ir: {
      schemaVersion: 1,
      glass: "rocks",
      method: "stirred",
      ingredients: [
        { slot: "i1", ingredientId: "gin-london-dry", amount: 30, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "campari", amount: 30, unit: "ml", role: "bittering" },
        { slot: "i3", ingredientId: "vermouth-rosso", amount: 30, unit: "ml", role: "modifier" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2", "i3"] },
        { id: "s2", action: "STIR", target: "glass", durationSec: 25 },
      ],
    },
  },
  {
    name: "whiskey-sour-干摇不计稀释",
    ir: {
      schemaVersion: 1,
      glass: "sour-glass",
      method: "shaken",
      ingredients: [
        { slot: "i1", ingredientId: "bourbon", amount: 50, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "lemon-juice", amount: 25, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", amount: 15, unit: "ml", role: "sweetener" },
        { slot: "i4", ingredientId: "egg-white", amount: 20, unit: "ml", role: "texture" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "shaker", items: ["i1", "i2", "i3", "i4"] },
        { id: "s2", action: "SHAKE", target: "shaker", durationSec: 10, intensity: "hard", dryShake: true },
        { id: "s3", action: "SHAKE", target: "shaker", durationSec: 12, intensity: "hard" },
        { id: "s4", action: "STRAIN", from: "shaker", to: "glass", strainer: "fine", double: true },
      ],
    },
  },
  {
    name: "oz与barspoon换算",
    ir: {
      schemaVersion: 1,
      glass: "martini",
      method: "stirred",
      ingredients: [
        { slot: "i1", ingredientId: "gin-london-dry", amount: 2, unit: "oz", role: "base" },
        { slot: "i2", ingredientId: "vermouth-rosso", amount: 1, unit: "barspoon", role: "modifier" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "mixing_glass", items: ["i1", "i2"] },
        { id: "s2", action: "STIR", target: "mixing_glass", durationSec: 30 },
        { id: "s3", action: "STRAIN", from: "mixing_glass", to: "glass", strainer: "julep" },
      ],
    },
  },
  {
    name: "top_up与dash-不计入液体",
    ir: {
      schemaVersion: 1,
      glass: "collins",
      method: "built",
      ingredients: [
        { slot: "i1", ingredientId: "rum-white", amount: 50, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "angostura", amount: 3, unit: "dash", role: "bittering" },
        { slot: "i3", ingredientId: "soda-water", unit: "top_up", role: "lengthener" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2"] },
        { id: "s2", action: "ICE", target: "glass", iceType: "cube", fill: 0.85 },
        { id: "s3", action: "TOP_UP", target: "glass", items: ["i3"] },
      ],
    },
  },
  {
    name: "无酒精-返回null",
    ir: {
      schemaVersion: 1,
      glass: "highball",
      method: "built",
      ingredients: [
        { slot: "i1", ingredientId: "orange-juice", amount: 120, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "soda-water", unit: "top_up", role: "lengthener" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "glass", items: ["i1"] },
        { id: "s2", action: "ICE", target: "glass", iceType: "cube", fill: 0.8 },
        { id: "s3", action: "TOP_UP", target: "glass", items: ["i2"] },
      ],
    },
  },
];

const out = {
  // 词表的最小快照（abv/density/容量），让 Go 测试自包含
  ingredients: Object.fromEntries(
    INGREDIENTS.map((i) => [i.id, { abv: i.abv ?? null, density: i.density ?? null }]),
  ),
  glassware: Object.fromEntries(VESSEL_LIST.map((v) => [v.id, { capacityMl: v.capacityMl }])),
  cases: cases.map((c) => {
    const ir = RecipeIR.parse(c.ir);
    const abv = estimateAbv(ir, vocab);
    return {
      name: c.name,
      ir: c.ir,
      expectedAbv: abv, // null 表示「无法估算」
    };
  }),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`已写出 ${outPath}（${cases.length} 个用例）`);
