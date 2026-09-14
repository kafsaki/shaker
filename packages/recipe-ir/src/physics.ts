/**
 * 物理参数集中地。
 *
 * **所有数值都是初始估值，需在动画原型阶段实测调整。**
 * 纪律：这些常数不许散落在渲染代码里 —— 调参时只改这个文件。
 */
import type { IceType, MuddleIntensity, ShakeIntensity, Viscosity } from "./vocab.ts";

/* ────────────────────────── 单位换算 ────────────────────────── */

export const ML_PER_OZ = 29.5735;
export const ML_PER_CL = 10;
export const ML_PER_BARSPOON = 5;
export const ML_PER_TSP = 5;
export const ML_PER_DASH = 0.6;
export const ML_PER_DROP = 0.05;

/* ────────────────────────── 冰 ────────────────────────── */

/**
 * 孔隙率 —— 冰堆积体中非冰（可容液体）的体积分数。
 *
 * 可容液体上限 = capacityMl × (1 − fill × (1 − porosity))
 * 满杯方冰（fill=1.0）可容液体 ≈ 容量 40%，与吧台经验相符。
 */
export const ICE_POROSITY: Record<IceType, number> = {
  cube: 0.4,
  large_cube: 0.45,
  sphere: 0.48,
  cracked: 0.35,
  crushed: 0.28,
  block: 0.5,
  dry_ice: 1.0, // 不参与液面，只产烟
};

/** 干冰不占液体空间。 */
export const ICE_DISPLACES_LIQUID: Record<IceType, boolean> = {
  cube: true,
  large_cube: true,
  sphere: true,
  cracked: true,
  crushed: true,
  block: true,
  dry_ice: false,
};

/** 碎冰让液体变浑浊的程度（0..1），驱动 texture 向 cloudy 偏移。 */
export const ICE_CLOUDING: Record<IceType, number> = {
  cube: 0,
  large_cube: 0,
  sphere: 0,
  cracked: 0.1,
  crushed: 0.3,
  block: 0,
  dry_ice: 0,
};

/* ────────────────────────── 稀释（冰融水） ────────────────────────── */

/**
 * 稀释率 = 冰融水量 / 液体量。
 * 不算稀释会显著高估 ABV —— Daiquiri 硬摇稀释约 25%，不算的话 ABV 虚高四分之一。
 */
export const SHAKE_DILUTION: Record<ShakeIntensity, number> = {
  gentle: 0.15,
  standard: 0.2,
  hard: 0.25,
};

/** 摇酒的参考时长（秒）。实际时长按比例缩放稀释率，上限 1.0 倍。 */
export const SHAKE_REFERENCE_SEC = 12;

export const STIR_DILUTION = 0.12;
export const STIR_REFERENCE_SEC = 30;

export const SWIZZLE_DILUTION = 0.18;
export const SWIZZLE_REFERENCE_SEC = 8;

export const ROLL_DILUTION = 0.08;
export const THROW_DILUTION = 0.1;

/** BLEND 把冰打成雪泥，稀释最强。 */
export const BLEND_DILUTION = 0.35;
export const BLEND_REFERENCE_SEC = 20;

/* ────────────────────────── 混合度 ────────────────────────── */

/** 各混合动作能达到的 mixedness 上限（规范 §4.1）。 */
export const MIXEDNESS_TARGET = {
  SHAKE: 1.0,
  STIR: 0.85, // 保留清澈感
  SWIZZLE: 0.9,
  ROLL: 0.75, // 极少起泡（Bloody Mary）
  THROW: 0.9,
  BLEND: 1.0,
} as const;

/** 密度差小于此值时，ADD 会并入现有层而非新建层（g/cm³）。 */
export const LAYER_MERGE_DENSITY_THRESHOLD = 0.03;

/**
 * mixedness 达到此值时把所有液层合并成单层 —— 搅拌到这份上的酒物理上已均匀
 * （STIR 上限 0.85 会触发合层，ROLL 0.75 保留轻微分层）。
 */
