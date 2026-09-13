/**
 * 杯型剖面与体积 ⇄ 液面高度（规范 §6）。
 *
 * 这是自动液面的物理基础。非圆柱杯型（coupe、martini）的体积对高度是强非线性的
 * —— **这正是不能用「液面高度 = 体积 / 容量」偷懒的原因**：
 * Martini 杯装一半容量时，液面远低于杯高一半。
 */
import { ICE_POROSITY, ICE_DISPLACES_LIQUID } from "./physics.ts";
import type { IceType } from "./vocab.ts";

/* ────────────────────────── 剖面定义 ────────────────────────── */

export interface ProfilePoint {
  /** 归一化高度，0 = 杯底，1 = 杯口。必须单调递增。 */
  y: number;
  /** 归一化半径。 */
  r: number;
}

export interface GlassShape {
  profile: ProfilePoint[];
  /** SVG 路径，仅用于描边绘制，不参与体积计算。 */
  outline?: string;
  stem?: { height: number; width: number };
  base?: { radius: number };
}

export interface VesselDef {
  id: string;
  nameZh: string;
  nameEn: string;
  capacityMl: number;
  shape: GlassShape;
}

/* ────────────────────────── 编译后的容器 ────────────────────────── */

const LUT_SIZE = 128;

export interface VesselSpec {
  def: VesselDef;
  /**
   * 绝对尺度系数：k³ · π ∫₀¹ r(y)²dy = capacityMl。
   * 只用于渲染时换算像素/毫米 —— 体积↔高度映射里 k 会约掉。
   */
  scale: number;
  /** 归一化累积积分 ∫₀^y r²dy 的总值。 */
  private__total: number;
  /** 体积分数 → 高度分数的查找表，LUT_SIZE 个等距采样。 */
  private__heightLut: Float64Array;
}

/**
 * 分段线性剖面上 ∫r²dy 的**精确**分段值。
 * r 在段内从 r0 线性变到 r1，圆台体积公式：∫r²dy = dy·(r0² + r0·r1 + r1²)/3
 */
function segmentIntegral(y0: number, r0: number, y1: number, r1: number): number {
  const dy = y1 - y0;
  return (dy * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
}

/** 累积积分 ∫₀^y r²dy。y 超出 [0,1] 会被夹紧。 */
function cumulativeIntegral(profile: readonly ProfilePoint[], y: number): number {
  const target = Math.max(0, Math.min(1, y));
  let acc = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = profile[i]!;
    const p1 = profile[i + 1]!;
    if (target <= p0.y) break;
    if (target >= p1.y) {
      acc += segmentIntegral(p0.y, p0.r, p1.y, p1.r);
    } else {
      // 部分段：在 target 处插值出半径
      const t = (target - p0.y) / (p1.y - p0.y);
      const rMid = p0.r + (p1.r - p0.r) * t;
      acc += segmentIntegral(p0.y, p0.r, target, rMid);
      break;
    }
  }
  return acc;
}

export function radiusAt(profile: readonly ProfilePoint[], y: number): number {
  const target = Math.max(0, Math.min(1, y));
  if (profile.length === 0) return 0;
  if (target <= profile[0]!.y) return profile[0]!.r;
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = profile[i]!;
    const p1 = profile[i + 1]!;
    if (target <= p1.y) {
      const span = p1.y - p0.y;
      if (span <= 0) return p1.r;
      const t = (target - p0.y) / span;
      return p0.r + (p1.r - p0.r) * t;
    }
  }
  return profile[profile.length - 1]!.r;
}

/** 校验剖面自洽性。构造时调用一次，避免坏数据静默产生错误液面。 */
export function validateProfile(profile: readonly ProfilePoint[]): string[] {
  const errs: string[] = [];
  if (profile.length < 2) errs.push("剖面至少需要 2 个采样点");
  if (profile.length > 0) {
    if (profile[0]!.y !== 0) errs.push("剖面首点的 y 必须为 0（杯底）");
    if (profile[profile.length - 1]!.y !== 1) errs.push("剖面末点的 y 必须为 1（杯口）");
  }
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i]!;
    if (p.y < 0 || p.y > 1) errs.push(`剖面点 ${i} 的 y 超出 [0,1]`);
    if (p.r <= 0) errs.push(`剖面点 ${i} 的 r 必须为正数`);
    if (i > 0 && p.y <= profile[i - 1]!.y) errs.push(`剖面点 ${i} 的 y 必须严格递增`);
  }
  return errs;
}

