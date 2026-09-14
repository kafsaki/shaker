/**
 * 原型用的假词表与配方。
 *
 * 物理值（密度、粘度、ABV）都按真实数据填，颜色按实际观感取 ——
 * 这批数据之后会直接 graduate 成种子数据（ADR-016 的冷启动内容）。
 *
 * 五个配方刻意覆盖动画里风险最高的五条路径：
 *   Daiquiri        摇 → 探（冰）→ 滤
 *   Negroni         杯中直调 + 大冰 + 搅拌（保持清澈）
 *   Tequila Sunrise 密度分层（grenadine 沉底渐变）
 *   Mojito          捣压 + 碎冰 + 气泡补满
 *   Whiskey Sour    干摇起泡 + 湿摇 + 泡沫冠
 */
import {
  compileVessel,
  coneProfile,
  coupeProfile,
  type IngredientMeta,
  type ProfilePoint,
  type RecipeIR,
  type VesselDef,
  type VesselSpec,
} from "@shaker/recipe-ir";
import { RecipeIR as RecipeIRSchema } from "@shaker/recipe-ir";

/* ══════════════════════════ 原料 ══════════════════════════ */

interface Ing extends IngredientMeta {
  nameZh: string;
  nameEn: string;
}

function ing(
  id: string,
  nameZh: string,
  nameEn: string,
  category: string,
  color: string,
  o: {
    abv?: number;
    density?: number;
    viscosity?: "low" | "medium" | "high";
    texture?: "clear" | "cloudy" | "creamy" | "foam";
    carbonated?: boolean;
    opacity?: number;
    foaming?: number;
    particle?: string | null;
  } = {},
): Ing {
  return {
    id,
    nameZh,
    nameEn,
    category,
    abv: o.abv,
    density: o.density,
    viz: {
      color,
      opacity: o.opacity ?? 0.9,
      carbonated: o.carbonated ?? false,
      viscosity: o.viscosity ?? "low",
      texture: o.texture ?? "clear",
      foaming: o.foaming ?? 0,
    },
  };
}

