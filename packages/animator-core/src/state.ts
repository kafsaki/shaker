/**
 * 容器语义状态（规范 §4）：液体去了哪里、混到什么程度、温度多少 —— 不管画面。
 *
 * 编排在每个动作前后把它快照进 contents 轨道（world.snap），取样时插值。
 * 液层带稳定 uid：插值按 uid 配对，新层从 0 长出、消失的层缩到 0。
 */
import {
  dominantTexture,
  hexToRgb,
  mixLiquids,
  physics,
  refToMl,
  rgbToHex,
  unitKind,
  type IngredientRef,
} from "@shaker/recipe-ir/core";
import type { Contents, GarnishState, LayerState, ResolvedVocab, SolidState } from "./types.ts";

export interface Sem {
  layers: LayerState[];
  iceSolidMl: number;
  icePorosity: number;
  foamMl: number;
  foamColor: string;
  temperatureC: number;
  mixedness: number;
  rim: Contents["rim"];
  coat: Contents["coat"];
  garnishes: GarnishState[];
  solids: SolidState[];
}

export function newSem(): Sem {
  return {
    layers: [],
    iceSolidMl: 0,
    icePorosity: 0.4,
    foamMl: 0,
    foamColor: "#fbf8f2",
    temperatureC: physics.TEMP_AMBIENT_C,
    mixedness: 0,
    rim: null,
    coat: null,
    garnishes: [],
    solids: [],
  };
}

/** 快照：深拷贝成 Contents（轨道里的值不可变）。 */
export function toContents(s: Sem): Contents {
  return {
    layers: s.layers.map((l) => ({ ...l, sourceSlots: [...l.sourceSlots] })),
    iceSolidMl: s.iceSolidMl,
    icePorosity: s.icePorosity,
    foamMl: s.foamMl,
    foamColor: s.foamColor,
    mixedness: s.mixedness,
    rim: s.rim ? { ...s.rim } : null,
    coat: s.coat ? { ...s.coat } : null,
    garnishes: s.garnishes.map((g) => ({ ...g })),
    solids: s.solids.map((g) => ({ ...g })),
  };
}

export function liquidMl(s: Sem): number {
  return s.layers.reduce((a, l) => a + l.ml, 0);
}

/**
 * 液体 + 冰在杯里实际占据的体积（毫升）——液面由它决定。
 *
 * 冰堆的外包体积 = 冰实体积 / (1 − 孔隙率)。液体少时只填冰堆孔隙（液面 = 液量 / 孔隙率），
 * 漫过冰堆后占位 = 液体 + 冰实体积。两段在冰堆顶处连续。
 */
export function occupiedMl(liquid: number, iceSolid: number, porosity: number): number {
  if (iceSolid <= 0) return liquid;
  const por = Math.max(0.05, Math.min(0.95, porosity));
  const pile = iceSolid / (1 - por);
  return liquid < pile * por ? liquid / por : liquid + iceSolid;
}

export function semOccupied(s: Sem): number {
  return occupiedMl(liquidMl(s), s.iceSolidMl, s.icePorosity);
}

/** 稳定 uid 的发号器（每次 compile 新建，保证确定性）。 */
export interface Uids {
  next: number;
}

/* ────────────────────────── 加料 ────────────────────────── */

/** dash / drop 的等效混色权重 —— 体积可忽略但着色能力强（见 recipe-ir/color.ts）。 */
function tintWeight(ref: IngredientRef): number {
  const amount = "amount" in ref ? ref.amount : 0;
  if (ref.unit === "dash") return amount * 4;
  if (ref.unit === "drop") return amount * 0.8;
  return refToMl(ref) ?? 0;
}

