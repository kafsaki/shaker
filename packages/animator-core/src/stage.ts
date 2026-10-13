/**
 * 舞台布局（ADR-031）：器具剖面注册、台面站位、酒架瓶位。
 *
 * 舞台是一段吧台的侧视图：
 *   - 后墙两层酒架，配方用到的每种液体原料一瓶（按首次使用排序，先摆下层）；
 *   - 台面上从左到右：搅拌机 → 搅拌杯 → 摇壶 → 第二容器 → 成品杯 → 量酒器；
 *     只摆这份配方用得到的。放不下时整体等比缩小（ShapeData 不变，姿态 scale 变）。
 *
 * 几何只在这里定一次；渲染器从 Timeline.stage 读酒架与台面，不再自己约定台面线。
 */
import {
  containersUsed,
  unitKind,
  type ContainerId,
  type IngredientMeta,
  type IngredientRef,
  type RecipeIR,
  type VesselSpec,
} from "@shaker/recipe-ir/core";
import { compileVessel } from "@shaker/recipe-ir/core";
import {
  BOTTLE_HEIGHTS,
  BOTTLE_NECK_AT,
  BOTTLE_VESSEL_DEFS,
  WORK_VESSEL_DEFS,
} from "@shaker/visual-assets";
import { footDrop, rimRadius, shapeFromVessel } from "./geometry.ts";
import { hashString } from "./random.ts";
import type { BottleLook, ResolvedVocab, ShapeData, StageLayout } from "./types.ts";

export const DEFAULT_STAGE = { width: 400, height: 520 };

/** 工作容器的内置剖面 id。 */
export const WORK_VESSEL_IDS: Record<Exclude<ContainerId, "glass">, string> = {
  shaker: "__shaker",
  mixing_glass: "__mixing_glass",
  blender: "__blender",
  secondary: "__secondary",
};

/**
 * 内置工作器具（含 __jigger）。剖面数据住在 @shaker/visual-assets；这里只做编译缓存。
 * 词表命中优先，未命中回退到这里 —— compile 是纯函数，词表缺摇壶不能导致编译失败。
 */
export const WORK_VESSELS: ReadonlyMap<string, VesselSpec> = new Map(
  [...WORK_VESSEL_DEFS, ...BOTTLE_VESSEL_DEFS].map((d) => [d.id, compileVessel(d)]),
);

/**
 * 工作器具在舞台上的绘制高度（舞台单位）。它们的剖面按容量反推出的真实尺寸
 * 太大（530ml 的摇壶有半个舞台高），按「放得进吧台、比例可信」定高；液面求解只看
 * 体积分数，与绝对尺寸无关。玻璃杯保持真实尺寸（20 单位/厘米）。
 */
const WORK_HEIGHTS: Record<string, number> = {
  __shaker: 196,
  __mixing_glass: 150,
  __blender: 196,
  __secondary: 150,
  __jigger: 60,
};

/** 搅拌机底座的高度（舞台单位）：搅拌杯坐在底座上。 */
export const BLENDER_BASE_H = 44;

/** 台面线：舞台底部留 14 个像素格（56 单位）的台面前沿。 */
function counterYOf(stageH: number): number {
  return stageH - 56;
}

export interface Station {
  id: string;
  x: number;
  /** 静置时碗底中心的 y（= 台面线 − 柱脚/底座落差）。 */
  y: number;
  scale: number;
}

export interface BottleSlot {
  id: string;
  ingredientId: string;
  shapeId: string;
  x: number;
  /** 瓶底 y（站在隔板上）。 */
  y: number;
  look: BottleLook;
}

export interface Layout {
  stage: StageLayout;
  shapes: Record<string, ShapeData>;
  stations: Map<string, Station>;
  bottles: Map<string, BottleSlot>;
  /** 酒架上瓶子的缩放（远处、小一号）；拿到手里放大到 HAND_SCALE。 */
  shelfScale: number;
  /** 配方用到量酒器吗（决定量酒器站位要不要摆）。 */
  hasJigger: boolean;
}

export const HAND_SCALE = 0.82;
const SHELF_SCALE = 0.56;

