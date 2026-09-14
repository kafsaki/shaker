/**
 * 把原型验证用的词表与配方导出成种子 JSON，供 Go 后端幂等导入
 * （ADR-016 的冷启动内容；这批数据当初就是按「毕业后直接成为种子」写的）。
 *
 * 产物：apps/api/internal/seed/data/seed.json
 * 运行：node --experimental-strip-types packages/seed/scripts/export.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INGREDIENTS, VESSEL_LIST, FIXTURES } from "../src/index.ts";
import { ACTIONS } from "@shaker/recipe-ir";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../../apps/api/internal/seed/data/seed.json");

/* ── 原料别名（搜索词扩展，ADR-012 的 ingredient_aliases 表）── */
const ALIASES: Record<string, Array<[string, "zh" | "en"]>> = {
  "rum-white": [["白朗姆", "zh"], ["朗姆酒", "zh"], ["light rum", "en"]],
  "gin-london-dry": [["金酒", "zh"], ["琴酒", "zh"], ["gin", "en"], ["dry gin", "en"]],
  "tequila-blanco": [["龙舌兰", "zh"], ["银龙舌兰", "zh"], ["tequila", "en"], ["blanco", "en"]],
  bourbon: [["波本", "zh"], ["威士忌", "zh"], ["whiskey", "en"], ["bourbon whiskey", "en"]],
  campari: [["康帕利", "zh"], ["坎帕里", "zh"]],
  angostura: [["安高天娜", "zh"], ["苦精", "zh"], ["bitters", "en"]],
  "vermouth-rosso": [["味美思", "zh"], ["甜味美思", "zh"], ["sweet vermouth", "en"], ["vermouth", "en"]],
  "lime-juice": [["青柠", "zh"], ["莱姆汁", "zh"], ["lime", "en"]],
  "lemon-juice": [["柠檬汁", "zh"], ["lemon", "en"]],
  "orange-juice": [["橙汁", "zh"], ["orange", "en"]],
  "simple-syrup": [["糖水", "zh"], ["syrup", "en"], ["gomme", "en"]],
  grenadine: [["石榴糖浆", "zh"], ["红石榴糖浆", "zh"]],
  "soda-water": [["苏打", "zh"], ["气泡水", "zh"], ["soda", "en"], ["sparkling water", "en"]],
  "egg-white": [["蛋白", "zh"], ["egg white", "en"]],
  "mint-leaf": [["薄荷", "zh"], ["mint", "en"]],
  "mint-sprig": [["薄荷枝", "zh"], ["mint sprig", "en"]],
  "lime-wheel": [["青柠片", "zh"], ["lime wheel", "en"]],
  "orange-peel": [["橙皮", "zh"], ["orange peel", "en"]],
  "orange-wheel": [["橙片", "zh"], ["orange wheel", "en"]],
  cherry: [["樱桃", "zh"], ["maraschino cherry", "en"]],
};

const ingredients = INGREDIENTS.map((i) => ({
  id: i.id,
  nameZh: i.nameZh,
  nameEn: i.nameEn,
  category: i.category,
  subcategory: null,
  abv: i.abv ?? null,
  density: i.density ?? null,
  viz: i.viz,
  aliases: (ALIASES[i.id] ?? []).map(([alias, lang]) => ({ alias, lang })),
}));

/* ── 杯型：__ 前缀是 animator-core 的工作容器，不进 glassware 词表 ── */
const glassware = VESSEL_LIST
  .filter((v) => !v.id.startsWith("__"))
  .map((v) => ({ id: v.id, nameZh: v.nameZh, nameEn: v.nameEn, capacityMl: v.capacityMl, shape: v.shape }));

/* ── 技法文案：行为定义在代码里，表里只管展示（DDL 注释）── */
const TECHNIQUE_NAMES: Record<string, [string, string]> = {
  CHILL: ["冰镇", "Chill"],
  RIM: ["杯口装饰", "Rim"],
  RINSE: ["涮杯", "Rinse"],
  ADD: ["加入", "Add"],
  ICE: ["加冰", "Add Ice"],
  MUDDLE: ["捣压", "Muddle"],
  SHAKE: ["摇和", "Shake"],
  STIR: ["搅拌", "Stir"],
  SWIZZLE: ["旋搅", "Swizzle"],
  ROLL: ["滚和", "Roll"],
  THROW: ["抛接", "Throw"],
  BLEND: ["搅打", "Blend"],
  STRAIN: ["滤入", "Strain"],
  DUMP: ["倒入", "Dump"],
  TOP_UP: ["补满", "Top Up"],
  FLOAT: ["漂浮", "Float"],
  GARNISH: ["装饰", "Garnish"],
  SPRITZ: ["喷雾", "Spritz"],
  FLAME: ["火焰", "Flame"],
  SMOKE: ["烟熏", "Smoke"],
  WAIT: ["静置", "Wait"],
};
const techniques = ACTIONS.map((id, i) => {
  const [nameZh, nameEn] = TECHNIQUE_NAMES[id]!;
  return { id, nameZh, nameEn, iconId: id.toLowerCase(), sortOrder: i };
});