export const INGREDIENTS: Ing[] = [
  // 烈酒
  ing("rum-white", "白朗姆", "White Rum", "spirit", "#f7f3e4", { abv: 40, density: 0.94 }),
  ing("gin-london-dry", "伦敦干金酒", "London Dry Gin", "spirit", "#f4f7f4", { abv: 40, density: 0.94 }),
  ing("tequila-blanco", "银龙舌兰", "Tequila Blanco", "spirit", "#f6f4ea", { abv: 38, density: 0.94 }),
  ing("bourbon", "波本威士忌", "Bourbon", "spirit", "#c06a1d", { abv: 45, density: 0.94, opacity: 0.86 }),

  // 苦味利口酒（ml 计量）—— 与下面的苦精是两类，见 ADR-009
  ing("campari", "金巴利", "Campari", "amaro_bitter", "#c8102e", { abv: 24, density: 1.09 }),
  // 调酒苦精（dash 计量）
  ing("angostura", "安高天娜苦精", "Angostura Bitters", "amaro_bitter", "#5e2016", { abv: 44, density: 1.05 }),

  // 加强/加香酒 —— 原需求文档的分类里完全没有位置（ADR-009 硬伤 ①）
  ing("vermouth-rosso", "红味美思", "Sweet Vermouth", "fortified_wine", "#7c2d1a", {
    abv: 16,
    density: 1.05,
    opacity: 0.88,
  }),

  // 果汁
  ing("lime-juice", "青柠汁", "Lime Juice", "juice", "#d7e59b", {
    abv: 0,
    density: 1.03,
    texture: "cloudy",
    opacity: 0.85,
  }),
  ing("lemon-juice", "柠檬汁", "Lemon Juice", "juice", "#e8e08a", {
    abv: 0,
    density: 1.03,
    texture: "cloudy",
    opacity: 0.85,
  }),
  ing("orange-juice", "橙汁", "Orange Juice", "juice", "#f59b1e", {
    abv: 0,
    density: 1.05,
    texture: "cloudy",
    viscosity: "medium",
    opacity: 0.95,
  }),

  // 糖浆 —— grenadine 密度 1.18，会自然沉底，不需要 FLOAT
  ing("simple-syrup", "糖浆", "Simple Syrup", "syrup_sweetener", "#f6f0dd", {
    abv: 0,
    density: 1.26,
    viscosity: "high",
  }),
  ing("grenadine", "石榴糖浆", "Grenadine", "syrup_sweetener", "#a8082c", {
    abv: 0,
    density: 1.18,
    viscosity: "high",
    opacity: 0.96,
  }),

  // 软饮 —— carbonated 驱动气泡发射器
  ing("soda-water", "苏打水", "Soda Water", "mixer", "#eef5f8", {
    abv: 0,
    density: 1.0,
    carbonated: true,
    opacity: 0.55,
  }),

  // 乳蛋 —— foaming 驱动泡沫
  ing("egg-white", "蛋清", "Egg White", "dairy_egg", "#fbf9f2", {
    abv: 0,
    density: 1.04,
    texture: "foam",
    viscosity: "medium",
    foaming: 1,
    opacity: 0.92,
  }),

  // 香料草本
  ing("mint-leaf", "薄荷叶", "Mint Leaves", "spice_herb", "#4a8f3c", { density: 1.0 }),

  // 装饰物 —— 归入 ingredients(category='garnish')，不单独建表（ADR-009）
  ing("lime-wheel", "青柠片", "Lime Wheel", "garnish", "#c2da72"),
  ing("orange-peel", "橙皮", "Orange Peel", "garnish", "#e8912a"),
  ing("lemon-peel", "柠檬皮", "Lemon Peel", "garnish", "#e8d84a"),
  ing("orange-wheel", "橙片", "Orange Wheel", "garnish", "#f0a132"),
  ing("cherry", "酒渍樱桃", "Maraschino Cherry", "garnish", "#8c1024"),
  ing("mint-sprig", "薄荷枝", "Mint Sprig", "garnish", "#3f8534"),
];

const ING_MAP = new Map(INGREDIENTS.map((i) => [i.id, i]));

/* ══════════════════════════ 杯型 ══════════════════════════ */

/** 直筒/微锥杯的剖面。r 相对**高度**归一化，所以 r 越小杯子越瘦长。 */
function tumbler(rTop: number, rBottom = rTop * 0.94): ProfilePoint[] {
  return [
    { y: 0, r: rBottom },
    { y: 0.06, r: rTop * 0.98 },
    { y: 1, r: rTop },
  ];
}