export function layout(
  ir: RecipeIR,
  vocab: ResolvedVocab,
  size: { width: number; height: number } = DEFAULT_STAGE,
): Layout {
  const counterY = counterYOf(size.height);
  const shapes: Record<string, ShapeData> = {};

  const used = containersUsed(ir);
  used.add("glass");
  const order: ContainerId[] = ["blender", "mixing_glass", "shaker", "secondary", "glass"];
  const containers = order.filter((c) => used.has(c));

  for (const c of containers) {
    const shapeId = c === "glass" ? ir.glass : WORK_VESSEL_IDS[c];
    const spec = vocab.vessel(shapeId) ?? WORK_VESSELS.get(shapeId);
    if (!spec) throw new Error(`容器 ${c} 的杯型 "${shapeId}" 不在词表中`);
    // 摇壶是不锈钢的：看不见里面（真实的），摇和时壶壁起霜是看点
    shapes[c] = shapeFromVessel(spec, shapeId === "__shaker" ? "metal" : "glass", WORK_HEIGHTS[shapeId]);
    shapes[c]!.id = shapeId;
  }

  // 量酒器：有按量（ml/oz/cl、≤ 一个量杯）倒注的原料才摆出来
  const bySlot = new Map(ir.ingredients.map((r) => [r.slot, r]));
  const hasJigger = ir.steps.some(
    (s) =>
      (s.action === "ADD" || s.action === "FLOAT" || s.action === "RINSE") &&
      s.items.some((slot) => {
        const r = bySlot.get(slot);
        return r !== undefined && pourMode(r, vocab) === "jigger";
      }),
  );
  if (hasJigger) {
    const spec = vocab.vessel("__jigger") ?? WORK_VESSELS.get("__jigger")!;
    shapes.jigger = { ...shapeFromVessel(spec, "metal", WORK_HEIGHTS.__jigger), id: "__jigger" };
  }

  // ── 台面站位：按宽度排开，放不下就整体缩小 ──
  const items = [...containers.map(String), ...(hasJigger ? ["jigger"] : [])];
  const widthOf = (id: string): number => {
    const s = shapes[id]!;
    const r = Math.max(rimRadius(s), ...s.radii, s.base?.radius ?? 0);
    return r * 2;
  };
  const gap = 18;
  const margin = 14;
  const natural = items.reduce((w, id) => w + widthOf(id), 0) + gap * (items.length - 1);
  const avail = size.width - margin * 2;
  // 高杯（柯林斯 13.7cm = 274 单位）按真实尺寸会顶到酒架：最高的器具限高 MAX_VESSEL_H，
  // 所有台面器具同比例缩放 —— 器具之间的相对大小仍然真实
  const tallest = Math.max(...items.map((id) => shapes[id]!.height));
  const scale = Math.min(1, avail / natural, MAX_VESSEL_H / tallest);
  const stations = new Map<string, Station>();
  const total = natural * scale;
  let cursor = (size.width - total) / 2;
  let minTop = counterY;
  for (const id of items) {
    const w = widthOf(id) * scale;
    const s = shapes[id]!;
    const lift = s.id === "__blender" ? BLENDER_BASE_H : footDrop(s);
    const y = counterY - lift * scale;
    stations.set(id, { id, x: cursor + w / 2, y, scale });
    minTop = Math.min(minTop, y - s.height * scale);
    cursor += w + gap * scale;
  }

  // ── 酒架：隔板在最高器具的杯口之上，每种液体原料一瓶 ──
  const liquids: IngredientRef[] = [];
  const seen = new Set<string>();
  for (const step of ir.steps) {
    if (!("items" in step) || !step.items) continue;
    if (!["ADD", "FLOAT", "TOP_UP", "RINSE"].includes(step.action)) continue;
    for (const slot of step.items) {
      const r = bySlot.get(slot);
      if (!r || seen.has(r.ingredientId) || pourMode(r, vocab) === "solid") continue;
      seen.add(r.ingredientId);
      liquids.push(r);
    }
  }
  const bottleShape = (r: IngredientRef) => bottleShapeFor(r, vocab.ingredient(r.ingredientId));
  const tallBottle = Math.max(100, ...liquids.map((r) => BOTTLE_HEIGHTS[bottleShape(r)] ?? 160));
  // 下层隔板离最高杯口留一段空：倒酒的瓶子、量酒器在这段空里动作，酒瓶不会像「坐在杯口上」
  const lower = Math.round(minTop - 44);
  const twoRows = liquids.length > 5;
  const shelfScale = twoRows
    ? Math.min(SHELF_SCALE, (lower - 40) / (2 * tallBottle))
    : Math.min(SHELF_SCALE, (lower - 24) / tallBottle);
  const upper = Math.round(lower - tallBottle * shelfScale - 14);
  const shelves = [
    { y: lower, x0: 12, x1: size.width - 12 },
    ...(upper > 30 ? [{ y: upper, x0: 12, x1: size.width - 12 }] : []),
  ];
  const bottles = new Map<string, BottleSlot>();
  const perShelf = twoRows ? Math.ceil(liquids.length / 2) : liquids.length;
  liquids.forEach((r, i) => {
    const onLower = i < perShelf || shelves.length < 2;
    const shelf = onLower ? shelves[0]! : shelves[1]!;
    const k = onLower ? i : i - perShelf;
    const n = onLower ? Math.min(perShelf, liquids.length) : liquids.length - perShelf;
    const span = Math.min(shelf.x1 - shelf.x0 - 40, n * 62);
    const x = size.width / 2 - span / 2 + (span * (k + 0.5)) / n;
    const meta = vocab.ingredient(r.ingredientId);
    const shapeId = bottleShape(r);
    if (!shapes[shapeId]) {
      shapes[shapeId] = {
        ...shapeFromVessel(WORK_VESSELS.get(shapeId)!, "bottle", BOTTLE_HEIGHTS[shapeId]),
        neckAt: BOTTLE_NECK_AT[shapeId],
      };
    }
    const id = `bottle:${r.ingredientId}`;
    bottles.set(id, {
      id,
      ingredientId: r.ingredientId,
      shapeId,
      x,
      y: shelf.y,
      look: bottleLook(r.ingredientId, meta, shapeId),
    });
  });

  return {
    stage: { width: size.width, height: size.height, counterY, shelves },
    shapes,
    stations,
    bottles,
    shelfScale,
    hasJigger,
  };
}

