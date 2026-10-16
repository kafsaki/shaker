/**
 * 器具光栅化（ADR-031）：玻璃杯、摇壶、量酒器、酒瓶都走这一套。
 *
 * 做法：逐像素反变换。对器具包围盒里的每个像素，换算到局部坐标 (u, v)，
 * 按剖面半径判断它在杯腔内 / 杯壁上 / 外面，再按世界 y 与各液层水平面比较决定
 * 液体颜色。任意倾角都一样清楚 —— 倒酒时源容器里的液面是真的水平的、真的变浅。
 *
 * 旧版直立、倾倒、涮杯倒掉各有一套画法（各自近似），这里只有一套。
 */
import { radiusAtV, type LayerView, type ShapeData, type VesselView } from "@shaker/animator-core";
import {
  bayer,
  blend,
  clamp01,
  frac,
  get,
  hash,
  mixRGB,
  PS,
  pxCenter,
  rgb,
  set,
  shade,
  sparkle,
  type RGB,
  type Surface,
} from "./pixels.ts";
import type { Palette } from "./theme.ts";

interface Ramp {
  dark: RGB;
  base: RGB;
  light: RGB;
  hi: RGB;
}

const RAMPS = new Map<string, Ramp>();
export function rampOf(hex: string): Ramp {
  let r = RAMPS.get(hex);
  if (!r) {
    const c = rgb(hex);
    r = { dark: shade(c, -0.3), base: c, light: shade(c, 0.28), hi: shade(c, 0.55) };
    RAMPS.set(hex, r);
  }
  return r;
}

/** 当前绘制目标（liquidAt 取背后颜色用；单线程渲染，drawVessel 入口处设置）。 */
let sBuf: Surface | null = null;

