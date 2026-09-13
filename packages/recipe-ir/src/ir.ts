/**
 * Recipe IR 的 zod schema —— 整个项目的唯一真相源（ADR-002、ADR-017）。
 *
 * 这份 schema 同时服务四个消费者：
 *   1. 前端编辑器（实时校验 + 类型推导）
 *   2. animator-core（编译动画的输入类型）
 *   3. Go 后端（经 z.toJSONSchema() 导出 → go:embed → 写入时校验）
 *   4. v2 的 ir-extractor（约束模型输出）
 *
 * 因为 (3) 用 JSON Schema 校验，**所有约束必须是 JSON Schema 可表达的**。
 * `.superRefine()` 之类的运行时校验不会导出，只能放进 validate.ts 作为额外一层。
 */
import { z } from "zod";
import {
  Action,
  BlendSpeed,
  ChillMethod,
  ContainerId,
  COUNT_UNITS,
  FloatTechnique,
  GarnishPosition,
  GarnishPrep,
  FlameSubject,
  IceType,
  LocalId,
  Method,
  MuddleIntensity,
  NO_AMOUNT_UNITS,
  PourStyle,
  QUASI_VOLUME_UNITS,
  RimCoverage,
  Role,
  ShakeIntensity,
  SlugId,
  SmokeMethod,
  SPOON_UNITS,
  StepTextOverride,
  Strainer,
  ThrowHeight,
  VOLUME_UNITS,
  WaitReason,
} from "./vocab.ts";

export const SCHEMA_VERSION = 1 as const;

/* ══════════════════════════ 原料条目 ══════════════════════════ */

/** 所有原料条目共有的字段。 */
const ingredientRefCommon = {
  /** 本配方内唯一，供 steps 引用。 */
  slot: LocalId,
  ingredientId: SlugId,
  role: Role,
  /** 「自制」「过桶」等作者补充，展示用。 */
  note: z.string().max(200).optional(),
  /** 可选原料，动画中虚化表现。 */
  optional: z.boolean().optional(),
};

/**
 * unit 与 amount 的关系用**真正的 union**（导出为 JSON Schema 的 anyOf）表达，
 * 而不是 superRefine —— 否则 Go 侧校验不到，v2 模型一定会吐出
 * `{ unit: "top_up", amount: 100 }` 这种东西（ADR-014）。
 *
 * union 的报错可读性一般，所以 validate.ts 里另有一层面向人的检查，
 * 给出「top_up 不能带用量」这样的具体消息。
 */
const volumeRef = z
  .object({
    ...ingredientRefCommon,
    unit: z.enum(VOLUME_UNITS),
    amount: z.number().positive().max(5000),
  })
  .strict();

const spoonRef = z
  .object({
    ...ingredientRefCommon,
    unit: z.enum(SPOON_UNITS),
    amount: z.number().positive().max(50),
  })
  .strict();

const quasiVolumeRef = z
  .object({
    ...ingredientRefCommon,
    unit: z.enum(QUASI_VOLUME_UNITS),
    amount: z.number().positive().max(100),
  })
  .strict();

const countRef = z
  .object({
    ...ingredientRefCommon,
    unit: z.enum(COUNT_UNITS),
    amount: z.number().int().positive().max(100),
  })
  .strict();

/** top_up / rim / to_taste —— strict 模式下不声明 amount 即等于禁止出现。 */
const noAmountRef = z
  .object({
    ...ingredientRefCommon,
    unit: z.enum(NO_AMOUNT_UNITS),
  })
  .strict();

export const IngredientRef = z.union([volumeRef, spoonRef, quasiVolumeRef, countRef, noAmountRef]);
export type IngredientRef = z.infer<typeof IngredientRef>;

/* ══════════════════════════ 步骤 ══════════════════════════ */

const stepCommon = {
  /** 本配方内唯一。 */
  id: LocalId,
  /** 覆写自动生成的文案（规范 §8）。 */
  text: StepTextOverride.optional(),
  /** 小贴士，不参与动画。 */
  note: z.string().max(500).optional(),
};

/** 真实操作时长。动画时长由编译器按压缩曲线映射，不等于这个值。 */
const durationSec = z.number().positive().max(600);

/** 引用本配方的原料 slot。 */
const itemRefs = z.array(LocalId).min(1).max(20);

function step<const A extends z.infer<typeof Action>, T extends z.ZodRawShape>(action: A, shape: T) {
  return z.object({ action: z.literal(action), ...stepCommon, ...shape }).strict();
}

/* ── 准备类 ── */

export const ChillStep = step("CHILL", {
  target: ContainerId,
  method: ChillMethod.optional(),
});

export const RimStep = step("RIM", {
  target: ContainerId,
  /** 引用一个 unit: "rim" 的原料 slot。 */
  material: LocalId,
  coverage: RimCoverage.optional(),
});

export const RinseStep = step("RINSE", {
  target: ContainerId,
  items: itemRefs,
  /** 涮完是否倒掉多余（挂壁着色保留）。 */
  discard: z.boolean().optional(),
});

/* ── 装填类 ── */

