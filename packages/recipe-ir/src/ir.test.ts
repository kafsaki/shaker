/**
 * 锁死 IR schema 与物理计算的关键行为。
 *
 * 这些不是凑数的测试 —— 每一条对应规范里一个「不这么做就会出事」的决定。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RecipeIR } from "./ir.ts";
import { displayAmount, toMl, toParts, totalLiquidMl, unitKind } from "./units.ts";
import {
  compileVessel,
  coneProfile,
  coupeProfile,
  cylinderProfile,
  heightForVolume,
  iceOccupancy,
  validateProfile,
  volumeForHeight,
  type VesselDef,
} from "./glass.ts";
import { hexToOklab, mixLiquidsHex, mixOklab, oklabToHex, dominantTexture, lerpOklab } from "./color.ts";
import { estimateAbv, validateRecipeIR, type VocabLookup } from "./validate.ts";

/* ══════════════════════════ 测试夹具 ══════════════════════════ */

const daiquiri = {
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
};

const VOCAB: VocabLookup = {
  ingredient(id) {
    const table: Record<string, { abv?: number; density?: number; color: string }> = {
      "rum-white": { abv: 40, density: 0.94, color: "#f5f0e6" },
      "lime-juice": { abv: 0, density: 1.03, color: "#d9e8a8" },
      "simple-syrup": { abv: 0, density: 1.26, color: "#f7f3e8" },
      grenadine: { abv: 0, density: 1.18, color: "#c0143c" },
      "soda-water": { abv: 0, density: 1.0, color: "#f2f7fa" },
      "egg-white": { abv: 0, density: 1.04, color: "#fdfcf8" },
      salt: { density: 2.16, color: "#ffffff" },
      "lime-wheel": { color: "#c8dd7a" },
    };
    const e = table[id];
    if (!e) return undefined;
    return { id, category: "spirit", abv: e.abv, density: e.density, viz: { color: e.color } };
  },
  glass(id) {
    const caps: Record<string, number> = { coupe: 180, highball: 300, rocks: 240, martini: 150 };
    const c = caps[id];
    return c === undefined ? undefined : { id, capacityMl: c };
  },
};

/* ══════════════════════════ Schema：unit / amount 约束 ══════════════════════════ */

test("合法配方能通过 schema", () => {
  const r = RecipeIR.safeParse(daiquiri);
  assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
});

test("servings 省略时由 zod 填默认值 1", () => {
  const r = RecipeIR.parse(daiquiri);
  assert.equal(r.servings, 1);
});

test("top_up 带 amount 必须被拒 —— ADR-014 的核心约束", () => {
  const bad = structuredClone(daiquiri) as Record<string, unknown>;
  (bad.ingredients as unknown[]).push({
    slot: "i4",
    ingredientId: "soda-water",
    unit: "top_up",
    amount: 100, // 违规：top_up 的量由编译期算，不能手填
    role: "lengthener",
  });
  assert.equal(RecipeIR.safeParse(bad).success, false);
});

test("top_up 不带 amount 是合法的", () => {
  const ok = structuredClone(daiquiri) as Record<string, unknown>;
  (ok.ingredients as unknown[]).push({
    slot: "i4",
    ingredientId: "soda-water",
    unit: "top_up",
    role: "lengthener",
  });
  (ok.steps as unknown[]).push({ id: "s5", action: "TOP_UP", target: "glass", items: ["i4"] });
  const r = RecipeIR.safeParse(ok);
  assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
});

test("计数单位的用量必须是整数", () => {
  const bad = structuredClone(daiquiri) as Record<string, unknown>;
  (bad.ingredients as unknown[]).push({
    slot: "i4",
    ingredientId: "lime-wheel",
    unit: "leaf",
    amount: 2.5, // 违规：半片薄荷叶没有意义
    role: "garnish",
  });
  assert.equal(RecipeIR.safeParse(bad).success, false);
});

