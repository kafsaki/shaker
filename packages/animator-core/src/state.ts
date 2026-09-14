/**
 * 容器状态机（规范 §4）。
 *
 * `reduce(steps)` 逐步演化状态，每步产出关键帧。这里只管**语义**——
 * 液体去了哪里、混到什么程度、温度多少；不管画面。
 */
import {
  dominantTexture,
  hexToRgb,
  iceOccupancy,
  mixLiquids,
  physics,
  refToMl,
  rgbToHex,
  unitKind,
  type ContainerId,
  type IceType,
  type IngredientRef,
  type Texture,
  type VesselSpec,
} from "@shaker/recipe-ir/core";
import type { ResolvedVocab } from "./types.ts";

export interface LiquidLayer {
  volumeMl: number;
  /** hex 颜色。 */
  color: string;
  opacity: number;
  /** g/cm³，决定分层顺序。 */
  density: number;
  carbonation: number;
  texture: Texture;
  /** 溯源，供 UI 高亮。 */
  sourceSlots: string[];
}

export interface SolidIce {
  kind: IceType;
  /** 这一批冰的实体积。 */
  solidMl: number;
  /** 容器内归一化坐标与尺寸，编译时一次性确定（确定性，无随机）。 */
  x: number;
  y: number;
  size: number;
  rot: number;
}

/** 已落位的装饰（容器状态的一部分 —— 装饰加进去之后不会在下一步消失）。 */
export interface PlacedGarnish {
  garnishId: string;
  position: "rim" | "in_glass" | "float" | "skewer" | "side";
  prep: string;
  color: string;
}

export interface ContainerState {
  id: ContainerId;
  vessel: VesselSpec;
  layers: LiquidLayer[];
  ice: SolidIce[];
  /** 泡沫体积（毫升）。 */
  foamMl: number;
  temperatureC: number;
  /** 冰融水（毫升）。 */
  dilutionMl: number;
  /** 0..1，连续的混合度（规范 §4.1）。 */
  mixedness: number;
  rim: { coverage: "full" | "half"; color: string } | null;
  smokeDensity: number;
  aromaMist: number;
  lidOn: boolean;
  /** 装饰物 —— 放进状态而不是只写关键帧，否则下一步重建场景时装饰会消失。 */
  garnishes: PlacedGarnish[];
  /** 是否已出现在场景里。 */
  active: boolean;
}

export function newContainer(id: ContainerId, vessel: VesselSpec): ContainerState {
  return {
    id,
    vessel,
    layers: [],
    ice: [],
    foamMl: 0,
    temperatureC: physics.TEMP_AMBIENT_C,
    dilutionMl: 0,
    mixedness: 0,
    rim: null,
    smokeDensity: 0,
    aromaMist: 0,
    lidOn: false,
    garnishes: [],
    active: false,
  };
}

/* ────────────────────────── 派生量 ────────────────────────── */

export function liquidMl(c: ContainerState): number {
  return c.layers.reduce((s, l) => s + l.volumeMl, 0) + c.dilutionMl;
}

export function iceSolidMl(c: ContainerState): number {
  return c.ice.reduce((s, i) => s + i.solidMl, 0);
}

/** 加冰后还能装多少液体。 */
export function liquidCapacityMl(c: ContainerState): number {
  return Math.max(0, c.vessel.def.capacityMl - iceSolidMl(c));
}

/* ────────────────────────── 加料 ────────────────────────── */

/**
 * dash / drop 的等效混色权重 —— 体积可忽略但着色能力强。
 * 见 recipe-ir/color.ts 的 TINT_WEIGHT_PER_DASH 注释。
 */
function tintWeight(ref: IngredientRef): number {
  const ml = refToMl(ref) ?? 0;
  if (ref.unit === "dash") {
    const amount = "amount" in ref ? ref.amount : 0;
    return amount * 4;
  }
  if (ref.unit === "drop") {
    const amount = "amount" in ref ? ref.amount : 0;
    return amount * 0.8;
  }
  return ml;
}

function layerFromRef(ref: IngredientRef, vocab: ResolvedVocab): LiquidLayer | null {
  const meta = vocab.ingredient(ref.ingredientId);
  if (!meta) return null;
  const kind = unitKind(ref.unit);
  // 只有体积/勺量计入液面；dash/drop 只调色（规范 §3.1）
  const volumeMl = kind === "volume" || kind === "spoon" ? (refToMl(ref) ?? 0) : 0;
  return {
    volumeMl,
    color: meta.viz.color,
    opacity: meta.viz.opacity ?? 0.9,
    density: meta.density ?? 1.0,
    carbonation: meta.viz.carbonated ? 1 : 0,
    texture: meta.viz.texture ?? "clear",
    sourceSlots: [ref.slot],
  };
}

