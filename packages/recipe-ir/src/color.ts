/**
 * 颜色运算（规范 §7.2）。
 *
 * **两种操作，两个空间 —— 混淆它们会得到明显错误的颜色：**
 *
 * | 操作 | 用什么 | 为什么 |
 * | --- | --- | --- |
 * | 混合两种**液体** | `mixLiquids` —— 线性 RGB 透射率加权几何平均 | 液体是吸收介质，**减色** |
 * | 颜色**过渡/渐变** | `lerpOklab` / `mixOklab` —— OKLab 插值 | 感知均匀，过渡不发灰 |
 *
 * 为什么液体混合不能用 OKLab 平均：OKLab 是感知空间，黄与蓝在 b 轴上近乎相反，
 * 加权平均会互相抵消趋于中性 —— 混出蓝灰而不是绿。那是**光的加色混合**的正确行为，
 * 但液体是透光吸收的，蓝橙利口酒 + 橙汁在杯子里确实偏绿。
 *
 * 减色模型用 Beer-Lambert 降到三通道的近似：透射率按浓度做加权几何平均。
 *
 * OKLab 变换来自 Björn Ottosson 的定义。
 */

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/* ────────────────────────── sRGB ⇄ 线性 ────────────────────────── */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/* ────────────────────────── hex ⇄ rgb ────────────────────────── */

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`无效的颜色值: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const q = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${q(r)}${q(g)}${q(b)}`;
}

/* ────────────────────────── sRGB ⇄ OKLab ────────────────────────── */

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToRgb({ L, a, b }: Oklab): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function hexToOklab(hex: string): Oklab {
  return rgbToOklab(hexToRgb(hex));
}

export function oklabToHex(c: Oklab): string {
  return rgbToHex(oklabToRgb(c));
}

/* ────────────────────────── 加权混色 ────────────────────────── */

export interface ColorWeight {
  color: Oklab;
  /** 权重 —— 混色用体积（毫升）。dash 类用一个小的等效权重。 */
  weight: number;
}

/**
 * 按权重在 OKLab 空间取平均。
 *
 * **这是加色/感知平均，不适合混合液体** —— 液体混合请用 `mixLiquids`。
 * 这个函数的正当用途是：多个同类颜色求代表色、关键帧之间的多路过渡。
 */
export function mixOklab(inputs: readonly ColorWeight[]): Oklab {
  let total = 0;
  let L = 0;
  let a = 0;
  let b = 0;
  for (const { color, weight } of inputs) {
    if (weight <= 0) continue;
    total += weight;
    L += color.L * weight;
    a += color.a * weight;
    b += color.b * weight;
  }
  if (total === 0) return { L: 0, a: 0, b: 0 };
  return { L: L / total, a: a / total, b: b / total };
}

/**
 * 在 OKLab 空间插值 —— 用于层间渐变带与关键帧过渡。
 * t=0 返回 from，t=1 返回 to。
 */
export function lerpOklab(from: Oklab, to: Oklab, t: number): Oklab {
  const k = Math.max(0, Math.min(1, t));
  return {
    L: from.L + (to.L - from.L) * k,
    a: from.a + (to.a - from.a) * k,
    b: from.b + (to.b - from.b) * k,
  };
}

/* ────────────────────────── 液体混合（减色） ────────────────────────── */

export interface LiquidWeight {
  color: Rgb;
  /** 权重 —— 体积（毫升）。dash 类用 TINT_WEIGHT_PER_DASH 折算的等效权重。 */
  weight: number;
}

/**
 * 透射率压缩系数。
 *
 * 真实液体在任何通道上都不会完全不透光，纯 0 会让几何平均塌成黑色
 * （一杯黄酒混一杯蓝酒不该变成墨汁）。
 *
 * **注意这是可逆的压缩重映射，不是钳制。** 用钳制会连单一液体的颜色一起改掉——
 * 作者在库里设了 #1b6fd6，渲染出来变成 #276fd6，这不能接受。
 * 压缩 + 逆变换保证：单一液体精确往返，多液体永不塌黑，且处处连续。
 *
 * 这个值决定混色能达到的最大饱和度，是需要在原型阶段调的观感参数。
 */
export const TRANSMITTANCE_FLOOR = 0.02;

/** T → floor + (1−floor)·T */
function compressT(t: number, floor: number): number {
  return floor + (1 - floor) * t;
}

/** 上式的逆变换。 */
function expandT(t: number, floor: number): number {
  return (t - floor) / (1 - floor);
}

/**
 * 混合液体 —— Beer-Lambert 降到三通道的近似（减色）。
 *
 *   log T_mix = Σ wᵢ·log Tᵢ / Σ wᵢ
 *
 * 即线性 RGB 透射率的**加权几何平均**。黄 + 蓝 → 浊绿，符合杯中实际观感。
 *
 * 权重总和为 0 时返回白色（无液体 = 全透光）。
 */
export function mixLiquids(
  inputs: readonly LiquidWeight[],
  floor = TRANSMITTANCE_FLOOR,
): Rgb {
  let total = 0;
  let lr = 0;
  let lg = 0;
  let lb = 0;

  for (const { color, weight } of inputs) {
    if (weight <= 0) continue;
    total += weight;
    lr += weight * Math.log(compressT(srgbToLinear(color.r), floor));
    lg += weight * Math.log(compressT(srgbToLinear(color.g), floor));
    lb += weight * Math.log(compressT(srgbToLinear(color.b), floor));
  }

  if (total === 0) return { r: 1, g: 1, b: 1 };

  return {
    r: linearToSrgb(expandT(Math.exp(lr / total), floor)),
    g: linearToSrgb(expandT(Math.exp(lg / total), floor)),
    b: linearToSrgb(expandT(Math.exp(lb / total), floor)),
  };
}

/** hex 便捷版。 */
export function mixLiquidsHex(
  inputs: readonly { hex: string; weight: number }[],
  floor = TRANSMITTANCE_FLOOR,
): string {
  return rgbToHex(mixLiquids(inputs.map(({ hex, weight }) => ({ color: hexToRgb(hex), weight })), floor));
}

/**
 * dash / drop 的等效混色权重。
 *
 * 这类原料体积可忽略但**着色能力很强**（2 dash Angostura 能把整杯染成淡褐色），
 * 所以用一个远大于其实际毫升数的等效权重，否则混出来看不见它。
 * 初始值凭观感设定，需在原型阶段实测调整。
 */
export const TINT_WEIGHT_PER_DASH = 4;
export const TINT_WEIGHT_PER_DROP = 0.8;

/* ────────────────────────── 质地优先级 ────────────────────────── */

import type { Texture } from "./vocab.ts";

/** 混合时取最"重"的质地（规范 §7.2）。 */
const TEXTURE_RANK: Record<Texture, number> = {
  clear: 0,
  cloudy: 1,
  foam: 2,
  creamy: 3,
};

export function dominantTexture(textures: readonly Texture[]): Texture {
  let best: Texture = "clear";
  for (const t of textures) {
    if (TEXTURE_RANK[t] > TEXTURE_RANK[best]) best = t;
  }
  return best;
}
