/**
 * 器具几何：剖面换算、倾斜液面求解、口沿与出液点（ADR-031）。
 *
 * 这是整个动画器唯一的几何来源 —— 编排、取样、渲染器都调这里，
 * 不再有「核心手抄渲染器的像素换算」那种两份几何。
 *
 * 坐标约定：
 *   局部 (u, v)：u 向右、v 向上，原点 = 碗底中心（液体零点）。
 *   世界 (x, y)：y 向下。姿态 (x0, y0, rot)，rot 顺时针为正（口沿转向右下）。
 *     wx = x0 + u·cos + v·sin
 *     wy = y0 + u·sin − v·cos
 */
import { radiusAt, type VesselSpec } from "@shaker/recipe-ir/core";
import type { ShapeData } from "./types.ts";

/** 剖面 scale 的单位是厘米（见 recipe-ir/glass.ts），换算到舞台单位。 */
export const UNITS_PER_CM = 20;
/** 剖面采样数：足够让渲染器逐像素行取半径（130 行的舞台里杯高不超过 ~60 行）。 */
const RADII_N = 65;

export function shapeFromVessel(
  spec: VesselSpec,
  material: ShapeData["material"],
  overrideHeight?: number,
): ShapeData {
  const h = overrideHeight ?? spec.scale * UNITS_PER_CM;
  const profile = spec.def.shape.profile;
  const radii: number[] = [];
  for (let i = 0; i < RADII_N; i++) radii.push(smoothRadius(profile, i / (RADII_N - 1)) * h);
  const stem = spec.def.shape.stem;
  const base = spec.def.shape.base;
  return {
    id: spec.def.id,
    height: h,
    cm: h / spec.scale,
    capacityMl: spec.def.capacityMl,
    radii,
    stem: stem ? { height: stem.height * h, width: stem.width * h } : null,
    base: base ? { radius: base.radius * h } : null,
    material,
  };
}

/**
 * 剖面平滑：Catmull-Rom 穿过采样点，`corner` 点保持棱角。
 * 物理（体积↔高度）在 recipe-ir 里永远走分段线性；这里只影响外观与倾斜求解，
 * 偏差亚毫米级。
 */
function smoothRadius(profile: readonly { y: number; r: number; corner?: boolean }[], y: number): number {
  const n = profile.length;
  if (n < 3) return radiusAt(profile, y);
  let i = 0;
  while (i < n - 2 && profile[i + 1]!.y < y) i++;
  const p1 = profile[i]!;
  const p2 = profile[i + 1]!;
  if (p1.corner || p2.corner) return radiusAt(profile, y);
  const span = p2.y - p1.y;
  if (span <= 0) return p2.r;
  const t = Math.max(0, Math.min(1, (y - p1.y) / span));
  const p0 = i > 0 ? profile[i - 1]! : p1;
  const p3 = i + 2 < n ? profile[i + 2]! : p2;
  const r =
    0.5 *
    (2 * p1.r +
      (-p0.r + p2.r) * t +
      (2 * p0.r - 5 * p1.r + 4 * p2.r - p3.r) * t * t +
      (-p0.r + 3 * p1.r - 3 * p2.r + p3.r) * t * t * t);
  return Math.max(0.001, r);
}

/** 局部高度 v 处的半径（舞台单位），v 超出 [0, height] 夹紧。 */
export function radiusAtV(s: ShapeData, v: number): number {
  const n = s.radii.length;
  const f = Math.max(0, Math.min(1, v / s.height)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  return s.radii[i]! + (s.radii[i + 1]! - s.radii[i]!) * k;
}

export function rimRadius(s: ShapeData): number {
  return s.radii[s.radii.length - 1]!;
}

/* ────────────────────────── 姿态变换 ────────────────────────── */

export interface Frame {
  x: number;
  y: number;
  rot: number;
  scale: number;
}

export function toWorld(f: Frame, u: number, v: number): { x: number; y: number } {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const uu = u * f.scale;
  const vv = v * f.scale;
  return { x: f.x + uu * c + vv * s, y: f.y + uu * s - vv * c };
}

export function toLocal(f: Frame, x: number, y: number): { u: number; v: number } {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const dx = (x - f.x) / f.scale;
  const dy = (y - f.y) / f.scale;
  return { u: dx * c + dy * s, v: dx * s - dy * c };
}

/* ────────────────────────── 体积 ────────────────────────── */

/**
 * 直立时 0..v 的「几何体积」（舞台单位³）与容量的换算系数。
 * 剖面是旋转体：dV = π r² dv。换算成毫升时用 capacityMl / 总几何体积，
 * 所以这里的单位约掉了，只要求自洽。
 */
function slabVolume(s: ShapeData): Float64Array {
  const n = s.radii.length;
  const dv = s.height / (n - 1);
  const acc = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const r0 = s.radii[i - 1]!;
    const r1 = s.radii[i]!;
    acc[i] = acc[i - 1]! + Math.PI * dv * (r0 * r0 + r0 * r1 + r1 * r1) / 3;
  }
  return acc;
}