/** 原料 → 液层。体积只计体积/勺量单位；dash/drop 体积为 0（只调色）。 */
export function layerOf(ref: IngredientRef, vocab: ResolvedVocab, uids: Uids, mlOverride?: number): LayerState | null {
  const meta = vocab.ingredient(ref.ingredientId);
  if (!meta) return null;
  const kind = unitKind(ref.unit);
  const ml = mlOverride ?? (kind === "volume" || kind === "spoon" ? (refToMl(ref) ?? 0) : 0);
  return {
    uid: uids.next++,
    ml,
    color: meta.viz.color,
    opacity: meta.viz.opacity ?? 0.9,
    density: meta.density ?? 1.0,
    carbonation: meta.viz.carbonated ? 1 : 0,
    texture: meta.viz.texture ?? "clear",
    sourceSlots: [ref.slot],
  };
}

/**
 * 倒入一层液体。`forceNewLayer`（FLOAT）绕过密度判断 —— 作者的显式意图优先于物理（§7.3）。
 * 返回实际并入/新建的层（倒注液流用它的颜色）。
 */
export function pourIn(s: Sem, incoming: LayerState, tint: number, forceNewLayer = false): void {
  if (incoming.ml <= 0) {
    // dash / drop：不增加体积，只把颜色混进最上层
    const top = s.layers[s.layers.length - 1];
    if (top) {
      tintInto(top, incoming.color, tint);
      top.sourceSlots.push(...incoming.sourceSlots);
    }
    return;
  }
  if (forceNewLayer) {
    s.layers.push(incoming);
    return;
  }
  const target = s.layers.find(
    (l) => Math.abs(l.density - incoming.density) < physics.LAYER_MERGE_DENSITY_THRESHOLD,
  );
  if (target) mergeInto(target, incoming);
  else s.layers.push(incoming);
  // 重的在下（稳定排序：同密度保持倒入顺序）
  s.layers.sort((a, b) => b.density - a.density);
}

export function tintOf(ref: IngredientRef): number {
  return tintWeight(ref);
}

function mergeInto(target: LayerState, incoming: LayerState): void {
  const total = target.ml + incoming.ml;
  if (total <= 0) return;
  target.color = rgbToHex(
    mixLiquids([
      { color: hexToRgb(target.color), weight: target.ml },
      { color: hexToRgb(incoming.color), weight: incoming.ml },
    ]),
  );
  target.opacity = (target.opacity * target.ml + incoming.opacity * incoming.ml) / total;
  target.density = (target.density * target.ml + incoming.density * incoming.ml) / total;
  target.carbonation = (target.carbonation * target.ml + incoming.carbonation * incoming.ml) / total;
  target.texture = dominantTexture([target.texture, incoming.texture]);
  target.sourceSlots.push(...incoming.sourceSlots);
  target.ml = total;
}

function tintInto(layer: LayerState, color: string, weight: number): void {
  if (weight <= 0) return;
  layer.color = rgbToHex(
    mixLiquids([
      { color: hexToRgb(layer.color), weight: Math.max(1, layer.ml) },
      { color: hexToRgb(color), weight },
    ]),
  );
}

/* ────────────────────────── 混合 / 稀释 ────────────────────────── */

/**
 * 提高混合度。达到 LAYER_MERGE_MIXEDNESS 时所有层合并成单层（新 uid）。
 * 这是「摇匀」和「分层」能用同一套代码表达的关键（§4.1）。
 */
export function mix(s: Sem, target: number, uids: Uids, opts?: { cloudy?: boolean }): void {
  s.mixedness = Math.max(s.mixedness, Math.min(1, target));
  if (opts?.cloudy) for (const l of s.layers) if (l.texture === "clear") l.texture = "cloudy";
  if (s.mixedness >= physics.LAYER_MERGE_MIXEDNESS && s.layers.length > 1) {
    const total = liquidMl(s);
    const w = (pick: (l: LayerState) => number) =>
      total > 0 ? s.layers.reduce((a, l) => a + pick(l) * l.ml, 0) / total : 0;
    s.layers = [
      {
        uid: uids.next++,
        ml: total,
        color: rgbToHex(mixLiquids(s.layers.map((l) => ({ color: hexToRgb(l.color), weight: l.ml })))),
        opacity: w((l) => l.opacity),
        density: w((l) => l.density),
        carbonation: w((l) => l.carbonation),
        texture: dominantTexture(s.layers.map((l) => l.texture)),
        sourceSlots: s.layers.flatMap((l) => l.sourceSlots),
      },
    ];
  }
}

