/**
 * 闭集词表。
 *
 * 这些枚举是"动画能自动生成"和"v2 让模型产出 IR"的共同前提（ADR-002）。
 * 任何新增值都要同步考虑：渲染器有没有对应表现、JSON Schema 要不要重新生成。
 *
 * 增加枚举值不升 schemaVersion；删除或改变语义必须升版本并写迁移器（规范 §11）。
 */
import { z } from "zod";

/* ────────────────────────── 标识符 ────────────────────────── */

/** 配方内的局部 ID（原料 slot、步骤 id）。短、可读、便于 LLM 生成。 */
export const LocalId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,15}$/, "局部 ID 须以小写字母开头，仅含小写字母、数字、下划线，长度 ≤16");

/** 词表条目 ID（原料、杯型、装饰物）。slug 形式。 */
export const SlugId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "词表 ID 须为小写 slug，如 'gin-london-dry'")
  .max(64);

/* ────────────────────────── 动作 ────────────────────────── */

export const ACTIONS = [
  // 准备
  "CHILL",
  "RIM",
  "RINSE",
  // 装填
  "ADD",
  "ICE",
  "MUDDLE",
  // 混合
  "SHAKE",
  "STIR",
  "SWIZZLE",
  "ROLL",
  "THROW",
  "BLEND",
  // 转移
  "STRAIN",
  "DUMP",
  // 完成
  "TOP_UP",
  "FLOAT",
  "GARNISH",
  "SPRITZ",
  "FLAME",
  "SMOKE",
  "WAIT",
] as const;
export const Action = z.enum(ACTIONS);
export type Action = z.infer<typeof Action>;

/* ────────────────────────── 容器 ────────────────────────── */

export const CONTAINER_IDS = ["shaker", "mixing_glass", "glass", "blender", "secondary"] as const;
export const ContainerId = z.enum(CONTAINER_IDS);
export type ContainerId = z.infer<typeof ContainerId>;

/* ────────────────────────── 单位 ────────────────────────── */

/** 精确体积单位 —— 全额计入液面。 */
export const VOLUME_UNITS = ["ml", "cl", "oz"] as const;
/** 勺量 —— 全额计入液面，按 5ml 折算。 */
export const SPOON_UNITS = ["barspoon", "tsp"] as const;
/** 准体积 —— 体积可忽略，只贡献色调（苦精、酊剂）。 */
export const QUASI_VOLUME_UNITS = ["dash", "drop"] as const;
/** 计数单位 —— 固体，amount 必须为正整数，不计入液体。 */
export const COUNT_UNITS = ["piece", "leaf", "wedge", "slice"] as const;
/** 无量单位 —— 禁止出现 amount。 */
export const NO_AMOUNT_UNITS = ["top_up", "rim", "to_taste"] as const;

export const UNITS = [
  ...VOLUME_UNITS,
  ...SPOON_UNITS,
  ...QUASI_VOLUME_UNITS,
  ...COUNT_UNITS,
  ...NO_AMOUNT_UNITS,
] as const;
export const Unit = z.enum(UNITS);
export type Unit = z.infer<typeof Unit>;

/* ────────────────────────── 功能角色 ────────────────────────── */

/**
 * 角色是「在这杯里干什么」，挂在配方-原料关系上，不挂在原料表上（ADR-009）。
 * 金酒在 Martini 是 base，在 Long Island 只是 modifier 之一。
 */
export const ROLES = [
  "base",
  "modifier",
  "sweetener",
  "souring",
  "bittering",
  "lengthener",
  "texture",
  "rinse",
  "garnish",
  "ice",
] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/* ────────────────────────── 原料品类 ────────────────────────── */

/**
 * 「是什么」——稳定不变，挂在 ingredients.category。
 * 14 类，故意不压缩（ADR-009）：分类有物理依据（密度、含气、粘度、计量单位），
 * 合并 amaro_bitter 会重新引入 dash/ml 计量混乱。
 */
export const INGREDIENT_CATEGORIES = [
  "spirit",
  "liqueur",
  "amaro_bitter",
  "fortified_wine",
  "wine_beer",
  "juice",
  "syrup_sweetener",
  "mixer",
  "dairy_egg",
  "coffee_tea",
  "spice_herb",
  "garnish",
  "ice",
  "other",
] as const;
export const IngredientCategory = z.enum(INGREDIENT_CATEGORIES);
export type IngredientCategory = z.infer<typeof IngredientCategory>;

/* ────────────────────────── 鸡尾酒家族 ────────────────────────── */

/**
 * 家族 ≈ 一套动画模板：sour 必然「摇壶+冰+硬摇+细滤+碟型杯」，
 * highball 必然「杯中直调+加冰+补气泡」。编辑器用它铺步骤骨架（ADR-010）。
 *
 * 业内对家族边界本身有争议（Mojito 算 smash 还是 highball？），
 * 所以这是可空、单选、运营可改的编辑性字段，不做硬约束。
 */
