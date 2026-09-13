/**
 * 单位换算与展示。
 *
 * 核心约定（ADR-014）：`amount + unit` 是真相源，`amountMl` 是派生值。
 * IR 里只存原始值；amountMl 在读取时算，或投影进 recipe_ingredients 供 SQL 筛选。
 */
import type { IngredientRef } from "./ir.ts";
import {
  ML_PER_BARSPOON,
  ML_PER_CL,
  ML_PER_DASH,
  ML_PER_DROP,
  ML_PER_OZ,
  ML_PER_TSP,
} from "./physics.ts";
import type { Unit } from "./vocab.ts";

/* ────────────────────────── 单位分类 ────────────────────────── */

export type UnitKind = "volume" | "spoon" | "quasi_volume" | "count" | "no_amount";

export function unitKind(unit: Unit): UnitKind {
  switch (unit) {
    case "ml":
    case "cl":
    case "oz":
      return "volume";
    case "barspoon":
    case "tsp":
      return "spoon";
    case "dash":
    case "drop":
      return "quasi_volume";
    case "piece":
    case "leaf":
    case "wedge":
    case "slice":
      return "count";
    case "top_up":
    case "rim":
    case "to_taste":
      return "no_amount";
  }
}

/** 该单位是否要求 amount。 */
export function requiresAmount(unit: Unit): boolean {
  return unitKind(unit) !== "no_amount";
}

/** 该单位的 amount 是否必须是整数。 */
export function requiresIntegerAmount(unit: Unit): boolean {
  return unitKind(unit) === "count";
}

/** 该单位是否计入液面高度。quasi_volume 有体积但可忽略，只贡献色调。 */
export function contributesToLiquidLevel(unit: Unit): boolean {
  const k = unitKind(unit);
  return k === "volume" || k === "spoon";
}

/* ────────────────────────── 归一化到毫升 ────────────────────────── */

/**
 * 派生 amountMl。不可换算的单位返回 null。
 *
 * `top_up` 返回 null —— 它的实际体积依赖杯容量与冰排水，在动画编译期算（ADR-014）。
 */
export function toMl(amount: number | undefined, unit: Unit): number | null {
  if (amount === undefined) return null;
  switch (unit) {
    case "ml":
      return amount;
    case "cl":
      return amount * ML_PER_CL;
    case "oz":
      return amount * ML_PER_OZ;
    case "barspoon":
      return amount * ML_PER_BARSPOON;
    case "tsp":
      return amount * ML_PER_TSP;
    case "dash":
      return amount * ML_PER_DASH;
    case "drop":
      return amount * ML_PER_DROP;
    case "piece":
    case "leaf":
    case "wedge":
    case "slice":
    case "top_up":
    case "rim":
    case "to_taste":
      return null;
  }
}

export function refToMl(ref: IngredientRef): number | null {
  return toMl("amount" in ref ? ref.amount : undefined, ref.unit);
}

/** 计入液面的总液体量（毫升），不含冰融水与 top_up。 */
export function totalLiquidMl(refs: readonly IngredientRef[]): number {
  let sum = 0;
  for (const r of refs) {
    if (!contributesToLiquidLevel(r.unit)) continue;
    sum += refToMl(r) ?? 0;
  }
  return sum;
}

/* ────────────────────────── 展示层换算 ────────────────────────── */

export type UnitPreference = "ml" | "oz";

/** ¼ oz 刻度的分数表示 —— 美式酒吧惯例不写小数。 */
const OZ_FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0, "0"],
  [0.25, "¼"],
  [0.5, "½"],
  [0.75, "¾"],
];

/**
 * 把 ¼ oz 刻度的数值格式化成分数字符串。
 * 2.75 → "2¾"，0.5 → "½"，3 → "3"
 */
export function formatOzFraction(quarters: number): string {
  const whole = Math.floor(quarters);
  const frac = Math.round((quarters - whole) * 4) / 4;
  const fracStr = OZ_FRACTIONS.find(([v]) => v === frac)?.[1] ?? "";
  if (whole === 0) return fracStr === "0" ? "0" : fracStr;
  return fracStr && fracStr !== "0" ? `${whole}${fracStr}` : String(whole);
}

export interface DisplayAmount {
  /** 给用户看的字符串，如 "45 ml" / "≈ ¾ oz" / "2 dash" / "补满"。 */
  text: string;
  /** 是否发生了换算（true 时前面带 ≈，精确值可悬停查看）。 */
  approximate: boolean;
  /** 精确值提示，仅 approximate 时有意义，如 "22 ml 原方"。 */
  exactHint?: string;
}

/**
 * 展示层换算（ADR-014）：
 *   原生单位 == 偏好单位 → 原样显示，零损失
 *   需要换算           → 吸附到该单位实际刻度，加 ≈
 *
 * 吸附看似失真，其实相反：量酒器（jigger）的刻度本身就是 ¼ oz 级别，
 * 显示 "0.744 oz" 是假精度，"≈ ¾ oz" 才是调酒师真正会倒的量。
 */