export const AddStep = step("ADD", {
  target: ContainerId,
  items: itemRefs,
  pour: PourStyle.optional(),
});

export const IceStep = step("ICE", {
  target: ContainerId,
  iceType: IceType,
  /** 冰占容器的体积分数。排水计算见 physics.ts。 */
  fill: z.number().min(0).max(1),
});

export const MuddleStep = step("MUDDLE", {
  target: ContainerId,
  items: itemRefs,
  intensity: MuddleIntensity.optional(),
});

/* ── 混合类 ── */

export const ShakeStep = step("SHAKE", {
  target: ContainerId,
  durationSec: durationSec.optional(),
  intensity: ShakeIntensity.optional(),
  /** 无冰干摇，起泡专用（蛋清配方第一段）。 */
  dryShake: z.boolean().optional(),
});

export const StirStep = step("STIR", {
  target: ContainerId,
  durationSec: durationSec.optional(),
  revolutions: z.number().int().positive().max(200).optional(),
});

export const SwizzleStep = step("SWIZZLE", {
  target: ContainerId,
  durationSec: durationSec.optional(),
});

export const RollStep = step("ROLL", {
  from: ContainerId,
  to: ContainerId,
  times: z.number().int().min(1).max(10),
});

export const ThrowStep = step("THROW", {
  from: ContainerId,
  to: ContainerId,
  times: z.number().int().min(1).max(10),
  height: ThrowHeight.optional(),
});

export const BlendStep = step("BLEND", {
  target: ContainerId,
  durationSec: durationSec.optional(),
  speed: BlendSpeed.optional(),
});

/* ── 转移类 ── */

export const StrainStep = step("STRAIN", {
  from: ContainerId,
  to: ContainerId,
  strainer: Strainer.optional(),
  /** 双重过滤（hawthorne + fine 叠加）。 */
  double: z.boolean().optional(),
});

export const DumpStep = step("DUMP", {
  from: ContainerId,
  to: ContainerId,
});

/* ── 完成类 ── */

export const TopUpStep = step("TOP_UP", {
  target: ContainerId,
  /** items 的 unit 必须是 top_up；实际体积在编译期算（ADR-014）。 */
  items: itemRefs,
});

export const FloatStep = step("FLOAT", {
  target: ContainerId,
  items: itemRefs,
  technique: FloatTechnique.optional(),
});

export const GarnishStep = step("GARNISH", {
  target: ContainerId,
  /**
   * garnishId 与 items 二选一 —— 直接引词表，或引用本配方的 slot。
   * 「恰好一个」的约束放在 validate.ts（JSON Schema 表达 oneOf-required 会很丑）。
   */
  garnishId: SlugId.optional(),
  items: itemRefs.optional(),
  position: GarnishPosition,
  prep: GarnishPrep.optional(),
  /** prep: "expressed" 时挤完是否丢弃。 */
  discard: z.boolean().optional(),
});

export const SpritzStep = step("SPRITZ", {
  target: ContainerId,
  items: itemRefs,
  sprays: z.number().int().min(1).max(10).optional(),
});

export const FlameStep = step("FLAME", {
  target: ContainerId,
  subject: FlameSubject.optional(),
  durationSec: durationSec.optional(),
});

export const SmokeStep = step("SMOKE", {
  target: ContainerId,
  method: SmokeMethod.optional(),
  /** 加盖聚烟。 */
  cover: z.boolean().optional(),
  durationSec: durationSec.optional(),
});

export const WaitStep = step("WAIT", {
  target: ContainerId,
  durationSec: durationSec,
  reason: WaitReason.optional(),
});

/* ── 汇总 ── */

export const Step = z.discriminatedUnion("action", [
  ChillStep,
  RimStep,
  RinseStep,
  AddStep,
  IceStep,
  MuddleStep,
  ShakeStep,
  StirStep,
  SwizzleStep,
  RollStep,
  ThrowStep,
  BlendStep,
  StrainStep,
  DumpStep,
  TopUpStep,
  FloatStep,
  GarnishStep,
  SpritzStep,
  FlameStep,
  SmokeStep,
  WaitStep,
]);
export type Step = z.infer<typeof Step>;

/* ══════════════════════════ 顶层 ══════════════════════════ */

/**
 * 注意 `family` 不在 IR 里 —— 它是可空、运营可改的编辑性元数据（ADR-010），
 * 属于 recipes 表。IR 只装配方的不可变内容。
 */
export const RecipeIR = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** 成品杯型 ID，指向 glassware 表。 */
    glass: SlugId,
    /** 仅作筛选与展示标记，不参与动画编译。 */
    method: Method,
    servings: z.number().int().min(1).max(50).default(1),
    ingredients: z.array(IngredientRef).min(1).max(30),
    steps: z.array(Step).min(1).max(40),
  })
  .strict();
export type RecipeIR = z.infer<typeof RecipeIR>;

// containersUsed / slotsReferenced 已迁到 ir-utils.ts —— 那个文件零 zod 依赖，
// 播放路径可以用它们而不把 schema 拖进 bundle。