/**
 * 把原料加入容器。
 *
 * `forceNewLayer` 为 true 时（FLOAT）强制新建独立层，绕过密度判断 ——
 * **作者的显式意图优先于物理**（规范 §7.3）。
 */
export function addToContainer(
  c: ContainerState,
  refs: readonly IngredientRef[],
  vocab: ResolvedVocab,
  forceNewLayer = false,
): void {
  c.active = true;
  for (const ref of refs) {
    const incoming = layerFromRef(ref, vocab);
    if (!incoming) continue;

    // dash / drop：不增加体积，只把颜色混进最上层
    if (incoming.volumeMl === 0) {
      const top = c.layers[c.layers.length - 1];
      if (top) {
        tintLayer(top, incoming.color, tintWeight(ref));
        top.sourceSlots.push(ref.slot);
      } else {
        c.layers.push({ ...incoming, volumeMl: 0 });
      }
      continue;
    }

    if (forceNewLayer) {
      c.layers.push(incoming);
      continue;
    }

    // 密度接近现有层 → 并入；差异大 → 新建层并按密度排序
    const target = c.layers.find(
      (l) => Math.abs(l.density - incoming.density) < physics.LAYER_MERGE_DENSITY_THRESHOLD,
    );
    if (target) {
      mergeInto(target, incoming);
    } else {
      c.layers.push(incoming);
    }
  }
  if (!forceNewLayer) sortByDensity(c);
}

/** 把 incoming 并入 target（减色混合 + 体积加权的其它字段）。 */
function mergeInto(target: LiquidLayer, incoming: LiquidLayer): void {
  const total = target.volumeMl + incoming.volumeMl;
  if (total <= 0) return;
  target.color = rgbToHex(
    mixLiquids([
      { color: hexToRgb(target.color), weight: target.volumeMl },
      { color: hexToRgb(incoming.color), weight: incoming.volumeMl },
    ]),
  );
  target.opacity = (target.opacity * target.volumeMl + incoming.opacity * incoming.volumeMl) / total;
  target.density = (target.density * target.volumeMl + incoming.density * incoming.volumeMl) / total;
  target.carbonation =
    (target.carbonation * target.volumeMl + incoming.carbonation * incoming.volumeMl) / total;
  target.texture = dominantTexture([target.texture, incoming.texture]);
  target.sourceSlots.push(...incoming.sourceSlots);
  target.volumeMl = total;
}

/** 只调色不加量（dash / drop）。 */
function tintLayer(layer: LiquidLayer, color: string, weight: number): void {
  if (weight <= 0) return;
  layer.color = rgbToHex(
    mixLiquids([
      { color: hexToRgb(layer.color), weight: layer.volumeMl },
      { color: hexToRgb(color), weight },
    ]),
  );
}

/** 重的在下。 */
function sortByDensity(c: ContainerState): void {
  c.layers.sort((a, b) => b.density - a.density);
}

/* ────────────────────────── 冰 ────────────────────────── */

/**
 * 加冰。冰块的位置用**确定性**伪随机排布（seed 来自容器 id 与批次序号），
 * 保证同一份 IR 每次编译出完全相同的画面（规范 §9.2：compile 必须是纯函数）。
 */
export function addIce(c: ContainerState, kind: IceType, fill: number): void {
  c.active = true;
  const occ = iceOccupancy(c.vessel.def.capacityMl, kind, fill);
  if (occ.solidMl <= 0) {
    // 干冰：不排水，只标记产烟
    c.smokeDensity = Math.max(c.smokeDensity, 0.6);
    return;
  }

  const count = iceCount(kind, fill);
  const size = iceSize(kind);
  const perPiece = occ.solidMl / Math.max(1, count);
  const rnd = makeRandom(hashString(`${c.id}:${kind}:${c.ice.length}`));

  for (let i = 0; i < count; i++) {
    c.ice.push({
      kind,
      solidMl: perPiece,
      x: (rnd() * 2 - 1) * 0.62,
      y: (i + 0.5) / count * fill,
      size: size * (0.85 + rnd() * 0.3),
      rot: rnd() * Math.PI * 2,
    });
  }

  // 碎冰让液体变浑浊
  const clouding = physics.ICE_CLOUDING[kind];
  if (clouding > 0) {
    for (const l of c.layers) {
      if (l.texture === "clear") l.texture = "cloudy";
    }
  }
  c.temperatureC = Math.min(c.temperatureC, 2);
}

function iceCount(kind: IceType, fill: number): number {
  const base: Record<IceType, number> = {
    cube: 5,
    large_cube: 2,
    sphere: 1,
    cracked: 8,
    crushed: 26,
    block: 1,
    dry_ice: 1,
  };
  return Math.max(1, Math.round(base[kind] * Math.max(0.3, fill)));
}

