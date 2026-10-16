/**
 * 冰块堆积（ADR-031）：在杯型轮廓里逐块投放、落定，堆出自然的冰堆。
 *
 * 旧版按行等距摞高 —— 方冰是一根整齐的竖柱，碎冰挤成一条竖线。真实的冰：
 *   - 尺寸按真实冰块（方冰 ≈ 2.5cm、碎冰 0.6~1cm），同类型有 ±15% 偏差；
 *   - 落进杯里后左右滚动，找到局部最低的支撑点停下，彼此可以斜靠、留缝；
 *   - 侧视图有前后两排，后排被前排遮住一部分，堆的体积感从这里来。
 *
 * 算法是 2D 高度场：把杯宽切成 1 单位的柱，每块冰从随机横位落下，
 * 落点 = 它覆盖的各柱高度的最大值；然后向左右各试探 ±(半宽) 找更低的支撑，
 * 模拟滚落。前后两排各一个高度场，后排偏移半块，堆形自然错开。
 *
 * 纯函数：随机全部来自 seed（compile 纯函数纪律）。
 */
import { physics, type IceType } from "@shaker/recipe-ir/core";
import { radiusAtV } from "./geometry.ts";
import type { IcePiece, ShapeData } from "./types.ts";
import { makeRandom } from "./random.ts";

/** 真实冰块尺寸（厘米）：[宽, 高]。 */
const ICE_CM: Record<IceType, [number, number]> = {
  cube: [2.6, 2.6],
  large_cube: [5, 5],
  sphere: [5.5, 5.5],
  cracked: [1.9, 1.6],
  crushed: [0.85, 0.7],
  block: [3.6, 12],
  dry_ice: [1.6, 1.2],
};

export interface PileResult {
  pieces: IcePiece[];
  /** 冰堆顶面（局部 v）。 */
  topV: number;
}

/**
 * 往容器里堆冰，直到冰堆顶到达 fill × 杯高（或块数上限）。
 * `existing` 是已经在杯里的冰（第二次加冰时接着堆）。
 */