export function drawVessel(s: Surface, v: VesselView, shape: ShapeData, pal: Palette, tMs: number): void {
  sBuf = s;
  const sc = v.scale;
  const c = Math.cos(v.rot);
  const sn = Math.sin(v.rot);
  const H = shape.height;
  const maxR = shape.radii.reduce((m, r) => Math.max(m, r), 0);
  const stemH = shape.stem ? shape.stem.height : 0;
  const baseR = shape.base ? shape.base.radius : 0;
  const halfW = Math.max(maxR, baseR) + 2;
  // 局部包围盒 → 世界包围盒
  const corners = [
    [-halfW, -stemH - 3],
    [halfW, -stemH - 3],
    [-halfW, H + 8],
    [halfW, H + 8],
  ].map(([u, vv]) => [v.x + (u! * c + vv! * sn) * sc, v.y + (u! * sn - vv! * c) * sc]);
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]!)) / PS) - 1);
  const x1 = Math.min(s.w - 1, Math.ceil(Math.max(...corners.map((p) => p[0]!)) / PS) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]!)) / PS) - 1);
  const y1 = Math.min(s.h - 1, Math.ceil(Math.max(...corners.map((p) => p[1]!)) / PS) + 1);

  const metal = shape.material === "metal";
  const bottle = shape.material === "bottle";
  const wallPx = PS / sc; // 一个像素在局部坐标里的尺寸
  const surfaceY = v.layers.length > 0 ? v.layers[v.layers.length - 1]!.topY : Infinity;
  const agit = v.agitation + v.tumble * 0.8;
  const glassFill = metal ? pal.metalLo : pal.glassFill;
  const glassStroke = metal ? pal.metalHi : bottle ? rgb(v.bottle?.glass ?? "#d8dce4") : pal.glassStroke;
  const bottleTint = bottle ? rgb(v.bottle?.glass ?? "#d8dce4") : null;
  const neckAt = (shape.neckAt ?? 1) * H;

  for (let py = y0; py <= y1; py++) {
    const wy = pxCenter(py);
    for (let px = x0; px <= x1; px++) {
      const wx = pxCenter(px);
      const dx = (wx - v.x) / sc;
      const dy = (wy - v.y) / sc;
      const u = dx * c + dy * sn;
      const lv = dx * sn - dy * c;

      // ── 柱脚与底座（碗底以下） ──
      if (lv < 0) {
        if (shape.stem && lv >= -stemH - wallPx) {
          const sw = Math.max(wallPx * 0.6, shape.stem.width / 2);
          const atBase = shape.base && lv < -stemH + wallPx * 1.2;
          const br = atBase ? baseR : sw;
          if (Math.abs(u) <= br) {
            const edge = Math.abs(u) > br - wallPx;
            set(s, px, py, atBase ? (u < -br * 0.4 ? pal.hi : glassStroke) : edge ? glassStroke : glassFill);
          }
        } else if (!shape.stem && lv >= -wallPx * 1.1 && Math.abs(u) <= radiusAtV(shape, 0)) {
          // 无脚杯的厚底
          set(s, px, py, metal ? pal.metalLo : mixRGB(get(s, px, py), pal.glassStroke, 0.55));
        }
        continue;
      }
      if (lv > H + wallPx * 0.6) continue;
      const r = radiusAtV(shape, Math.min(H, lv));
      const au = Math.abs(u);
      if (au > r + wallPx * 0.55) continue;

      const onWall = au > r - wallPx * 0.45 || lv > H - wallPx * 0.45 || lv < wallPx * 0.45;

      // ── 杯腔内部 ──
      if (!onWall) {
        // 金属摇壶：不透明，只画外壁（霜、高光）
        if (metal) {
          const shadeK = u / Math.max(1, r);
          let col = mixRGB(pal.metalLo, pal.metalHi, clamp01(0.55 - shadeK * 0.6));
          if (u < -r * 0.45 && u > -r * 0.7) col = pal.metalHi;
          if (v.frost > 0.02 && hash(px * 7 + py * 13, 3) < v.frost * 0.7) col = mixRGB(col, pal.frost, 0.75);
          set(s, px, py, col);
          continue;
        }
        let col: RGB | null = liquidAt(v, wy, wx, px, py, tMs, agit);
        if (col) {
          if (bottleTint) col = mixRGB(col, bottleTint, 0.18);
          // 侧向遮光：贴壁暗一档
          if (au > r - wallPx * 1.5 && r > wallPx * 3) col = shade(col, -0.18);
          set(s, px, py, col);
        } else if (v.foam && wy < surfaceY && wy >= v.foam.topY) {
          // 泡沫冠
          const fr = rampOf(v.foam.color);
          const n = hash(px * 3 + py * 5, 91);
          set(s, px, py, n < 0.18 ? fr.dark : n < 0.3 ? fr.light : fr.base);
        } else {
          // 空杯区：玻璃透明（背景透过来），淡淡一层玻璃色
          const under = get(s, px, py);
          let k = bottle ? 0.35 : 0.12;
          if (au > r - wallPx * 1.5) k += 0.14; // 内壁
          let col2 = mixRGB(under, bottleTint ?? pal.glassFill, k);
          if (v.coat && v.coat.strength > 0.02 && au > r - wallPx * 1.6) {
            // 挂壁膜：贴着杯壁的一层酒色，上淡下浓，偶尔一道往下淌的痕
            const fade = v.coat.strength * (0.35 + 0.5 * (1 - lv / H));
            const drip = hash(Math.round(lv / 3) * 7 + (u < 0 ? 1 : 2), 77) < 0.12 ? 0.25 : 0;
            col2 = mixRGB(col2, rgb(v.coat.color), Math.min(0.85, fade + drip));
          }
          if (v.smoke > 0.02 && hash(px * 5 + py * 3 + Math.floor(tMs / 140), 57) < v.smoke * 0.45) col2 = mixRGB(col2, pal.frost, 0.7);
          set(s, px, py, col2);
        }
        // 杯壁高光列（左侧，隔行）
        if (!bottle && u < 0 && au > r - wallPx * 1.5 && (py & 1) === 0) blend(s, px, py, pal.hi, 0.55);
        // 霜：外壁白点
        if (v.frost > 0.02 && au > r - wallPx * 2.2 && hash(px * 11 + py * 7, 5) < v.frost * 0.55) set(s, px, py, pal.frost);
        continue;
      }

      // ── 杯壁 ──
      const atRim = lv > H - wallPx * 0.45;
      let col = glassStroke;
      if (metal) col = u < 0 ? pal.metalHi : pal.metalLo;
      if (bottle && v.bottle) {
        if (lv > neckAt) col = shade(rgb(v.bottle.glass), -0.25);
      }
      if (atRim && !metal) col = pal.hi;
      // 液面以下的杯壁染上液体色（玻璃是透明的）
      if (!metal && !atRim && wy > surfaceY && v.layers.length > 0) {
        const l = layerAtY(v.layers, wy);
        if (l) col = mixRGB(col, rampOf(l.color).dark, 0.45);
      }
      if (v.frost > 0.02 && hash(px * 11 + py * 7, 5) < v.frost * 0.7) col = pal.frost;
      set(s, px, py, col);
    }
  }

  if (bottle && v.bottle) drawBottleDress(s, v, shape, pal);
  drawRimExtras(s, v, shape, pal, tMs);
}