function iceSize(kind: IceType): number {
  const s: Record<IceType, number> = {
    cube: 0.2,
    large_cube: 0.34,
    sphere: 0.44,
    cracked: 0.15,
    crushed: 0.08,
    block: 0.3,
    dry_ice: 0.2,
  };
  return s[kind];
}

/* ────────────────────────── 混合 ────────────────────────── */

/**
 * 提高混合度。达到 1.0 时把所有层合并成单层（加权减色混合）；
 * < 1 时保留多层，层间渐变带宽度由 mixedness 控制。
 *
 * **这是「摇匀」和「分层」能用同一套代码表达的关键**（规范 §4.1）。
 */
export function mix(c: ContainerState, target: number, opts?: { cloudy?: boolean }): void {
  c.mixedness = Math.max(c.mixedness, Math.min(1, target));

  if (opts?.cloudy) {
    for (const l of c.layers) {
      if (l.texture === "clear") l.texture = "cloudy";
    }
  }

  if (c.mixedness >= 1 && c.layers.length > 1) {
    const total = c.layers.reduce((s, l) => s + l.volumeMl, 0);
    const merged: LiquidLayer = {
      volumeMl: total,
      color: rgbToHex(
        mixLiquids(c.layers.map((l) => ({ color: hexToRgb(l.color), weight: l.volumeMl }))),
      ),
      opacity: weighted(c.layers, (l) => l.opacity, total),
      density: weighted(c.layers, (l) => l.density, total),
      carbonation: weighted(c.layers, (l) => l.carbonation, total),
      texture: dominantTexture(c.layers.map((l) => l.texture)),
      sourceSlots: c.layers.flatMap((l) => l.sourceSlots),
    };
    c.layers = [merged];
  }
}

function weighted(
  layers: readonly LiquidLayer[],
  pick: (l: LiquidLayer) => number,
  total: number,
): number {
  if (total <= 0) return 0;
  return layers.reduce((s, l) => s + pick(l) * l.volumeMl, 0) / total;
}

/** 加稀释（冰融水）。只在有冰时生效。 */
export function dilute(c: ContainerState, rate: number): void {
  if (c.ice.length === 0) return;
  c.dilutionMl += liquidMl(c) * rate;
  c.temperatureC = Math.min(c.temperatureC, physics.TEMP_CHILLED_C);
}

/** 摇散气泡（规范 §7.2）。 */
export function killCarbonation(c: ContainerState): void {
  if (!physics.SHAKE_KILLS_CARBONATION) return;
  for (const l of c.layers) l.carbonation = 0;
}

/** 起泡。foaming 高的原料在干摇下产生更多泡沫。 */
export function buildFoam(
  c: ContainerState,
  refs: readonly IngredientRef[],
  vocab: ResolvedVocab,
  yieldFactor: number,
): void {
  let foamingMl = 0;
  for (const ref of refs) {
    const meta = vocab.ingredient(ref.ingredientId);
    const foaming = meta?.viz.foaming ?? 0;
    if (foaming <= 0) continue;
    foamingMl += (refToMl(ref) ?? 0) * foaming;
  }
  if (foamingMl > 0) c.foamMl += foamingMl * yieldFactor;
}

/* ────────────────────────── 转移 ────────────────────────── */

export interface TransferOptions {
  /** 冰是否随液体一起过去（DUMP 为 true，STRAIN 为 false）。 */
  carryIce: boolean;
  /** 细滤：滤掉浑浊，提升清澈度。 */
  fineStrain?: boolean;
}

export function transfer(
  from: ContainerState,
  to: ContainerState,
  opts: TransferOptions,
): void {
  to.active = true;
  for (const l of from.layers) {
    const moved: LiquidLayer = { ...l, sourceSlots: [...l.sourceSlots] };
    if (opts.fineStrain && moved.texture === "cloudy") moved.texture = "clear";
    to.layers.push(moved);
  }
  to.dilutionMl += from.dilutionMl;
  to.foamMl += from.foamMl;
  to.mixedness = Math.max(to.mixedness, from.mixedness);
  to.temperatureC = Math.min(to.temperatureC, from.temperatureC);

  if (opts.carryIce) {
    to.ice.push(...from.ice.map((i) => ({ ...i })));
    from.ice = [];
  }

  from.layers = [];
  from.dilutionMl = 0;
  from.foamMl = 0;
  // 目标容器里若有多层且已混匀，重新合并
  if (to.mixedness >= 1) mix(to, 1);
  else sortByDensity(to);
}

/* ────────────────────────── 确定性伪随机 ────────────────────────── */

/**
 * mulberry32 —— 小、快、够用。
 *
 * **compile 必须是纯函数**（规范 §9.2）：同一份输入在浏览器、Node、WebView 里
 * 必须产出逐字节相同的 Timeline。所以任何"随机"都必须来自显式 seed。
 */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