const SLAB_CACHE = new WeakMap<ShapeData, Float64Array>();
function slabs(s: ShapeData): Float64Array {
  let a = SLAB_CACHE.get(s);
  if (!a) {
    a = slabVolume(s);
    SLAB_CACHE.set(s, a);
  }
  return a;
}

/** 直立时装 ml 毫升液体的液面高度（局部 v，舞台单位）。 */
export function uprightLevel(s: ShapeData, ml: number): number {
  const acc = slabs(s);
  const n = acc.length;
  const total = acc[n - 1]!;
  const target = Math.max(0, Math.min(1, ml / s.capacityMl)) * total;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (acc[mid]! < target) lo = mid;
    else hi = mid;
  }
  const a = acc[lo]!;
  const b = acc[hi]!;
  const k = b > a ? (target - a) / (b - a) : 0;
  return ((lo + Math.max(0, Math.min(1, k))) / (n - 1)) * s.height;
}

/**
 * 倾斜容器里，世界水平面 y = Y 以下的液体体积（毫升）。
 *
 * 把旋转体切成 n 片，每片是半径 r 的圆盘，盘心在局部 (0, v)、盘面法向 = 容器轴。
 * 世界坐标里盘面投影成一条线段（侧视），水平面以下的弦宽比例由圆盘与平面的交解出：
 * 对圆盘上一点，世界 y = yc + r·cosθ·sin(rot)（轴向分量为 0），所以盘面在水平面
 * 以下的面积比例 = 圆的弦切面积比例，弦位置 d = (Y − yc) / (r·|sin rot|)。
 */