/** 世界 y 落在哪一层（自下而上：第一个 topY ≤ y 的层之下）。 */
function layerAtY(layers: readonly LayerView[], wy: number): LayerView | null {
  // layers 自下而上，topY 递减（越往上 y 越小）
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    const below = i > 0 ? layers[i - 1]!.topY : Infinity;
    if (wy >= l.topY && wy < below) return l;
  }
  return wy >= layers[layers.length - 1]!.topY ? layers[0]! : null;
}

/** 某个像素处的液体颜色；不在液体里返回 null。 */
function liquidAt(
  v: VesselView,
  wy: number,
  wx: number,
  px: number,
  py: number,
  tMs: number,
  agit: number,
): RGB | null {
  const layers = v.layers;
  if (layers.length === 0) return null;
  const top = layers[layers.length - 1]!;
  // 液面波浪：扰动驱动的行波（旋转后的液面仍是世界水平线，波沿 x 走）
  const amp = Math.min(2.2, agit * 2.4) * PS * 0.5;
  const wave = amp > 0.1 ? amp * Math.sin(tMs * 0.012 + wx * 0.2) + amp * 0.5 * Math.sin(tMs * 0.023 + wx * 0.52) : 0;
  // 搅拌：液面中心微陷
  const swirlDip = v.swirl > 0.01 ? v.swirl * PS * 0.8 * Math.max(0, 1 - Math.abs(wx - v.x) / 40) : 0;
  const surf = top.topY + wave + swirlDip;
  if (wy < surf) return null;

  // 自下而上找层：layers[i] 占据 [topY_i, topY_{i-1})
  let idx = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const lo = i > 0 ? layers[i - 1]!.topY : Infinity;
    if (wy >= (i === layers.length - 1 ? surf : layers[i]!.topY) && wy < lo) {
      idx = i;
      break;
    }
  }
  const l = layers[idx]!;
  const rp = rampOf(l.color);
  let col: RGB;
  // 层间过渡带：Bayer 抖动（mixedness 越高越宽）
  const below = idx > 0 ? layers[idx - 1] : undefined;
  const blendBand = (0.6 + v.mixedness * 5) * PS;
  const lowerEdge = idx > 0 ? layers[idx - 1]!.topY : Infinity;
  if (below && lowerEdge - wy < blendBand) {
    const k = 1 - (lowerEdge - wy) / blendBand;
    col = bayer(px, py) < k * 0.6 ? rampOf(below.color).base : rp.base;
  } else {
    // 深度吸光：越往下越暗（只有清透的酒才看得出层次；浑浊的酒是一整块哑光）
    const depth = clamp01((wy - (idx === layers.length - 1 ? surf : l.topY)) / (PS * 18));
    col = depth < 0.06 ? rp.light : l.texture === "clear" && bayer(px, py) < depth * 0.5 ? rp.dark : rp.base;
  }
  // 液面亮线 + 游走的高光点
  if (idx === layers.length - 1 && wy - surf < PS) {
    col = rp.hi;
    const glint = v.x + Math.sin(tMs * 0.0011) * 10;
    if (Math.abs(wx - glint) < PS * 1.2) col = [255, 255, 255];
  }
  // 浑浊 / 奶油质地：零星悬浮颗粒
  if ((l.texture === "cloudy" || l.texture === "creamy") && hash(px * 31 + py * 17, idx + 3) < 0.035) col = rp.light;
  // 透明度：与背后（已画好的背景）叠色 —— 苏打水几乎是透明的
  if (l.opacity < 0.98) col = mixRGB(get(sBuf!, px, py), col, Math.max(0.3, l.opacity));
  // 摇和 / 搅拌机：液体被打成气泡，满是亮点
  if (v.tumble > 0.05 && hash(px * 13 + py * 29 + Math.floor(tMs / 60), 17) < v.tumble * 0.22) col = rp.hi;
  // 气泡：碳酸层里上升的亮点（fxMs 纯函数）
  if (l.carbonation > 0.05) {
    const colSeed = hash(px, 23);
    if (colSeed < 0.32 * l.carbonation) {
      const speed = 0.06 + hash(px, 29) * 0.06;
      const ph = frac(colSeed * 11 + (tMs / 1000) * speed * 4 - py * 0.07);
      if (ph < 0.08) col = shade(rp.hi, 0.3);
    }
  }
  return col;
}