export function pileIce(
  shape: ShapeData,
  kind: IceType,
  fill: number,
  seed: number,
  existing: readonly IcePiece[] = [],
): PileResult {
  const rnd = makeRandom(seed);
  const [wCm, hCm] = ICE_CM[kind];
  // 冰块按真实厘米，换算用这只器具自己的比例尺（工作器具被画小了，见 ShapeData.cm）
  const baseW = wCm * shape.cm;
  const baseH = hCm * shape.cm;
  const target = Math.max(0, Math.min(1, fill)) * shape.height;

  const half = Math.ceil(maxRadius(shape)) + 2;
  const cols = half * 2 + 1;
  // 前后两排各一个高度场（局部 v）；已有的冰先压进去
  const fields: [Float64Array, Float64Array] = [new Float64Array(cols), new Float64Array(cols)];
  for (const p of existing) stamp(fields[p.depth], half, p.u, p.w, p.v + p.h / 2);

  const out: IcePiece[] = [];
  if (kind === "dry_ice") {
    // 干冰：几小块沉在杯底冒烟，不堆
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const w = baseW * (0.8 + rnd() * 0.4);
      const h = baseH * (0.8 + rnd() * 0.4);
      const rr = radiusAtV(shape, h) - w / 2 - 2;
      const u = (rnd() * 2 - 1) * Math.max(0, rr);
      out.push(piece(kind, u, h / 2, w, h, (rnd() - 0.5) * 0.4, rnd, i % 2 === 0 ? 1 : 0));
    }
    return { pieces: out, topV: baseH };
  }
  if (kind === "block") {
    // 长条冰：一根，贴杯底立着，略斜靠杯壁
    const w = Math.min(baseW, radiusAtV(shape, 0) * 1.3);
    const h = Math.min(baseH, shape.height * 0.88, Math.max(target, shape.height * 0.6));
    const lean = (rnd() * 2 - 1) * 0.05;
    out.push(piece(kind, (rnd() * 2 - 1) * 2, h / 2, w, h, lean, rnd, 1));
    return { pieces: out, topV: h };
  }
  if (kind === "sphere" || kind === "large_cube") {
    // 大冰：坐在杯底，放得下几块并排就几块（古典杯通常一块），不往上摞
    const inner = radiusAtV(shape, baseH * 0.5) * 2;
    const size0 = Math.min(baseW, inner * 0.92);
    const fit = Math.max(1, Math.floor(inner / (size0 * 1.04)));
    const n = Math.max(1, Math.min(fit, kind === "sphere" ? 1 : Math.round(2 * Math.max(0.5, fill))));
    let topV = 0;
    for (let i = 0; i < n; i++) {
      const w = size0 * (kind === "sphere" ? 1 : 0.94 + rnd() * 0.08);
      const h = kind === "sphere" ? w : w * (0.92 + rnd() * 0.12);
      const field = fields[1];
      const u = n === 1 ? (rnd() * 2 - 1) * Math.max(0, inner / 2 - w / 2 - 2) * 0.5 : (i - (n - 1) / 2) * (inner / n);
      const v0 = Math.max(supportUnder(field, half, u, w * 0.6), restOnWall(shape, u, w));
      const rot = kind === "sphere" ? 0 : (rnd() * 2 - 1) * 0.1;
      out.push(piece(kind, u, v0 + h / 2, w, h, rot, rnd, 1));
      stamp(field, half, u, w, v0 + h);
      topV = Math.max(topV, v0 + h);
    }
    return { pieces: out, topV };
  }

  // 方冰 / 裂冰 / 碎冰：逐块投放堆积
  const maxPieces = kind === "crushed" ? 160 : kind === "cracked" ? 48 : 22;
  let topV = 0;
  let guard = 0;
  while (out.length < maxPieces && guard++ < maxPieces * 4) {
    const depth: 0 | 1 = out.length % 3 === 1 ? 0 : 1; // 约三分之一在后排
    const field = fields[depth];
    const jitter = kind === "crushed" ? 0.35 : 0.15;
    const w = baseW * (1 - jitter + rnd() * jitter * 2);
    const h = kind === "cube" ? w * (0.94 + rnd() * 0.12) : baseH * (1 - jitter + rnd() * jitter * 2);
    // 先看当前堆的高度够不够了：用前排中段的平均高度当「冰堆顶」
    topV = Math.max(topV, meanTop(fields[1], half, shape));
    if (topV >= target && out.length > 0) break;

    // 随机横位落下
    const levelGuess = Math.min(shape.height, topV + h);
    const room = Math.max(0, radiusAtV(shape, levelGuess) - w / 2 - 1);
    let u = (rnd() * 2 - 1) * room;
    let v0 = supportUnder(field, half, u, w);
    // 滚落：往两侧试探，找更低的支撑（冰块在斜面上会滑下去）
    for (const step of [-w * 0.5, w * 0.5, -w, w]) {
      const u2 = u + step;
      const room2 = Math.max(0, radiusAtV(shape, v0 + h / 2) - w / 2 - 1);
      if (Math.abs(u2) > room2) continue;
      const v2 = supportUnder(field, half, u2, w);
      if (v2 < v0 - h * 0.25) {
        u = u2;
        v0 = v2;
      }
    }
    // 杯壁：锥形杯（马天尼）里冰被杯壁托住，不能穿过去
    v0 = Math.max(v0, restOnWall(shape, u, w));
    if (v0 + h > shape.height * 1.02) continue; // 堆出杯口了，换个位置
    // 斜靠：支撑面不平时冰块会歪，碎冰朝向完全随机
    const tilt =
      kind === "crushed"
        ? rnd() * Math.PI
        : slopeUnder(field, half, u, w) * 0.9 + (rnd() * 2 - 1) * (kind === "cracked" ? 0.5 : 0.18);
    out.push(piece(kind, u, v0 + h / 2, w, h, tilt, rnd, depth));
    stamp(field, half, u, w * (kind === "crushed" ? 0.8 : 0.9), v0 + h * (kind === "crushed" ? 0.75 : 0.92));
  }
  return { pieces: out, topV: Math.min(shape.height, Math.max(topV, meanTop(fields[1], half, shape))) };
}