const VESSEL_DEFS: VesselDef[] = [
  {
    id: "coupe",
    nameZh: "碟形杯",
    nameEn: "Coupe",
    capacityMl: 180,
    shape: {
      profile: coupeProfile(),
      stem: { height: 0.62, width: 0.05 },
      base: { radius: 0.32 },
    },
  },
  {
    id: "martini",
    nameZh: "马天尼杯",
    nameEn: "Martini",
    capacityMl: 150,
    shape: {
      profile: coneProfile(0.52, 0.05),
      stem: { height: 0.7, width: 0.05 },
      base: { radius: 0.34 },
    },
  },
  { id: "rocks", nameZh: "古典杯", nameEn: "Rocks", capacityMl: 240, shape: { profile: tumbler(0.52) } },
  { id: "highball", nameZh: "高球杯", nameEn: "Highball", capacityMl: 300, shape: { profile: tumbler(0.23) } },
  { id: "collins", nameZh: "柯林斯杯", nameEn: "Collins", capacityMl: 350, shape: { profile: tumbler(0.21) } },
  {
    id: "sour-glass",
    nameZh: "酸酒杯",
    nameEn: "Sour Glass",
    capacityMl: 180,
    shape: { profile: tumbler(0.3), stem: { height: 0.3, width: 0.05 }, base: { radius: 0.26 } },
  },

  // 工作容器 —— 不在 glassware 词表里，由 animator-core 的 WORK_VESSEL_IDS 引用
  { id: "__shaker", nameZh: "摇酒壶", nameEn: "Shaker", capacityMl: 530, shape: { profile: [
    { y: 0, r: 0.3 },
    { y: 0.62, r: 0.36 },
    { y: 1, r: 0.31 },
  ] } },
  { id: "__mixing_glass", nameZh: "搅拌杯", nameEn: "Mixing Glass", capacityMl: 600, shape: { profile: tumbler(0.42) } },
  { id: "__blender", nameZh: "搅拌机", nameEn: "Blender", capacityMl: 1200, shape: { profile: tumbler(0.36) } },
  { id: "__secondary", nameZh: "第二容器", nameEn: "Second Vessel", capacityMl: 400, shape: { profile: tumbler(0.34) } },
  // 量酒器 —— 双头量杯：两个锥体底对底（沙漏剖面），上杯大下杯小，
  // 用 pour_vessel 绘制（贴杯口倾斜倒出）
  { id: "__jigger", nameZh: "量酒器", nameEn: "Jigger", capacityMl: 60, shape: { profile: [
    { y: 0, r: 0.18 },
    { y: 0.45, r: 0.09 },
    { y: 1, r: 0.26 },
  ] } },
];

const VESSEL_MAP = new Map<string, VesselSpec>(
  VESSEL_DEFS.map((d) => [d.id, compileVessel(d)]),
);

/* ══════════════════════════ ResolvedVocab ══════════════════════════ */

export const VOCAB = {
  ingredient(id: string) {
    return ING_MAP.get(id);
  },
  vessel(id: string) {
    return VESSEL_MAP.get(id);
  },
};

export function vesselLookup(id: string): VesselSpec | undefined {
  return VESSEL_MAP.get(id);
}

export const VESSEL_LIST = VESSEL_DEFS;

/* ══════════════════════════ 配方 ══════════════════════════ */

export interface Fixture {
  title: string;
  subtitle: string;
  family: string;
  /** 这个配方专门用来验证动画的哪条路径。 */
  tests: string;
  ir: RecipeIR;
}

export function parse(raw: unknown): RecipeIR {
  const r = RecipeIRSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(`夹具配方不合法：${JSON.stringify(r.error.issues, null, 2)}`);
  }
  return r.data;
}