test("体积单位缺 amount 必须被拒", () => {
  const bad = structuredClone(daiquiri) as Record<string, unknown>;
  (bad.ingredients as unknown[])[0] = {
    slot: "i1",
    ingredientId: "rum-white",
    unit: "ml",
    role: "base",
  };
  assert.equal(RecipeIR.safeParse(bad).success, false);
});

test("strict 模式拒绝未知字段（捕捉笔误）", () => {
  const bad = structuredClone(daiquiri) as Record<string, unknown>;
  (bad.ingredients as Record<string, unknown>[])[0]!.amoutn = 60; // 拼错
  assert.equal(RecipeIR.safeParse(bad).success, false);
});

test("未知动作必须被拒（闭集词表）", () => {
  const bad = structuredClone(daiquiri) as Record<string, unknown>;
  (bad.steps as unknown[]).push({ id: "s9", action: "SOUS_VIDE", target: "glass" });
  assert.equal(RecipeIR.safeParse(bad).success, false);
});

/* ══════════════════════════ 单位换算 ══════════════════════════ */

test("单位分类正确", () => {
  assert.equal(unitKind("ml"), "volume");
  assert.equal(unitKind("barspoon"), "spoon");
  assert.equal(unitKind("dash"), "quasi_volume");
  assert.equal(unitKind("leaf"), "count");
  assert.equal(unitKind("top_up"), "no_amount");
});

test("换算常数正确", () => {
  assert.equal(toMl(1, "oz"), 29.5735);
  assert.equal(toMl(2, "cl"), 20);
  assert.equal(toMl(1, "barspoon"), 5);
  assert.ok(Math.abs(toMl(2, "dash")! - 1.2) < 1e-9);
  assert.equal(toMl(3, "leaf"), null, "计数单位不可换算");
  assert.equal(toMl(undefined, "top_up"), null, "top_up 的量在编译期算");
});

test("总液量忽略 dash 与计数单位", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    ingredients: [
      { slot: "i1", ingredientId: "rum-white", amount: 60, unit: "ml", role: "base" },
      { slot: "i2", ingredientId: "lime-juice", amount: 2, unit: "dash", role: "bittering" },
      { slot: "i3", ingredientId: "lime-wheel", amount: 8, unit: "leaf", role: "garnish" },
    ],
    steps: [
      { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2"] },
      { id: "s2", action: "GARNISH", target: "glass", items: ["i3"], position: "in_glass" },
    ],
  });
  assert.equal(totalLiquidMl(ir.ingredients), 60, "只有 60ml 计入液面");
});

test("展示换算：原生单位等于偏好单位时零损失", () => {
  const ref = { slot: "i1", ingredientId: "x", amount: 45, unit: "ml", role: "base" } as const;
  const d = displayAmount(ref, "ml");
  assert.equal(d.text, "45 ml");
  assert.equal(d.approximate, false);
});

test("展示换算：ml → oz 吸附到 ¼ oz 并标 ≈", () => {
  // 22ml ≈ 0.744 oz → 最近的 ¼ 刻度是 ¾
  const ref = { slot: "i1", ingredientId: "x", amount: 22, unit: "ml", role: "base" } as const;
  const d = displayAmount(ref, "oz");
  assert.equal(d.text, "≈ ¾ oz");
  assert.equal(d.approximate, true);
  assert.match(d.exactHint!, /22 ml/);
});

test("展示换算：2 oz 在 oz 偏好下原样显示整数", () => {
  const ref = { slot: "i1", ingredientId: "x", amount: 2, unit: "oz", role: "base" } as const;
  assert.equal(displayAmount(ref, "oz").text, "2 oz");
});

test("展示换算：无量单位显示语义标签", () => {
  const ref = { slot: "i1", ingredientId: "x", unit: "top_up", role: "lengthener" } as const;
  assert.equal(displayAmount(ref, "ml").text, "补满");
  assert.equal(displayAmount(ref, "ml", "en").text, "top up");
});