export const FAMILIES = [
  "sour",
  "fizz_collins",
  "old_fashioned",
  "martini_duo",
  "equal_parts",
  "highball",
  "smash_julep",
  "punch_tiki",
  "flip_creamy",
  "spritz_wine",
  "hot",
  "layered_shot",
] as const;
export const Family = z.enum(FAMILIES);
export type Family = z.infer<typeof Family>;

/** IBA 官方分档 —— 仅作权威徽章与种子数据来源，不做导航维度（ADR-010）。 */
export const IBA_CATEGORIES = ["unforgettable", "contemporary", "new_era"] as const;
export const IbaCategory = z.enum(IBA_CATEGORIES);
export type IbaCategory = z.infer<typeof IbaCategory>;

/* ────────────────────────── 手法标记 ────────────────────────── */

/** 仅作筛选与展示标记，不参与动画编译 —— 动画完全由 steps 决定。 */
export const METHODS = [
  "shaken",
  "stirred",
  "built",
  "blended",
  "thrown",
  "swizzled",
  "rolled",
  "layered",
] as const;
export const Method = z.enum(METHODS);
export type Method = z.infer<typeof Method>;

/* ────────────────────────── 冰 ────────────────────────── */

export const ICE_TYPES = [
  "cube",
  "large_cube",
  "sphere",
  "cracked",
  "crushed",
  "block",
  "dry_ice",
] as const;
export const IceType = z.enum(ICE_TYPES);
export type IceType = z.infer<typeof IceType>;

/* ────────────────────────── 动作参数枚举 ────────────────────────── */

export const Strainer = z.enum(["hawthorne", "julep", "fine", "none"]);
export type Strainer = z.infer<typeof Strainer>;

export const ShakeIntensity = z.enum(["gentle", "standard", "hard"]);
export type ShakeIntensity = z.infer<typeof ShakeIntensity>;

export const MuddleIntensity = z.enum(["gentle", "firm"]);
export type MuddleIntensity = z.infer<typeof MuddleIntensity>;

export const GarnishPosition = z.enum(["rim", "in_glass", "float", "skewer", "side"]);
export type GarnishPosition = z.infer<typeof GarnishPosition>;

export const GarnishPrep = z.enum([
  "twist",
  "wheel",
  "wedge",
  "flag",
  "dehydrated",
  "expressed",
  "slapped",
  "none",
]);
export type GarnishPrep = z.infer<typeof GarnishPrep>;

export const SmokeMethod = z.enum(["smoking_gun", "torched_wood", "dry_ice"]);
export type SmokeMethod = z.infer<typeof SmokeMethod>;

export const FlameSubject = z.enum(["garnish", "surface", "peel_oil"]);
export type FlameSubject = z.infer<typeof FlameSubject>;

export const WaitReason = z.enum(["settle", "bloom", "infuse"]);
export type WaitReason = z.infer<typeof WaitReason>;

export const ChillMethod = z.enum(["ice_water", "freezer"]);
export type ChillMethod = z.infer<typeof ChillMethod>;

export const RimCoverage = z.enum(["full", "half"]);
export type RimCoverage = z.infer<typeof RimCoverage>;

export const PourStyle = z.enum(["sequential", "simultaneous"]);
export type PourStyle = z.infer<typeof PourStyle>;

export const FloatTechnique = z.enum(["over_spoon", "gentle_pour"]);
export type FloatTechnique = z.infer<typeof FloatTechnique>;

export const BlendSpeed = z.enum(["low", "high"]);
export type BlendSpeed = z.infer<typeof BlendSpeed>;

export const ThrowHeight = z.enum(["low", "high"]);
export type ThrowHeight = z.infer<typeof ThrowHeight>;

/* ────────────────────────── 原料视觉字段 ────────────────────────── */

export const Viscosity = z.enum(["low", "medium", "high"]);
export type Viscosity = z.infer<typeof Viscosity>;

export const Texture = z.enum(["clear", "cloudy", "creamy", "foam"]);
export type Texture = z.infer<typeof Texture>;

/* ────────────────────────── 双语文本 ────────────────────────── */

/** 受控词表强制双语（ADR-011）。UGC 不用这个，UGC 是单语 + lang 字段。 */
export const I18nText = z.object({
  zh: z.string().min(1).max(4000),
  en: z.string().min(1).max(4000),
});
export type I18nText = z.infer<typeof I18nText>;

/** 作者覆写的步骤文案 —— 单语即可，缺省时按模板自动生成（规范 §8）。 */
export const StepTextOverride = z
  .object({
    zh: z.string().min(1).max(500).optional(),
    en: z.string().min(1).max(500).optional(),
  })
  .refine((v) => v.zh !== undefined || v.en !== undefined, "覆写文案至少提供一种语言");
export type StepTextOverride = z.infer<typeof StepTextOverride>;