export function compileVessel(def: VesselDef): VesselSpec {
  const errs = validateProfile(def.shape.profile);
  if (errs.length > 0) {
    throw new Error(`杯型 ${def.id} 的剖面无效：${errs.join("；")}`);
  }

  const profile = def.shape.profile;
  const total = cumulativeIntegral(profile, 1);

  // k³ · π · total = capacityMl
  const scale = Math.cbrt(def.capacityMl / (Math.PI * total));

  // 体积分数 → 高度分数。cumulativeIntegral 单调递增，用等距高度采样后线性反查。
  const heightLut = new Float64Array(LUT_SIZE);
  const volSamples = new Float64Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const h = i / (LUT_SIZE - 1);
    volSamples[i] = cumulativeIntegral(profile, h) / total;
  }
  for (let i = 0; i < LUT_SIZE; i++) {
    const vFrac = i / (LUT_SIZE - 1);
    // 在 volSamples 里找 vFrac 所在区间
    let j = 0;
    while (j < LUT_SIZE - 2 && volSamples[j + 1]! < vFrac) j++;
    const v0 = volSamples[j]!;
    const v1 = volSamples[j + 1]!;
    const h0 = j / (LUT_SIZE - 1);
    const h1 = (j + 1) / (LUT_SIZE - 1);
    const t = v1 > v0 ? (vFrac - v0) / (v1 - v0) : 0;
    heightLut[i] = h0 + (h1 - h0) * Math.max(0, Math.min(1, t));
  }

  return { def, scale, private__total: total, private__heightLut: heightLut };
}

/* ────────────────────────── 体积 ⇄ 高度 ────────────────────────── */

/** 给定液体毫升数，返回归一化液面高度 0..1。超出容量时夹到 1。 */
export function heightForVolume(vessel: VesselSpec, ml: number): number {
  const vFrac = Math.max(0, Math.min(1, ml / vessel.def.capacityMl));
  const lut = vessel.private__heightLut;
  const x = vFrac * (LUT_SIZE - 1);
  const i = Math.min(LUT_SIZE - 2, Math.floor(x));
  const t = x - i;
  return lut[i]! + (lut[i + 1]! - lut[i]!) * t;
}

/** 给定归一化液面高度，返回液体毫升数。 */
export function volumeForHeight(vessel: VesselSpec, hNorm: number): number {
  const c = cumulativeIntegral(vessel.def.shape.profile, hNorm);
  return (c / vessel.private__total) * vessel.def.capacityMl;
}

/** 归一化高度处的绝对半径（与 scale 同单位），用于绘制液面椭圆宽度。 */
export function absRadiusAt(vessel: VesselSpec, hNorm: number): number {
  return radiusAt(vessel.def.shape.profile, hNorm) * vessel.scale;
}

/** 杯子的绝对总高（与 scale 同单位）。 */
export function absHeight(vessel: VesselSpec): number {
  return vessel.scale;
}

/* ────────────────────────── 冰的排水 ────────────────────────── */

export interface IceOccupancy {
  /** 冰实体积（毫升）。 */
  solidMl: number;
  /** 加冰后还能装多少液体（毫升）。 */
  liquidCapacityMl: number;
}

/**
 * 冰的排水计算（ADR-014、规范 §5.2）。
 *
 *   冰实体积     = capacityMl × fill × (1 − porosity)
 *   可容液体上限 = capacityMl × (1 − fill × (1 − porosity))
 *
 * 满杯方冰（fill=1.0）可容液体 ≈ 容量 40%，与吧台经验相符。
 */
export function iceOccupancy(
  capacityMl: number,
  iceType: IceType,
  fill: number,
): IceOccupancy {
  if (!ICE_DISPLACES_LIQUID[iceType]) {
    return { solidMl: 0, liquidCapacityMl: capacityMl };
  }
  const f = Math.max(0, Math.min(1, fill));
  const porosity = ICE_POROSITY[iceType];
  const solidFraction = f * (1 - porosity);
  return {
    solidMl: capacityMl * solidFraction,
    liquidCapacityMl: capacityMl * (1 - solidFraction),
  };
}

/* ────────────────────────── 常用剖面 ────────────────────────── */

/** 直筒杯（highball、collins、shot、julep_tin）。 */
export function cylinderProfile(topRadius = 0.5, bottomRatio = 0.92): ProfilePoint[] {
  return [
    { y: 0, r: topRadius * bottomRatio },
    { y: 1, r: topRadius },
  ];
}

/** 锥形杯（martini）—— 体积对高度极度非线性。 */
export function coneProfile(topRadius = 0.5, bottomRadius = 0.04): ProfilePoint[] {
  return [
    { y: 0, r: bottomRadius },
    { y: 1, r: topRadius },
  ];
}

/** 碟形杯（coupe）—— 底部收拢，中段外扩，杯口略敞。 */
export function coupeProfile(): ProfilePoint[] {
  return [
    { y: 0, r: 0.12 },
    { y: 0.1, r: 0.38 },
    { y: 0.45, r: 0.49 },
    { y: 1, r: 0.5 },
  ];
}