test("按份：等份配方约简为 1:1:1 且判定为干净", () => {
  const { parts, clean } = toParts([30, 30, 30]);
  assert.deepEqual(parts, [1, 1, 1]);
  assert.equal(clean, true);
});

test("按份：45/20/15 比例不干净，不该给用户这个开关", () => {
  const { clean } = toParts([45, 20, 15]);
  assert.equal(clean, false, "3 : 1.33 : 1 毫无可读性");
});

/* ══════════════════════════ 杯型物理 ══════════════════════════ */

const coupeDef: VesselDef = {
  id: "coupe",
  nameZh: "碟形杯",
  nameEn: "Coupe",
  capacityMl: 180,
  shape: { profile: coupeProfile() },
};

const highballDef: VesselDef = {
  id: "highball",
  nameZh: "高球杯",
  nameEn: "Highball",
  capacityMl: 300,
  shape: { profile: cylinderProfile() },
};

const martiniDef: VesselDef = {
  id: "martini",
  nameZh: "马天尼杯",
  nameEn: "Martini",
  capacityMl: 150,
  shape: { profile: coneProfile() },
};

test("剖面校验能抓出坏数据", () => {
  assert.ok(validateProfile([{ y: 0, r: 0.5 }]).length > 0, "单点剖面无效");
  assert.ok(validateProfile([{ y: 0.1, r: 0.5 }, { y: 1, r: 0.5 }]).length > 0, "首点 y 必须为 0");
  assert.ok(validateProfile([{ y: 0, r: 0.5 }, { y: 0.9, r: 0.5 }]).length > 0, "末点 y 必须为 1");
  assert.ok(validateProfile([{ y: 0, r: 0 }, { y: 1, r: 0.5 }]).length > 0, "半径必须为正");
  assert.equal(validateProfile(coupeProfile()).length, 0);
});

test("体积 ⇄ 高度 往返一致", () => {
  for (const def of [coupeDef, highballDef, martiniDef]) {
    const v = compileVessel(def);
    for (const frac of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const ml = def.capacityMl * frac;
      const h = heightForVolume(v, ml);
      const back = volumeForHeight(v, h);
      assert.ok(
        Math.abs(back - ml) / def.capacityMl < 0.01,
        `${def.id} @ ${frac}: ${ml}ml → h=${h.toFixed(4)} → ${back.toFixed(2)}ml`,
      );
    }
  }
});

test("满杯时液面高度为 1，空杯为 0", () => {
  const v = compileVessel(coupeDef);
  assert.ok(Math.abs(heightForVolume(v, 180) - 1) < 1e-6);
  assert.equal(heightForVolume(v, 0), 0);
});

test("锥形杯的液面强非线性 —— 这正是不能用「体积/容量」偷懒的原因", () => {
  const martini = compileVessel(martiniDef);
  const h = heightForVolume(martini, 75); // 半杯容量
  assert.ok(h > 0.75, `马天尼杯装一半容量，液面应远高于杯高一半，实测 ${h.toFixed(3)}`);
});

test("直筒杯的液面接近线性", () => {
  const hb = compileVessel(highballDef);
  const h = heightForVolume(hb, 150);
  assert.ok(Math.abs(h - 0.5) < 0.06, `直筒杯半杯应接近 0.5，实测 ${h.toFixed(3)}`);
});

test("缩放系数让体积自洽", () => {
  const v = compileVessel(coupeDef);
  assert.ok(v.scale > 0);
  // 用 scale 反算总体积应等于 capacityMl
  const recomputed = Math.PI * v.private__total * v.scale ** 3;
  assert.ok(Math.abs(recomputed - 180) < 0.01, `反算得 ${recomputed.toFixed(3)}ml`);
});

test("冰的排水：满杯方冰可容液体约 40%", () => {
  const occ = iceOccupancy(240, "cube", 1.0);
  assert.ok(
    Math.abs(occ.liquidCapacityMl / 240 - 0.4) < 0.01,
    `实测 ${((occ.liquidCapacityMl / 240) * 100).toFixed(1)}%`,
  );
});