export const LAYER_MERGE_MIXEDNESS = 0.8;

/* ────────────────────────── 温度 ────────────────────────── */

export const TEMP_AMBIENT_C = 20;
export const TEMP_CHILLED_C = -4;
export const TEMP_SWIZZLE_C = -6;
/** 低于此温度开始绘制杯壁霜层。 */
export const TEMP_FROST_THRESHOLD_C = -2;

/* ────────────────────────── 泡沫 ────────────────────────── */

/** 每毫升 foaming=1 的原料，在给定动作下产生的泡沫毫升数。 */
export const FOAM_YIELD = {
  dryShake: 1.8,
  wetShake: 0.9,
  stir: 0.05,
  blend: 0.6,
} as const;

/** WAIT + reason: "bloom" 时泡沫上浮致密化的系数。 */
export const FOAM_BLOOM_FACTOR = 1.25;

/* ────────────────────────── 倒注流速 ────────────────────────── */

/** 毫升/秒 —— 决定 ADD/TOP_UP/FLOAT 的注入动画时长。 */
export const POUR_RATE_ML_PER_SEC: Record<Viscosity, number> = {
  low: 30,
  medium: 18,
  high: 8,
};

/** FLOAT 沿吧勺背面倒，刻意放慢。 */
export const FLOAT_POUR_RATE_FACTOR = 0.35;

/* ────────────────────────── 捣压出汁 ────────────────────────── */

/** firm 捣压时，每单位计数原料（piece/wedge/slice）出汁毫升数。 */
export const MUDDLE_JUICE_YIELD_ML: Record<MuddleIntensity, number> = {
  gentle: 0, // 草本只释香不出汁
  firm: 4,
};

/* ────────────────────────── 杯口余量 ────────────────────────── */

/** TOP_UP 留的杯口余量，避免视觉上满到溢出。 */
export const HEADROOM_ML = 5;

/* ────────────────────────── 气泡 ────────────────────────── */

/** carbonation=1 时每秒发射的气泡数（每 100ml 液体）。 */
export const BUBBLE_RATE_PER_100ML = 14;

/** SHAKE 摇散气泡 —— 摇后 carbonation 归零。 */
export const SHAKE_KILLS_CARBONATION = true;

/* ────────────────────────── 烟雾 ────────────────────────── */

export const SMOKE_PEAK_DENSITY = 0.8;
/** 烟雾密度的指数衰减半衰期（毫秒）。 */
export const SMOKE_HALFLIFE_MS = 4000;

/* ────────────────────────── 动画时长映射 ────────────────────────── */

/**
 * 真实时长 → 动画时长。12 秒的硬摇不该让用户看 12 秒。
 * animMs = clamp(400 + 900·log2(1 + durationSec), 400, 2600)
 */
export const ANIM_DURATION = {
  baseMs: 400,
  logFactor: 900,
  minMs: 400,
  maxMs: 2600,
} as const;

export function realToAnimMs(durationSec: number | undefined, fallbackMs = 700): number {
  if (durationSec === undefined) return fallbackMs;
  const { baseMs, logFactor, minMs, maxMs } = ANIM_DURATION;
  const raw = baseMs + logFactor * Math.log2(1 + durationSec);
  return Math.round(Math.min(maxMs, Math.max(minMs, raw)));
}

/** 无真实时长的动作的默认动画时长（毫秒）。 */
export const DEFAULT_ANIM_MS = {
  CHILL: 1100,
  RIM: 1000,
  RINSE: 1000,
  ADD: 700, // 每个原料，由流速修正
  ICE: 800,
  MUDDLE: 1200,
  SHAKE: 1400,
  STIR: 1400,
  SWIZZLE: 1100,
  ROLL: 1200,
  THROW: 1300,
  BLEND: 1200,
  STRAIN: 1000,
  DUMP: 800,
  TOP_UP: 1200,
  FLOAT: 1400,
  GARNISH: 800,
  SPRITZ: 700,
  FLAME: 1200,
  SMOKE: 1600,
  WAIT: 900,
} as const;