export const FIXTURES: Fixture[] = [
  {
    title: "Daiquiri",
    subtitle: "白朗姆 · 青柠 · 糖浆",
    family: "sour",
    tests: "摇 → 加冰 → 硬摇 → 霍桑滤网滤入碟形杯。验证摇晃姿态、稀释、容器转移。",
    ir: parse({
      schemaVersion: 1,
      glass: "coupe",
      method: "shaken",
      ingredients: [
        { slot: "i1", ingredientId: "rum-white", amount: 60, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "lime-juice", amount: 25, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", amount: 15, unit: "ml", role: "sweetener" },
        { slot: "i4", ingredientId: "lime-wheel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "CHILL", target: "glass", method: "freezer" },
        { id: "s2", action: "ADD", target: "shaker", items: ["i1", "i2", "i3"] },
        { id: "s3", action: "ICE", target: "shaker", iceType: "cube", fill: 0.8 },
        { id: "s4", action: "SHAKE", target: "shaker", durationSec: 12, intensity: "hard" },
        { id: "s5", action: "STRAIN", from: "shaker", to: "glass", strainer: "hawthorne", double: true },
        { id: "s6", action: "GARNISH", target: "glass", items: ["i4"], position: "rim", prep: "wheel" },
      ],
    }),
  },

  {
    title: "Negroni",
    subtitle: "金酒 · 金巴利 · 红味美思（1:1:1）",
    family: "equal_parts",
    tests: "杯中直调 + 大方冰 + 搅拌。验证等份约简、STIR 保持清澈（不变浑浊）、挤皮油雾。",
    ir: parse({
      schemaVersion: 1,
      glass: "rocks",
      method: "stirred",
      ingredients: [
        { slot: "i1", ingredientId: "gin-london-dry", amount: 30, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "campari", amount: 30, unit: "ml", role: "bittering" },
        { slot: "i3", ingredientId: "vermouth-rosso", amount: 30, unit: "ml", role: "modifier" },
      ],
      steps: [
        { id: "s1", action: "ICE", target: "glass", iceType: "large_cube", fill: 0.7 },
        { id: "s2", action: "ADD", target: "glass", items: ["i1", "i2", "i3"] },
        { id: "s3", action: "STIR", target: "glass", durationSec: 25 },
        {
          id: "s4",
          action: "GARNISH",
          target: "glass",
          garnishId: "orange-peel",
          position: "rim",
          prep: "expressed",
          discard: false,
        },
      ],
    }),
  },

  {
    title: "Tequila Sunrise",
    subtitle: "银龙舌兰 · 橙汁 · 石榴糖浆",
    family: "highball",
    tests: "密度分层。grenadine 密度 1.18 自然沉底形成渐变，不需要 FLOAT —— 验证密度排序。",
    ir: parse({
      schemaVersion: 1,
      glass: "highball",
      method: "built",
      ingredients: [
        { slot: "i1", ingredientId: "tequila-blanco", amount: 45, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "orange-juice", amount: 90, unit: "ml", role: "lengthener" },
        { slot: "i3", ingredientId: "grenadine", amount: 15, unit: "ml", role: "sweetener" },
      ],
      steps: [
        { id: "s1", action: "ICE", target: "glass", iceType: "cube", fill: 0.75 },
        { id: "s2", action: "ADD", target: "glass", items: ["i1", "i2"] },
        { id: "s3", action: "STIR", target: "glass", durationSec: 5 },
        { id: "s4", action: "ADD", target: "glass", items: ["i3"] },
        { id: "s5", action: "WAIT", target: "glass", durationSec: 20, reason: "settle" },
        {
          id: "s6",
          action: "GARNISH",
          target: "glass",
          garnishId: "orange-wheel",
          position: "rim",
          prep: "wheel",
        },
      ],
    }),
  },

  {
    title: "Mojito",
    subtitle: "白朗姆 · 薄荷 · 青柠 · 苏打",
    family: "smash_julep",
    tests: "捣压 + 碎冰 + top_up 补满。验证 MUDDLE 出汁、碎冰浑浊化、气泡发射器、补满量编译期计算。",
    ir: parse({
      schemaVersion: 1,
      glass: "collins",
      method: "built",
      ingredients: [
        { slot: "i1", ingredientId: "mint-leaf", amount: 10, unit: "leaf", role: "garnish" },
        { slot: "i2", ingredientId: "lime-juice", amount: 25, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", amount: 20, unit: "ml", role: "sweetener" },
        { slot: "i4", ingredientId: "rum-white", amount: 50, unit: "ml", role: "base" },
        { slot: "i5", ingredientId: "soda-water", unit: "top_up", role: "lengthener" },
        { slot: "i6", ingredientId: "mint-sprig", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "glass", items: ["i2", "i3"] },
        { id: "s2", action: "MUDDLE", target: "glass", items: ["i1"], intensity: "gentle" },
        { id: "s3", action: "ADD", target: "glass", items: ["i4"] },
        { id: "s4", action: "ICE", target: "glass", iceType: "crushed", fill: 0.85 },
        { id: "s5", action: "TOP_UP", target: "glass", items: ["i5"] },
        { id: "s6", action: "SWIZZLE", target: "glass", durationSec: 6 },
        {
          id: "s7",
          action: "GARNISH",
          target: "glass",
          items: ["i6"],
          position: "in_glass",
          prep: "slapped",
        },
      ],
    }),
  },

  {
    title: "Whiskey Sour",
    subtitle: "波本 · 柠檬 · 糖浆 · 蛋清",
    family: "sour",
    tests: "干摇起泡 → 加冰湿摇 → 细滤。验证 foaming 原料、两段摇、泡沫冠、苦精点缀（dash 只调色不加量）。",
    ir: parse({
      schemaVersion: 1,
      glass: "sour-glass",
      method: "shaken",
      ingredients: [
        { slot: "i1", ingredientId: "bourbon", amount: 50, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "lemon-juice", amount: 25, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", amount: 15, unit: "ml", role: "sweetener" },
        { slot: "i4", ingredientId: "egg-white", amount: 20, unit: "ml", role: "texture" },
        { slot: "i5", ingredientId: "angostura", amount: 3, unit: "dash", role: "bittering" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "shaker", items: ["i1", "i2", "i3", "i4"] },
        { id: "s2", action: "SHAKE", target: "shaker", durationSec: 10, intensity: "hard", dryShake: true },
        { id: "s3", action: "ICE", target: "shaker", iceType: "cube", fill: 0.8 },
        { id: "s4", action: "SHAKE", target: "shaker", durationSec: 12, intensity: "hard" },
        { id: "s5", action: "STRAIN", from: "shaker", to: "glass", strainer: "fine", double: true },
        { id: "s6", action: "WAIT", target: "glass", durationSec: 15, reason: "bloom" },
        { id: "s7", action: "ADD", target: "glass", items: ["i5"] },
      ],
    }),
  },

  {
    title: "Highball",
    subtitle: "威士忌 · 苏打（长条冰）",
    family: "highball",
    tests: "长条冰（block）+ 苏打补满的气泡。验证冰柱造型、top_up 补满量、气泡发射器。",
    ir: parse({
      schemaVersion: 1,
      glass: "highball",
      method: "built",
      ingredients: [
        { slot: "i1", ingredientId: "bourbon", amount: 45, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "soda-water", unit: "top_up", role: "lengthener" },
        { slot: "i3", ingredientId: "lemon-peel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "ICE", target: "glass", iceType: "block", fill: 0.55 },
        { id: "s2", action: "ADD", target: "glass", items: ["i1"] },
        { id: "s3", action: "TOP_UP", target: "glass", items: ["i2"] },
        { id: "s4", action: "STIR", target: "glass", durationSec: 4 },
        { id: "s5", action: "GARNISH", target: "glass", items: ["i3"], position: "rim", prep: "twist" },
      ],
    }),
  },

  {
    title: "Old Fashioned",
    subtitle: "波本 · 糖浆 · 苦精（球冰）",
    family: "old_fashioned",
    tests: "球冰（sphere）+ dash 苦精小剂量滴落 + 挤皮油雾。验证球冰造型、dash 不加液面、STIR 保持清澈。",
    ir: parse({
      schemaVersion: 1,
      glass: "rocks",
      method: "stirred",
      ingredients: [
        { slot: "i1", ingredientId: "bourbon", amount: 50, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "simple-syrup", amount: 8, unit: "ml", role: "sweetener" },
        { slot: "i3", ingredientId: "angostura", amount: 2, unit: "dash", role: "bittering" },
        { slot: "i4", ingredientId: "orange-peel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "glass", items: ["i2", "i3"] },
        { id: "s2", action: "ICE", target: "glass", iceType: "sphere", fill: 0.5 },
        { id: "s3", action: "ADD", target: "glass", items: ["i1"] },
        { id: "s4", action: "STIR", target: "glass", durationSec: 20 },
        {
          id: "s5",
          action: "GARNISH",
          target: "glass",
          items: ["i4"],
          position: "rim",
          prep: "expressed",
          discard: false,
        },
      ],
    }),
  },
];

export { ASSET_TEST_FIXTURES } from "./asset-test.ts";