test("冰的排水：碎冰比方冰更密实，可容液体更少", () => {
  const cube = iceOccupancy(240, "cube", 1.0);
  const crushed = iceOccupancy(240, "crushed", 1.0);
  assert.ok(crushed.liquidCapacityMl < cube.liquidCapacityMl);
});

test("干冰不排水", () => {
  const occ = iceOccupancy(240, "dry_ice", 1.0);
  assert.equal(occ.solidMl, 0);
  assert.equal(occ.liquidCapacityMl, 240);
});

/* ══════════════════════════ 混色 ══════════════════════════ */

test("OKLab 往返一致", () => {
  for (const hex of ["#1b6fd6", "#c0143c", "#f5f0e6", "#000000", "#ffffff"]) {
    const back = oklabToHex(hexToOklab(hex));
    assert.equal(back.toLowerCase(), hex.toLowerCase());
  }
});

test("液体混合是减色：黄 + 蓝 → 绿", () => {
  const hex = mixLiquidsHex([
    { hex: "#ffd500", weight: 1 },
    { hex: "#0055ff", weight: 1 },
  ]);
  const [r, g, b] = channels(hex);
  assert.ok(g > r && g > b, `混出 ${hex}，绿通道应占优 (r=${r} g=${g} b=${b})`);
});

test("OKLab 平均不适合液体 —— 黄 + 蓝会抵消成中性色，这正是要分开两个函数的原因", () => {
  const hex = oklabToHex(
    mixOklab([
      { color: hexToOklab("#ffd500"), weight: 1 },
      { color: hexToOklab("#0055ff"), weight: 1 },
    ]),
  );
  const [r, g, b] = channels(hex);
  assert.ok(b >= g, `OKLab 平均得 ${hex}，黄蓝在 b 轴相反会抵消，不该出绿`);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 80, "结果偏中性");
});

test("液体混合不会塌成黑色（透射率下限在起作用）", () => {
  const hex = mixLiquidsHex([
    { hex: "#ff0000", weight: 1 },
    { hex: "#00ff00", weight: 1 },
    { hex: "#0000ff", weight: 1 },
  ]);
  const [r, g, b] = channels(hex);
  assert.ok(Math.max(r, g, b) > 20, `三原色减色混合得 ${hex}，应暗但不该是纯黑`);
});

test("液体混合按体积加权：大量透明基酒 + 少量深色利口酒 → 浅色", () => {
  const hex = mixLiquidsHex([
    { hex: "#f5f0e6", weight: 60 }, // 白朗姆
    { hex: "#c0143c", weight: 10 }, // 石榴糖浆
  ]);
  const [r, g, b] = channels(hex);
  assert.ok(r > g && r > b, `应偏红，实测 ${hex}`);
  assert.ok(r > 150, `大比例浅色基酒应让结果偏亮，实测 r=${r}`);
});

test("单一液体混合返回自身", () => {
  const hex = mixLiquidsHex([{ hex: "#1b6fd6", weight: 45 }]);
  assert.equal(hex.toLowerCase(), "#1b6fd6");
});

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

test("混色按体积加权", () => {
  const mostlyWhite = mixOklab([
    { color: hexToOklab("#ffffff"), weight: 90 },
    { color: hexToOklab("#000000"), weight: 10 },
  ]);
  assert.ok(mostlyWhite.L > 0.8, `90:10 白黑应偏亮，L=${mostlyWhite.L.toFixed(3)}`);
});

test("权重为 0 的原料不参与混色", () => {
  const a = mixOklab([{ color: hexToOklab("#ff0000"), weight: 1 }, { color: hexToOklab("#00ff00"), weight: 0 }]);
  assert.equal(oklabToHex(a).toLowerCase(), "#ff0000");
});