export function volumeBelow(s: ShapeData, f: Frame, Y: number): number {
  const n = s.radii.length;
  const dv = s.height / (n - 1);
  const sinR = Math.sin(f.rot);
  const cosR = Math.cos(f.rot);
  const total = slabs(s)[n - 1]!;
  let vol = 0;
  for (let i = 0; i < n - 1; i++) {
    const v = (i + 0.5) * dv;
    const r0 = s.radii[i]!;
    const r1 = s.radii[i + 1]!;
    const r = (r0 + r1) / 2;
    // 圆台截面积（与 slabVolume 同一个公式 —— 直立时两边逐字节一致）
    const area = (Math.PI * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
    // 盘心 = toWorld(f, 0, v)
    const cy = f.y - v * cosR * f.scale;
    const reach = r * Math.abs(sinR) * f.scale;
    let frac: number;
    if (reach < dv * Math.abs(cosR) * f.scale * 0.5) {
      // 近乎直立：盘面几乎水平，按这一片在水平面以下的高度比例算（避免台阶）
      const half = (dv * Math.abs(cosR) * f.scale) / 2;
      frac = Math.max(0, Math.min(1, (cy + half - Y) / (2 * half)));
    } else {
      // d ∈ [−1, 1]：盘面上 x' = cosθ·sign(sin rot) ≥ d 的部分在水平面以下；
      // 单位圆被直线 x = d 切下的 x ≥ d 一侧面积比例 = (acos d − d·√(1−d²)) / π
      const d = Math.max(-1, Math.min(1, (Y - cy) / reach));
      frac = (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
    }
    vol += area * dv * frac;
  }
  return (vol / total) * s.capacityMl;
}

/** 直立时 0..v 的体积（毫升）。 */
export function uprightVolume(s: ShapeData, v: number): number {
  const acc = slabs(s);
  const n = acc.length;
  const f = Math.max(0, Math.min(1, v / s.height)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  return ((acc[i]! + (acc[i + 1]! - acc[i]!) * k) / acc[n - 1]!) * s.capacityMl;
}

/**
 * 倾斜容器装 ml 毫升时的水平液面（世界 y）。超过当前倾角能装的量时，
 * 液面钳在口沿最低点 —— 多出来的就是正在倒出去的那部分（倒注液流负责交代）。
 * `sealed`（摇壶盖上了）时不钳：液体可以一直灌到盖子。
 */
export function tiltedLevel(s: ShapeData, f: Frame, ml: number, sealed = false): number {
  if (ml <= 0) return bottomWorldY(s, f);
  if (Math.abs(f.rot) < 1e-4) return f.y - uprightLevel(s, ml) * f.scale;
  let lo = sealed ? topWorldY(s, f) : pourLip(s, f).y; // 液面最高到口沿最低点
  let hi = deepestWorldY(s, f);
  if (volumeBelow(s, f, lo) <= ml) return lo;
  for (let it = 0; it < 26; it++) {
    const mid = (lo + hi) / 2;
    if (volumeBelow(s, f, mid) > ml) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 杯腔最高点的世界 y。 */
function topWorldY(s: ShapeData, f: Frame): number {
  let best = Infinity;
  const n = s.radii.length;
  for (let i = 0; i < n; i += 4) {
    const v = (i / (n - 1)) * s.height;
    const r = s.radii[i]!;
    best = Math.min(best, toWorld(f, r, v).y, toWorld(f, -r, v).y);
  }
  const r = rimRadius(s);
  return Math.min(best, toWorld(f, r, s.height).y, toWorld(f, -r, s.height).y);
}

/** 倾斜容器此刻最多还能装多少（液面 = 口沿最低点）。 */
export function capacityAtTilt(s: ShapeData, f: Frame): number {
  if (Math.abs(f.rot) < 1e-4) return s.capacityMl;
  return volumeBelow(s, f, pourLip(s, f).y);
}

/** 杯腔最低点的世界 y（倾斜时是杯底边缘）。 */
function deepestWorldY(s: ShapeData, f: Frame): number {
  let best = -Infinity;
  const n = s.radii.length;
  for (let i = 0; i < n; i++) {
    const v = (i / (n - 1)) * s.height;
    const r = s.radii[i]!;
    best = Math.max(best, toWorld(f, r, v).y, toWorld(f, -r, v).y);
  }
  return best;
}

function bottomWorldY(s: ShapeData, f: Frame): number {
  return deepestWorldY(s, f);
}

/**
 * 出液点：口沿上世界坐标最低的那一端（rot>0 时是右端）。
 * 倒注液流从这里流出 —— 器具怎么转，出口就跟到哪。
 */
export function pourLip(s: ShapeData, f: Frame): { x: number; y: number; side: 1 | -1 } {
  const r = rimRadius(s);
  const side: 1 | -1 = f.rot >= 0 ? 1 : -1;
  const p = toWorld(f, side * r, s.height);
  return { ...p, side };
}

/** 口沿中心（世界坐标）。 */
export function rimCenter(s: ShapeData, f: Frame): { x: number; y: number } {
  return toWorld(f, 0, s.height);
}

/**
 * 反解姿态：要让器具以倾角 rot、出液点落在 (lx, ly)，碗底中心该在哪。
 * 编排「量酒器口沿对准杯口」「摇壶口沿对准滤网」都靠它，不靠目测偏移。
 */
export function poseForLip(
  s: ShapeData,
  rot: number,
  lx: number,
  ly: number,
  scale = 1,
): { x: number; y: number } {
  const side = rot >= 0 ? 1 : -1;
  const p = toWorld({ x: 0, y: 0, rot, scale }, side * rimRadius(s), s.height);
  return { x: lx - p.x, y: ly - p.y };
}

/** 柱脚 + 底座在碗底以下的落差（舞台单位）：放在台面上时碗底离台面多高。 */
export function footDrop(s: ShapeData): number {
  if (s.material === "bottle") return 0;
  return s.stem ? s.stem.height + 4 : 4;
}