/** 台面上最高器具的绘制高度上限（舞台单位）。 */
const MAX_VESSEL_H = 196;

/* ────────────────────────── 原料 → 倒注方式 / 酒瓶 ────────────────────────── */

/** 一个量杯的容量（ml）：不超过它的按量倒注走量酒器，超过就直接从瓶里倒。 */
export const JIGGER_ML = 45;

export type PourMode = "jigger" | "free" | "dash" | "top" | "solid";

export function pourMode(r: IngredientRef, vocab: ResolvedVocab): PourMode {
  const kind = unitKind(r.unit);
  if (kind === "count" || r.unit === "rim" || r.unit === "to_taste") {
    const meta = vocab.ingredient(r.ingredientId);
    // to_taste 的液体（如少许柠檬汁）当小剂量直倒
    if (r.unit === "to_taste" && meta && meta.category !== "garnish" && meta.category !== "spice_herb") {
      return "free";
    }
    return "solid";
  }
  if (kind === "quasi_volume") return "dash";
  if (r.unit === "top_up") return "top";
  if (kind === "spoon") return "free";
  const ml = "amount" in r ? (r.unit === "oz" ? r.amount * 29.57 : r.unit === "cl" ? r.amount * 10 : r.amount) : 0;
  return ml > JIGGER_ML + 0.5 ? "free" : "jigger";
}

function bottleShapeFor(r: IngredientRef, meta: IngredientMeta | undefined): string {
  if (!meta) return "__bottle_spirit";
  const kind = unitKind(r.unit);
  if (kind === "quasi_volume") return "__bottle_bitters";
  if (meta.viz.carbonated) return "__bottle_soda";
  switch (meta.category) {
    case "juice":
    case "dairy_egg":
    case "coffee_tea":
      return "__bottle_carafe";
    case "syrup_sweetener":
      return "__bottle_syrup";
    case "liqueur":
    case "amaro_bitter":
    case "fortified_wine":
    case "wine_beer":
      return "__bottle_liqueur";
    case "mixer":
      return "__bottle_soda";
    default:
      return "__bottle_spirit";
  }
}

const LABELS = ["#efe2c4", "#c8423a", "#2a2a33", "#d9a640", "#3b6e8f", "#f4f0e6", "#5a7a3a"];
const CAPS = ["#d8d2c4", "#b8892e", "#6b3a2a", "#2a2a33"];

function bottleLook(id: string, meta: IngredientMeta | undefined, shapeId: string): BottleLook {
  const h = hashString(id);
  const liquid = meta?.viz.color ?? "#d8d2c4";
  // 透明液体装在淡绿/无色玻璃里，有色液体装在近无色玻璃里 —— 让酒色透出来
  const clearish = (meta?.viz.texture ?? "clear") === "clear" && luminance(liquid) > 0.82;
  const glass =
    shapeId === "__bottle_bitters"
      ? "#3a2418"
      : shapeId === "__bottle_soda"
        ? "#9fd0b8"
        : clearish
          ? h % 2 === 0
            ? "#bcd8cc"
            : "#d6e2ea"
          : "#d8dce4";
  return {
    liquid,
    glass,
    label: LABELS[h % LABELS.length]!,
    cap: CAPS[(h >>> 4) % CAPS.length]!,
    dasher: shapeId === "__bottle_bitters",
  };
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