test("OKLab 插值用于颜色过渡：端点精确，中点居中", () => {
  const from = hexToOklab("#1b6fd6");
  const to = hexToOklab("#c0143c");
  assert.equal(oklabToHex(lerpOklab(from, to, 0)).toLowerCase(), "#1b6fd6");
  assert.equal(oklabToHex(lerpOklab(from, to, 1)).toLowerCase(), "#c0143c");
  const mid = lerpOklab(from, to, 0.5);
  assert.ok(mid.L > Math.min(from.L, to.L) && mid.L < Math.max(from.L, to.L));
});

test("OKLab 插值的 t 会被夹到 [0,1]", () => {
  const from = hexToOklab("#000000");
  const to = hexToOklab("#ffffff");
  assert.equal(oklabToHex(lerpOklab(from, to, -5)).toLowerCase(), "#000000");
  assert.equal(oklabToHex(lerpOklab(from, to, 5)).toLowerCase(), "#ffffff");
});

test("质地取最重的", () => {
  assert.equal(dominantTexture(["clear", "cloudy"]), "cloudy");
  assert.equal(dominantTexture(["cloudy", "creamy", "clear"]), "creamy");
  assert.equal(dominantTexture(["clear"]), "clear");
});

/* ══════════════════════════ 业务校验 ══════════════════════════ */

test("Daiquiri 通过全部业务校验", () => {
  const r = validateRecipeIR(RecipeIR.parse(daiquiri), VOCAB);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
});

test("抓出重复的 slot", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    ingredients: [
      { slot: "i1", ingredientId: "rum-white", amount: 60, unit: "ml", role: "base" },
      { slot: "i1", ingredientId: "lime-juice", amount: 25, unit: "ml", role: "souring" },
    ],
    steps: [
      { id: "s1", action: "ADD", target: "glass", items: ["i1"] },
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "slot.duplicate"));
});

test("抓出引用不存在的 slot", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    steps: [{ id: "s1", action: "ADD", target: "glass", items: ["i1", "i2", "i3", "i99"] }],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "ref.unknown_slot"));
});

test("抓出没被任何步骤使用的孤立原料", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    steps: [
      { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2"] }, // 漏了 i3
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "ref.orphan_ingredient"));
});

test("抓出源容器为空的 STRAIN", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    steps: [
      { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2", "i3"] },
      { id: "s2", action: "STRAIN", from: "mixing_glass", to: "glass" }, // 搅拌杯从没装过东西
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "container.empty_source"));
});

test("抓出酒没进成品杯就结束", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    steps: [
      { id: "s1", action: "ADD", target: "shaker", items: ["i1", "i2", "i3"] },
      { id: "s2", action: "SHAKE", target: "shaker", durationSec: 12 }, // 摇完就没了
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "flow.nothing_in_glass"));
});

test("抓出 TOP_UP 引用了非 top_up 单位的原料", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    ingredients: [
      ...daiquiri.ingredients,
      { slot: "i4", ingredientId: "soda-water", amount: 100, unit: "ml", role: "lengthener" },
    ],
    steps: [...daiquiri.steps, { id: "s5", action: "TOP_UP", target: "glass", items: ["i4"] }],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "topup.wrong_unit"));
});

test("抓出 GARNISH 同时给了 garnishId 和 items", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    steps: [
      ...daiquiri.steps,
      { id: "s5", action: "GARNISH", target: "glass", garnishId: "lime-wheel", items: ["i2"], position: "rim" },
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "garnish.ambiguous"));
});

test("抓出词表里不存在的原料", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    ingredients: [
      { slot: "i1", ingredientId: "unobtainium-bitters", amount: 60, unit: "ml", role: "base" },
    ],
    steps: [{ id: "s1", action: "ADD", target: "glass", items: ["i1"] }],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.errors.some((e) => e.code === "vocab.unknown_ingredient"));
});