/** 酒瓶的标签、瓶颈、瓶盖、滴头。 */
function drawBottleDress(s: Surface, v: VesselView, shape: ShapeData, pal: Palette): void {
  const b = v.bottle!;
  const H = shape.height;
  const neck = (shape.neckAt ?? 0.7) * H;
  const c = Math.cos(v.rot);
  const sn = Math.sin(v.rot);
  const at = (u: number, vv: number) => ({
    x: Math.round((v.x + (u * c + vv * sn) * v.scale) / PS - 0.5),
    y: Math.round((v.y + (u * sn - vv * c) * v.scale) / PS - 0.5),
  });
  // 标签：瓶身中段一圈
  const lab = rgb(b.label);
  const r0 = radiusAtV(shape, neck * 0.45);
  const step = PS / v.scale;
  for (let vv = neck * 0.22; vv <= neck * 0.62; vv += step * 0.7) {
    for (let u = -r0 + step; u <= r0 - step; u += step * 0.7) {
      const p = at(u, vv);
      set(s, p.x, p.y, vv > neck * 0.56 || vv < neck * 0.27 ? shade(lab, -0.3) : lab);
    }
  }
  // 瓶盖 / 滴头
  const capR = radiusAtV(shape, H) + step * 0.3;
  const cap = rgb(b.cap);
  for (let vv = H - step * (b.dasher ? 0.5 : 1.6); vv <= H + step * (b.dasher ? 2 : 0.6); vv += step * 0.6) {
    const rr = b.dasher && vv > H ? step * 0.6 : capR;
    for (let u = -rr; u <= rr; u += step * 0.6) {
      const p = at(u, vv);
      set(s, p.x, p.y, u < 0 ? shade(cap, 0.2) : cap);
    }
  }
  void pal;
}

/** 盐边、盖子（摇壶盖 / 搅拌机盖）。 */
function drawRimExtras(s: Surface, v: VesselView, shape: ShapeData, pal: Palette, tMs: number): void {
  const H = shape.height;
  const c = Math.cos(v.rot);
  const sn = Math.sin(v.rot);
  const at = (u: number, vv: number) => ({
    x: Math.round((v.x + (u * c + vv * sn) * v.scale) / PS - 0.5),
    y: Math.round((v.y + (u * sn - vv * c) * v.scale) / PS - 0.5),
  });
  const rr = shape.radii[shape.radii.length - 1]!;
  const step = PS / v.scale;

  if (v.rim) {
    const rp = rampOf(v.rim.color);
    const start = v.rim.coverage === "half" ? 0 : -rr;
    for (let u = start; u <= rr; u += step * 0.8) {
      const i = Math.round(u * 10);
      if (hash(i, 21) < 0.75) {
        const p = at(u, H + step * 0.6);
        set(s, p.x, p.y, hash(i, 33) < 0.5 ? rp.base : rp.light);
      }
      if (hash(i, 41) < 0.3) {
        const p = at(u, H + step * 1.4);
        set(s, p.x, p.y, rp.light);
      }
    }
    for (let k = 0; k < 2; k++) {
      const ph = frac(tMs / 1500 + k * 0.47);
      const p = at(start + (rr - start) * hash(k, 77), H + step);
      sparkle(s, p.x, p.y, ph, pal.hi);
    }
  }

  if (v.lid > 0.01) {
    // 盖子从上方落下（lid 0→1）；摇壶盖是三段式的：带小帽的锥形盖
    const drop = (1 - v.lid) * 40;
    const metal = shape.material === "metal";
    const capH = metal ? H * 0.26 : step * 3;
    for (let vv = H; vv <= H + capH; vv += step * 0.6) {
      const k = (vv - H) / capH;
      const w = metal ? rr * (1.02 - k * 0.55) : rr + step;
      for (let u = -w; u <= w; u += step * 0.6) {
        const p = at(u, vv + drop);
        const edge = Math.abs(u) > w - step;
        set(s, p.x, p.y, edge || u > w * 0.3 ? pal.metalLo : u < -w * 0.4 ? pal.metalHi : mixRGB(pal.metalLo, pal.metalHi, 0.55));
      }
    }
    if (metal) {
      // 小帽
      for (let vv = H + capH; vv <= H + capH + step * 2.2; vv += step * 0.6) {
        for (let u = -rr * 0.4; u <= rr * 0.4; u += step * 0.6) {
          const p = at(u, vv + drop);
          set(s, p.x, p.y, u < 0 ? pal.metalHi : pal.metalLo);
        }
      }
    }
  }
}