/** 冰堆孔隙率（与 recipe-ir 的排水模型共用一份数）。 */
export function porosityOf(kind: IceType): number {
  return physics.ICE_POROSITY[kind];
}

function piece(
  kind: IceType,
  u: number,
  v: number,
  w: number,
  h: number,
  rot: number,
  rnd: () => number,
  depth: 0 | 1,
): IcePiece {
  return {
    kind,
    u,
    v,
    w,
    h,
    rot,
    seed: Math.floor(rnd() * 0x7fffffff),
    depth,
    dropAt: -Infinity,
    dropFromU: u,
    dropFromV: v,
    leaveAt: Infinity,
  };
}

function maxRadius(s: ShapeData): number {
  return s.radii.reduce((m, r) => Math.max(m, r), 0);
}

/** 宽 w、中心 u 的冰块底面落在高度场上的支撑高度。 */
function supportUnder(field: Float64Array, half: number, u: number, w: number): number {
  let m = 0;
  const a = Math.max(0, Math.floor(u - w / 2 + half));
  const b = Math.min(field.length - 1, Math.ceil(u + w / 2 + half));
  for (let i = a; i <= b; i++) m = Math.max(m, field[i]!);
  return m;
}

/** 支撑面的斜率（用于冰块倾斜）：左右两端支撑高度差 / 宽。 */
function slopeUnder(field: Float64Array, half: number, u: number, w: number): number {
  const l = supportUnder(field, half, u - w / 4, w / 2);
  const r = supportUnder(field, half, u + w / 4, w / 2);
  return Math.max(-0.5, Math.min(0.5, Math.atan2(l - r, w)));
}

function stamp(field: Float64Array, half: number, u: number, w: number, top: number): void {
  const a = Math.max(0, Math.floor(u - w / 2 + half));
  const b = Math.min(field.length - 1, Math.ceil(u + w / 2 + half));
  for (let i = a; i <= b; i++) field[i] = Math.max(field[i]!, top);
}

/** 宽 w 的块放在 u 处，下沿碰不到杯壁的最低高度（锥形杯底窄，冰块卡在半腰）。 */
function restOnWall(s: ShapeData, u: number, w: number): number {
  const need = Math.abs(u) + w / 2;
  for (let v = 0; v <= s.height; v += 1) {
    if (radiusAtV(s, v) >= need) return v;
  }
  return s.height;
}

/** 冰堆「顶面」：杯中段 60% 宽度里高度场的平均值 —— 液面高过它，冰就开始上浮。 */
function meanTop(field: Float64Array, half: number, s: ShapeData): number {
  const r = radiusAtV(s, 0) * 0.6;
  const a = Math.max(0, Math.floor(half - r));
  const b = Math.min(field.length - 1, Math.ceil(half + r));
  let sum = 0;
  for (let i = a; i <= b; i++) sum += field[i]!;
  return sum / Math.max(1, b - a + 1);
}

/**
 * 冰块浮起：液面高过冰堆顶时，整堆随液面上浮（冰密度 0.92，九成浸在水里）。
 * 返回上浮量（局部 v）。只在取样期调用 —— 冰堆形状编译期定死，上浮是液面的函数。
 */
export function floatLift(topV: number, levelV: number, pieceH: number): number {
  const freeboard = pieceH * 0.12; // 露出液面的高度
  return Math.max(0, levelV - topV + freeboard - pieceH * 0.08);
}