/**
 * 冰融水：按比例放大各层体积，颜色向水淡一点。只在有冰时生效。
 * `capMl`：容器容量 —— 补满后再搅，融水不能把液面顶出杯口（冰化掉的部分让出空间）。
 */
export function dilute(s: Sem, rate: number, capMl = Infinity): void {
  if (s.iceSolidMl <= 0 || rate <= 0) return;
  const liquid = liquidMl(s);
  // 化掉的冰：实体积减少，融水体积 ≈ 化掉的冰（密度 0.92，忽略）
  let water = liquid * rate;
  const melted = Math.min(s.iceSolidMl * 0.5, water);
  s.iceSolidMl -= melted;
  const room = capMl - physics.HEADROOM_ML - occupiedMl(liquid, s.iceSolidMl, s.icePorosity);
  water = Math.max(0, Math.min(water, room + melted * 0.2));
  const k = liquid > 0 ? water / liquid : 0;
  for (const l of s.layers) {
    l.color = rgbToHex(
      mixLiquids([
        { color: hexToRgb(l.color), weight: l.ml },
        { color: hexToRgb("#f2f6f8"), weight: l.ml * k * 0.35 },
      ]),
    );
    l.opacity = Math.max(0.35, l.opacity * (1 - k * 0.25));
    l.ml += l.ml * k;
  }
  s.temperatureC = Math.min(s.temperatureC, physics.TEMP_CHILLED_C);
}

export function killCarbonation(s: Sem): void {
  if (!physics.SHAKE_KILLS_CARBONATION) return;
  for (const l of s.layers) l.carbonation = 0;
}

export function buildFoam(s: Sem, refs: readonly IngredientRef[], vocab: ResolvedVocab, yieldFactor: number): void {
  let foamingMl = 0;
  for (const ref of refs) {
    const foaming = vocab.ingredient(ref.ingredientId)?.viz.foaming ?? 0;
    if (foaming > 0) foamingMl += (refToMl(ref) ?? 0) * foaming;
  }
  if (foamingMl > 0) s.foamMl += foamingMl * yieldFactor;
}

/* ────────────────────────── 转移 ────────────────────────── */

/** 把 from 的全部液体倒进 to。返回倒出的毫升数与混合色（液流颜色）。 */
export function transfer(
  from: Sem,
  to: Sem,
  opts: { fineStrain?: boolean },
): { ml: number; color: string } {
  const ml = liquidMl(from);
  const color =
    from.layers.length > 0
      ? rgbToHex(mixLiquids(from.layers.map((l) => ({ color: hexToRgb(l.color), weight: Math.max(0.1, l.ml) }))))
      : "#e8d9b0";
  if (from === to) return { ml: 0, color };
  for (const l of from.layers) {
    const moved: LayerState = { ...l, sourceSlots: [...l.sourceSlots] };
    if (opts.fineStrain && moved.texture === "cloudy") moved.texture = "clear";
    to.layers.push(moved);
  }
  to.foamMl += from.foamMl;
  to.mixedness = Math.max(to.mixedness, from.mixedness);
  to.temperatureC = Math.min(to.temperatureC, from.temperatureC);
  from.layers = [];
  from.foamMl = 0;
  to.layers.sort((a, b) => b.density - a.density);
  return { ml, color };
}

export function frostLevel(s: Sem): number {
  if (s.temperatureC >= physics.TEMP_FROST_THRESHOLD_C) return 0;
  const span = physics.TEMP_FROST_THRESHOLD_C - physics.TEMP_SWIZZLE_C;
  return Math.max(0, Math.min(1, (physics.TEMP_FROST_THRESHOLD_C - s.temperatureC) / span));
}

/** 层的混合色（倒注液流用）。 */
export function mixedColor(layers: readonly LayerState[]): string {
  if (layers.length === 0) return "#e8d9b0";
  return rgbToHex(mixLiquids(layers.map((l) => ({ color: hexToRgb(l.color), weight: Math.max(0.1, l.ml) }))));
}