test("警告：SWIZZLE 但没有碎冰", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    steps: [
      { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2", "i3"] },
      { id: "s2", action: "ICE", target: "glass", iceType: "cube", fill: 0.9 },
      { id: "s3", action: "SWIZZLE", target: "glass", durationSec: 8 },
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.warnings.some((w) => w.code === "swizzle.no_crushed_ice"));
  assert.equal(r.ok, true, "这只是警告，不该阻止发布");
});

test("警告：含蛋清但没有干摇段", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    ingredients: [
      ...daiquiri.ingredients,
      { slot: "i4", ingredientId: "egg-white", amount: 20, unit: "ml", role: "texture" },
    ],
    steps: [
      { id: "s1", action: "ADD", target: "shaker", items: ["i1", "i2", "i3", "i4"] },
      { id: "s2", action: "ICE", target: "shaker", iceType: "cube", fill: 0.8 },
      { id: "s3", action: "SHAKE", target: "shaker", durationSec: 12, intensity: "hard" },
      { id: "s4", action: "STRAIN", from: "shaker", to: "glass" },
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.warnings.some((w) => w.code === "foam.no_dry_shake"));
});

test("警告：FLOAT 的原料密度过高", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    ingredients: [
      ...daiquiri.ingredients,
      { slot: "i4", ingredientId: "grenadine", amount: 10, unit: "ml", role: "sweetener" },
    ],
    steps: [
      ...daiquiri.steps,
      { id: "s5", action: "FLOAT", target: "glass", items: ["i4"], technique: "over_spoon" },
    ],
  });
  const r = validateRecipeIR(ir, VOCAB);
  assert.ok(r.warnings.some((w) => w.code === "float.dense_ingredient"));
});

/* ══════════════════════════ ABV 估算 ══════════════════════════ */

test("ABV 估算计入冰融水稀释", () => {
  const ir = RecipeIR.parse(daiquiri);
  const abv = estimateAbv(ir, VOCAB)!;
  // 60ml @40% = 24ml 纯酒精；液体 100ml；硬摇 12s 稀释 25% → 125ml
  assert.ok(Math.abs(abv - 19.2) < 0.5, `实测 ${abv.toFixed(2)}%，期望约 19.2%`);
});

test("不算稀释会显著高估 —— 验证稀释确实在起作用", () => {
  const withShake = estimateAbv(RecipeIR.parse(daiquiri), VOCAB)!;
  const noShake = estimateAbv(
    RecipeIR.parse({
      ...daiquiri,
      steps: [
        { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2", "i3"] },
      ],
    }),
    VOCAB,
  )!;
  assert.ok(noShake > withShake * 1.2, `不摇 ${noShake.toFixed(1)}% vs 摇过 ${withShake.toFixed(1)}%`);
  assert.ok(Math.abs(noShake - 24) < 0.5, "不稀释时应为 24%");
});

test("干摇不产生稀释", () => {
  const dry = estimateAbv(
    RecipeIR.parse({
      ...daiquiri,
      steps: [
        { id: "s1", action: "ADD", target: "shaker", items: ["i1", "i2", "i3"] },
        { id: "s2", action: "SHAKE", target: "shaker", durationSec: 12, dryShake: true },
        { id: "s3", action: "STRAIN", from: "shaker", to: "glass" },
      ],
    }),
    VOCAB,
  )!;
  assert.ok(Math.abs(dry - 24) < 0.5, `干摇不该稀释，实测 ${dry.toFixed(2)}%`);
});

test("全无酒精原料时 ABV 返回 null", () => {
  const ir = RecipeIR.parse({
    ...daiquiri,
    ingredients: [
      { slot: "i1", ingredientId: "lime-juice", amount: 30, unit: "ml", role: "souring" },
      { slot: "i2", ingredientId: "simple-syrup", amount: 20, unit: "ml", role: "sweetener" },
    ],
    steps: [{ id: "s1", action: "ADD", target: "glass", items: ["i1", "i2"] }],
  });
  assert.equal(estimateAbv(ir, VOCAB), null);
});