export function displayAmount(
  ref: IngredientRef,
  pref: UnitPreference,
  lang: "zh" | "en" = "zh",
): DisplayAmount {
  const amount = "amount" in ref ? ref.amount : undefined;
  const kind = unitKind(ref.unit);

  if (kind === "no_amount") {
    return { text: NO_AMOUNT_LABEL[lang][ref.unit as "top_up" | "rim" | "to_taste"], approximate: false };
  }
  if (amount === undefined) {
    return { text: "", approximate: false };
  }
  if (kind === "count") {
    return { text: `${amount} ${COUNT_LABEL[lang][ref.unit as CountUnit]}`, approximate: false };
  }
  if (kind === "quasi_volume" || kind === "spoon") {
    // dash / drop / barspoon / tsp 不做偏好换算 —— 这些单位本身就是行业通用写法
    return { text: `${trimNum(amount)} ${SMALL_UNIT_LABEL[lang][ref.unit as SmallUnit]}`, approximate: false };
  }

  // 精确体积单位
  if (pref === "ml") {
    if (ref.unit === "ml") return { text: `${trimNum(amount)} ml`, approximate: false };
    const ml = toMl(amount, ref.unit)!;
    const snapped = Math.round(ml / 5) * 5;
    const exact = `${trimNum(amount)} ${ref.unit}`;
    if (Math.abs(snapped - ml) < 0.05) return { text: `${snapped} ml`, approximate: false };
    return { text: `≈ ${snapped} ml`, approximate: true, exactHint: lang === "zh" ? `${exact} 原方` : `${exact} original` };
  }

  // pref === "oz"
  if (ref.unit === "oz") {
    return { text: `${formatOzFraction(amount)} oz`, approximate: false };
  }
  const ml = toMl(amount, ref.unit)!;
  const oz = ml / ML_PER_OZ;
  const quarters = Math.round(oz * 4) / 4;
  const exact = `${trimNum(amount)} ${ref.unit}`;
  if (Math.abs(quarters - oz) < 0.005) {
    return { text: `${formatOzFraction(quarters)} oz`, approximate: false };
  }
  return {
    text: `≈ ${formatOzFraction(quarters)} oz`,
    approximate: true,
    exactHint: lang === "zh" ? `${exact} 原方` : `${exact} original`,
  };
}

type CountUnit = "piece" | "leaf" | "wedge" | "slice";
type SmallUnit = "dash" | "drop" | "barspoon" | "tsp";

const NO_AMOUNT_LABEL = {
  zh: { top_up: "补满", rim: "杯口圈", to_taste: "适量" },
  en: { top_up: "top up", rim: "rim", to_taste: "to taste" },
} as const;

const COUNT_LABEL = {
  zh: { piece: "个", leaf: "片", wedge: "角", slice: "片" },
  en: { piece: "pc", leaf: "leaves", wedge: "wedges", slice: "slices" },
} as const;

const SMALL_UNIT_LABEL = {
  zh: { dash: "dash", drop: "滴", barspoon: "吧勺", tsp: "茶匙" },
  en: { dash: "dash", drop: "drops", barspoon: "barspoon", tsp: "tsp" },
} as const;

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/* ────────────────────────── 按份显示 ────────────────────────── */

export interface PartsView {
  /** 约简后的比例，与输入顺序一一对应。 */
  parts: number[];
  /** 比例是否足够干净到值得给用户看这个开关（容差 5%）。 */
  clean: boolean;
}

/**
 * 绝对量 → 按份（ADR-014）。存储始终是绝对量，这只是显示模式。
 *
 * **只在比例接近简单整数比时才让 UI 显示「按份」开关** ——
 * 45/20/15 约简成 3 : 1.33 : 1 毫无可读性，那就别提供。
 */
export function toParts(mls: readonly number[], tolerance = 0.05): PartsView {
  const positive = mls.filter((m) => m > 0);
  if (positive.length === 0) return { parts: mls.map(() => 0), clean: false };
  const base = Math.min(...positive);
  const raw = mls.map((m) => m / base);
  // 对每个比值找最近的 ½ 刻度，全部落在容差内才算「干净」
  const snapped = raw.map((r) => Math.round(r * 2) / 2);
  const clean = raw.every((r, i) => {
    const s = snapped[i]!;
    return s > 0 && Math.abs(r - s) / s <= tolerance;
  });
  return { parts: clean ? snapped : raw, clean };
}

/** 按份数缩放。计数单位向上取整（半片薄荷叶没有意义）。 */
export function scaleAmount(ref: IngredientRef, factor: number): number | undefined {
  if (!("amount" in ref)) return undefined;
  const scaled = ref.amount * factor;
  return requiresIntegerAmount(ref.unit) ? Math.ceil(scaled) : Math.round(scaled * 100) / 100;
}