/* ── 自由标签（ADR-010：家族做主轴，标签做软性发现）── */
const tags = [
  { id: "refreshing", nameZh: "清爽", nameEn: "Refreshing", kind: "taste" },
  { id: "sweet", nameZh: "甜", nameEn: "Sweet", kind: "taste" },
  { id: "sour", nameZh: "酸", nameEn: "Sour", kind: "taste" },
  { id: "bitter", nameZh: "苦", nameEn: "Bitter", kind: "taste" },
  { id: "strong", nameZh: "烈", nameEn: "Strong", kind: "taste" },
  { id: "smooth", nameZh: "顺口", nameEn: "Smooth", kind: "taste" },
  { id: "after-dinner", nameZh: "餐后", nameEn: "After Dinner", kind: "occasion" },
  { id: "party", nameZh: "派对", nameEn: "Party", kind: "occasion" },
  { id: "summer", nameZh: "夏季", nameEn: "Summer", kind: "season" },
  { id: "winter", nameZh: "冬季", nameEn: "Winter", kind: "season" },
];

/* ── 经典配方：fixture 里那 5 款按 canonical 条目挂进官方账号 ── */
const CLASSIC_META: Record<string, {
  slug: string;
  classicKey: string;
  ibaCategory: string | null;
  description: string;
  tasteProfile: { sweet: number; sour: number; bitter: number; strength: number };
  difficulty: number;
  tags: string[];
}> = {
  Daiquiri: {
    slug: "daiquiri",
    classicKey: "daiquiri",
    ibaCategory: "unforgettable",
    description: "白朗姆、青柠与糖的三元平衡——酸酒家族的教科书。",
    tasteProfile: { sweet: 2, sour: 4, bitter: 0, strength: 3 },
    difficulty: 2,
    tags: ["refreshing", "sour", "summer"],
  },
  Negroni: {
    slug: "negroni",
    classicKey: "negroni",
    ibaCategory: "unforgettable",
    description: "等份金酒、金巴利与红味美思，先苦后甘的餐前经典。",
    tasteProfile: { sweet: 2, sour: 0, bitter: 4, strength: 3 },
    difficulty: 1,
    tags: ["bitter", "after-dinner"],
  },
  "Tequila Sunrise": {
    slug: "tequila-sunrise",
    classicKey: "tequila-sunrise",
    ibaCategory: "contemporary",
    description: "橙汁与石榴糖浆的密度分层，日出般的渐变。",
    tasteProfile: { sweet: 3, sour: 1, bitter: 0, strength: 2 },
    difficulty: 1,
    tags: ["sweet", "summer"],
  },
  Mojito: {
    slug: "mojito",
    classicKey: "mojito",
    ibaCategory: "contemporary",
    description: "捣压薄荷、青柠与白朗姆，苏打水补满的清凉古巴经典。",
    tasteProfile: { sweet: 2, sour: 3, bitter: 0, strength: 2 },
    difficulty: 2,
    tags: ["refreshing", "summer"],
  },
  "Whiskey Sour": {
    slug: "whiskey-sour",
    classicKey: "whiskey-sour",
    ibaCategory: "unforgettable",
    description: "波本、柠檬与蛋清干摇出的绵密泡沫冠。",
    tasteProfile: { sweet: 3, sour: 3, bitter: 0, strength: 3 },
    difficulty: 2,
    tags: ["sour", "smooth"],
  },
};

const classicRecipes = FIXTURES.map((f) => {
  const meta = CLASSIC_META[f.title]!;
  return {
    title: f.title,
    subtitle: f.subtitle,
    slug: meta.slug,
    classicKey: meta.classicKey,
    ibaCategory: meta.ibaCategory,
    family: f.family,
    descriptionMd: meta.description,
    lang: "zh",
    tasteProfile: meta.tasteProfile,
    difficulty: meta.difficulty,
    tags: meta.tags,
    ir: f.ir,
  };
});

const doc = {
  officialUser: {
    handle: "shaker",
    displayName: "Shaker 官方",
    email: "official@shaker.local",
    bio: "经典配方与词表维护账号。",
  },
  ingredients,
  glassware,
  techniques,
  tags,
  classicRecipes,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log(`已写出 ${outPath}（原料 ${ingredients.length}、杯型 ${glassware.length}、技法 ${techniques.length}、配方 ${classicRecipes.length}）`);
