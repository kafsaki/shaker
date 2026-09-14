/**
 * Canvas 2D 像素风绘制后端。
 *
 * 管线：所有内容画进 100×130 的离屏 buffer（4px 像素格），最后
 * `imageSmoothingEnabled = false` 放大 4 倍贴到主画布。坐标全部吸附像素网格。
 *
 * 风格语言：
 *   - 每种液体从原料色派生 4 档色阶（暗/基/亮/高光）
 *   - 分层过渡带用 4×4 Bayer 有序抖动（复古渐变，不是平滑渐变）
 *   - 液面 = 一行亮色 meniscus + 缓慢移动的高光点
 *   - 气泡 = 上升的单像素点，到液面破裂；泡沫 = 白噪点带
 *   - 盐边 = 杯沿颗粒 + 四角星闪光（fxMs 纯函数）
 *   - 摇晃 = 杯体 ±1px 抖动 + 速度线 + 整屏 1px 震动
 *   - 倒入 = 像素液柱（滚动条纹表现流动）；小剂量（dash）= 逐滴下落的像素滴
 *
 * 为什么像素风：拟真是无底洞，风格化是"故意的"。而且像素网格天然契合
 * 「粒子/闪光必须是 t 的纯函数」的纪律 —— 所有装饰元素都是确定性 hash。
 *
 * 时间参数：timeMs = 场景时间（原型按 80ms 量化 → 12fps 定格感）；
 * fxMs = 原始时间（液流条纹/水花/闪烁/气泡保持流畅）。缺省 fxMs = timeMs。
 */
import {
  particlesAt,
  type Effect,
  type Prop,
  type RenderedContainer,
  type RenderedIce,
  type Scene,
} from "@shaker/animator-core";
import { hexToRgb, radiusAt, rgbToHex, type VesselSpec } from "@shaker/recipe-ir/core";

/* ══════════════════════════ 主题 ══════════════════════════ */

export interface RenderTheme {
  /** 舞台背景。 */
  background: string;
  /** 背景底部渐变色。 */
  backgroundLow: string;
  /** 玻璃轮廓。 */
  glassStroke: string;
  /** 玻璃内壁。 */
  glassFill: string;
  /** 道具描边/深色件。 */
  propStroke: string;
  frost: string;
  /** 台面顶/底/受光边缘。 */
  counterTop: string;
  counterBottom: string;
  counterEdge: string;
  /** 主位背光（暗调吧台的氛围光）。 */
  glow: string;
  /** 金属亮/暗。 */
  metalHi: string;
  metalLo: string;
  /** 木件亮/暗。 */
  woodHi: string;
  woodLo: string;
  /** 高光白。 */
  hi: string;
}

/** 暗调吧台（默认，VA-11 Hall-A 气质）。 */
export const DARK_THEME: RenderTheme = {
  background: "#171221",
  backgroundLow: "#0e0a16",
  glassStroke: "#9db4d0",
  glassFill: "#3a4256",
  propStroke: "#1c1626",
  frost: "#cfe6f5",
  counterTop: "#5c3a44",
  counterBottom: "#2c1a24",
  counterEdge: "#c98a6a",
  glow: "#ffd9a0",
  metalHi: "#d8e2ee",
  metalLo: "#4a5464",
  woodHi: "#c9986a",
  woodLo: "#5c3c24",
  hi: "#ffffff",
};

export const LIGHT_THEME: RenderTheme = {
  background: "#f0e8d8",
  backgroundLow: "#e0d4bc",
  glassStroke: "#4a5464",
  glassFill: "#d8e0e8",
  propStroke: "#2c2620",
  frost: "#ffffff",
  counterTop: "#a8784e",
  counterBottom: "#6e482a",
  counterEdge: "#e8c898",
  glow: "#fff4d8",
  metalHi: "#e8eef4",
  metalLo: "#7c8690",
  woodHi: "#c9986a",
  woodLo: "#6e482a",
  hi: "#ffffff",
};

export interface VesselLookup {
  (vesselId: string): VesselSpec | undefined;
}

export interface RenderOptions {
  theme?: RenderTheme;
  /** 场景时间（毫秒）—— 原型按 80ms 量化传入，得到 12fps 定格感。 */
  timeMs: number;
  /** 特效时间（毫秒）—— 液流条纹/水花/闪烁/气泡用原始时间保持流畅。缺省 = timeMs。 */
  fxMs?: number;
  vessel: VesselLookup;
  stage: { width: number; height: number };
  /** 成品定格进度 0..1（__final 步骤内）—— 触发杯旁星星。 */
  serveProgress?: number;
  debug?: boolean;
}

/* ══════════════════════════ 像素基础 ══════════════════════════ */

/** 像素尺寸（舞台单位/像素）。400×520 的舞台 → 100×130 网格。 */
const PS = 4;

/** 4×4 Bayer 有序抖动矩阵。 */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** 抖动取色：t 越大越倾向 cB。位置 (x,y) 是像素坐标。 */
function dither(x: number, y: number, t: number, cA: string, cB: string): string {
  const th = (BAYER[y & 3]![x & 3]! + 0.5) / 16;
  return t > th ? cB : cA;
}

/** 确定性 hash —— 装饰元素的位置只允许是索引的纯函数。 */
function hash01(i: number, salt: number): number {
  let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function frac(v: number): number {
  return v - Math.floor(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* ── 颜色工具 ── */

function shade(hex: string, k: number): string {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => (k >= 0 ? v + (1 - v) * k : v * (1 + k));
  return rgbToHex({ r: f(r), g: f(g), b: f(b) });
}

/** 液体的 4 档色阶。 */
interface Ramp {
  dark: string;
  base: string;
  light: string;
  hi: string;
}

function rampOf(hex: string): Ramp {
  return { dark: shade(hex, -0.3), base: hex, light: shade(hex, 0.28), hi: shade(hex, 0.55) };
}

/** 混色叠加：t=1 全为 over。冰体用它以极低系数与背后液体合成 —— 近全透明。 */
function mixOver(under: string, over: string, t: number): string {
  const u = hexToRgb(under);
  const o = hexToRgb(over);
  return rgbToHex({
    r: u.r + (o.r - u.r) * t,
    g: u.g + (o.g - u.g) * t,
    b: u.b + (o.b - u.b) * t,
  });
}

/* ── 离屏 buffer（按舞台尺寸缓存一个，别每帧建） ── */

interface Buf {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const bufs = new Map<string, Buf>();

function bufferFor(w: number, h: number): Buf {
  const key = `${w}x${h}`;
  let b = bufs.get(key);
  if (!b) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("拿不到像素 buffer 的 2D 上下文");
    b = { canvas, ctx };
    bufs.set(key, b);
  }
  return b;
}

/* ── 像素绘制原语（坐标即网格整数） ── */

type PCtx = CanvasRenderingContext2D;

function dot(c: PCtx, x: number, y: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(x | 0, y | 0, 1, 1);
}

function hline(c: PCtx, x0: number, x1: number, y: number, color: string): void {
  const a = Math.min(x0, x1) | 0;
  const b = Math.max(x0, x1) | 0;
  if (b < a) return;
  c.fillStyle = color;
  c.fillRect(a, y | 0, b - a + 1, 1);
}

function vline(c: PCtx, x: number, y0: number, y1: number, color: string): void {
  const a = Math.min(y0, y1) | 0;
  const b = Math.max(y0, y1) | 0;
  c.fillStyle = color;
  c.fillRect(x | 0, a, 1, b - a + 1);
}

function rectPx(c: PCtx, x: number, y: number, w: number, h: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0));
}

/** 四角星闪光：小加号（phase<0.5）或大星芒。 */
function sparkle(c: PCtx, x: number, y: number, phase: number, color: string): void {
  if (phase > 0.62) return;
  const big = phase > 0.18 && phase < 0.42;
  dot(c, x, y, color);
  dot(c, x - 1, y, color);
  dot(c, x + 1, y, color);
  dot(c, x, y - 1, color);
  dot(c, x, y + 1, color);
  if (big) {
    dot(c, x - 2, y, color);
    dot(c, x + 2, y, color);
    dot(c, x, y - 2, color);
    dot(c, x, y + 2, color);
    dot(c, x - 1, y - 1, color);
    dot(c, x + 1, y - 1, color);
    dot(c, x - 1, y + 1, color);
    dot(c, x + 1, y + 1, color);
  }
}

/* ── 剖面平滑（与物理的分段线性解耦，corner 点保持棱角） ── */

function radAt(profile: readonly { y: number; r: number; corner?: boolean }[], y: number): number {
  const target = clamp01(y);
  const n = profile.length;
  if (n < 3) return radiusAt(profile, target);
  let i = 0;
  while (i < n - 2 && profile[i + 1]!.y < target) i++;
  const p1 = profile[i]!;
  const p2 = profile[i + 1]!;
  if (p1.corner || p2.corner) return radiusAt(profile, target);
  const span = p2.y - p1.y;
  if (span <= 0) return p2.r;
  const t = (target - p1.y) / span;
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

/* ══════════════════════════ 主入口 ══════════════════════════ */

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  opts: RenderOptions,
): void {
  const theme = opts.theme ?? DARK_THEME;
  const { width, height } = opts.stage;
  const gw = Math.round(width / PS);
  const gh = Math.round(height / PS);
  const buf = bufferFor(gw, gh);
  const b = buf.ctx;
  const fxMs = opts.fxMs ?? opts.timeMs;

  // ── 背景（像素渐变 + 抖动） ──
  drawBackdrop(b, gw, gh, theme);

  // 背景快照（0-255 → 0-1 归一化）：液体透明度按混色叠加透出背景，深浅主题自动适配
  const bgSnap = b.getImageData(0, 0, gw, gh);
  const bgCache = new Map<number, string>();
  const bgUnderAt = (x: number, y: number): string => {
    const k = y * gw + x;
    let hex = bgCache.get(k);
    if (hex === undefined) {
      const o = k * 4;
      hex = rgbToHex({ r: bgSnap.data[o]! / 255, g: bgSnap.data[o + 1]! / 255, b: bgSnap.data[o + 2]! / 255 });
      bgCache.set(k, hex);
    }
    return hex;
  };

  // ── 整屏 1px 震动（有容器在摇时） ──
  let shakeX = 0;
  let shakeY = 0;
  const shaking = scene.containers.some((c) => c.shake !== null);
  if (shaking) {
    shakeX = Math.round(Math.sin(opts.timeMs * 0.055));
    shakeY = Math.round(Math.cos(opts.timeMs * 0.041));
  }

  // ── 容器（焦点最后画） ──
  const sorted = [...scene.containers].sort((a, c) =>
    a.id === scene.focus ? 1 : c.id === scene.focus ? -1 : 0,
  );
  for (const c of sorted) {
    const vessel = opts.vessel(c.vesselId);
    if (!vessel) continue;
    drawContainer(b, c, vessel, theme, opts, fxMs, bgUnderAt);
  }

  // ── 道具与液流 ──
  for (const p of scene.props) drawProp(b, p, theme, fxMs);

  // ── 舞台级粒子 ──
  for (const e of scene.effects) drawEffect(b, e, fxMs, theme);

  // ── 成品定格的星星 ──
  if (opts.serveProgress !== undefined) {
    drawServeStars(b, scene, opts, fxMs, theme);
  }

  // ── 放大贴图（关平滑 = 像素锐利） ──
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(buf.canvas, shakeX * PS, shakeY * PS, width, height);
  ctx.restore();
}

/** 背景：竖向两段渐变（抖动过渡）+ 台面 + 主位背光。 */
function drawBackdrop(b: PCtx, gw: number, gh: number, theme: RenderTheme): void {
  const counterY = gh - 14;
  for (let y = 0; y < gh; y++) {
    if (y >= counterY) {
      const t = (y - counterY) / (gh - counterY);
      for (let x = 0; x < gw; x++) {
        dot(b, x, y, dither(x, y, t, theme.counterTop, theme.counterBottom));
      }
    } else {
      const t = y / counterY;
      for (let x = 0; x < gw; x++) {
        dot(b, x, y, dither(x, y, t, theme.background, theme.backgroundLow));
      }
    }
  }
  // 台面前缘受光线
  hline(b, 0, gw - 1, counterY, theme.counterEdge);
  // 主位背光：像素化的放射光斑
  const gx = Math.round(gw / 2);
  const gy = counterY - 6;
  for (let r = 10; r > 0; r -= 2) {
    for (let y = gy - r; y <= gy + r; y++) {
      for (let x = gx - r; x <= gx + r; x++) {
        const d = Math.hypot(x - gx, (y - gy) * 2.2);
        if (d < r && hash01(x * 7 + y * 13, 3) < 0.16 * (1 - r / 11)) {
          dot(b, x, y, theme.glow);
        }
      }
    }
  }
}

/* ══════════════════════════ 容器 ══════════════════════════ */

function drawContainer(
  b: PCtx,
  c: RenderedContainer,
  vessel: VesselSpec,
  theme: RenderTheme,
  opts: RenderOptions,
  fxMs: number,
  /** 背景取色（液体透明混色用）。 */
  underBg: (x: number, y: number) => string,
): void {
  const profile = vessel.def.shape.profile;
  const gh = Math.max(4, Math.round((c.height * c.scale) / PS)); // 杯体像素高
  // 摇晃：量化时间驱动，位移吸附到整像素
  let ox = 0;
  let oy = 0;
  if (c.shake) {
    const t = (opts.timeMs / 1000) * c.shake.freqHz * Math.PI * 2 + c.shake.phase;
    ox = Math.round(Math.sin(t) * c.shake.ampX * 0.35);
    oy = Math.round(Math.cos(t * 1.7) * c.shake.ampY * 0.35);
  }
  const cx = Math.round((c.x + ox) / PS);
  const cy = Math.round((c.y + oy) / PS); // 杯底中心（网格）
  const opacity = c.opacity;
  if (opacity < 0.02) return;

  const halfWAt = (gyUp: number): number => {
    // gyUp：距杯底的像素行数（0..gh）
    const yn = clamp01(gyUp / gh);
    return Math.max(1, Math.round(radAt(profile, yn) * gh));
  };

  // ── 柱脚与底座（高脚杯） ──
  const stem = vessel.def.shape.stem;
  if (stem) {
    const shPx = Math.round(stem.height * gh);
    const swPx = Math.max(1, Math.round(stem.width * gh * 0.5));
    for (let y = 1; y <= shPx; y++) {
      hline(b, cx - swPx + 1, cx + swPx - 1, cy + y, theme.glassFill);
      dot(b, cx - swPx, cy + y, theme.glassStroke);
      dot(b, cx + swPx, cy + y, theme.glassStroke);
    }
    if (vessel.def.shape.base) {
      const br = Math.max(2, Math.round(vessel.def.shape.base.radius * gh));
      hline(b, cx - br, cx + br, cy + shPx, theme.glassStroke);
      hline(b, cx - br + 1, cx + br - 1, cy + shPx + 1, theme.glassStroke);
      hline(b, cx - br + 1, cx - Math.round(br * 0.3), cy + shPx, theme.hi); // 底座受光
    }
  }

  // ── 液体（自下而上，先内容后杯壁） ──
  const layers = c.layers;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.toH <= l.fromH) continue;
    const rp = rampOf(l.color);
    const rowTop = cy - Math.round(l.toH * gh);
    const rowBot = cy - Math.round(l.fromH * gh);
    const below = layers[i - 1];
    const blendRows = Math.round(l.blend * gh);
    // 透明度：<1 的层与背后混色叠加（上层叠在下层基色上，底层直接叠像素背景）
    const alpha = clamp01(l.opacity);
    const belowTop = below ? cy - Math.round(below.toH * gh) : 0;
    const belowBot = below ? cy - Math.round(below.fromH * gh) : 0;
    // 液面波浪：扰动度驱动的行波 + 交叉短波，只在顶层
    const isTop = i === layers.length - 1;
    const waveAmp = isTop ? Math.min(2, c.agitation * 2.2) : 0;
    const waveAt = (px: number): number =>
      waveAmp * Math.sin(fxMs * 0.012 + px * 0.8) + waveAmp * 0.5 * Math.sin(fxMs * 0.023 + px * 2.1);
    const yStart = rowTop - Math.ceil(waveAmp * 1.5) - 1;
    for (let y = Math.min(yStart, rowTop); y <= rowBot; y++) {
      const gyUp = cy - y;
      const hw = Math.max(1, halfWAt(gyUp) - 1);
      for (let x = cx - hw; x <= cx + hw; x++) {
        // 波谷上方的空隙不画（顶层液面起伏）
        if (isTop && y < rowTop + Math.round(waveAt(x))) continue;
        let col: string;
        // 层间过渡带：Bayer 抖动
        const fromBound = y - rowTop;
        if (below && blendRows > 0 && fromBound >= 0 && fromBound < blendRows) {
          col = dither(x, y, 0.3 + (0.4 * fromBound) / blendRows, rp.base, rampOf(below.color).base);
        } else {
          // 深度吸光：越靠杯底越暗；浑浊层反差收敛
          const depth = (y - rowTop) / Math.max(1, rowBot - rowTop);
          const k = l.texture === "clear" ? 0.55 : 0.3;
          col = depth < 0.12 ? rp.light : dither(x, y, depth * k, rp.base, rp.dark);
        }
        // 圆柱侧向遮光：贴壁两边暗一档（宽度够时）
        if (hw >= 4 && (x === cx - hw || x === cx + hw)) col = rp.dark;
        if (alpha < 1) {
          const under = below && y >= belowTop && y <= belowBot ? below.color : underBg(x, y);
          col = mixOver(under, col, alpha);
        }
        dot(b, x, y, col);
      }
      // 浑浊质地：悬浮果粒
      if ((l.texture === "cloudy" || l.texture === "creamy") && (y + cx) % 2 === 0) {
        const hx = cx + Math.round((hash01(y * 31, i * 7 + 1) * 2 - 1) * (hw - 2));
        dot(b, hx, y, rp.light);
      }
    }
    // meniscus：液面亮线跟随波浪起伏 + 缓慢游走的高光点
    if (i === layers.length - 1) {
      const hw = Math.max(1, halfWAt(cy - rowTop) - 1);
      for (let px = cx - hw; px <= cx + hw; px++) {
        dot(b, px, rowTop + Math.round(waveAt(px)), rp.hi);
      }
      const glintX = cx + Math.round(Math.sin(fxMs * 0.0011) * hw * 0.5);
      dot(b, glintX, rowTop + Math.round(waveAt(glintX)), theme.hi);
      dot(b, glintX + 1, rowTop + Math.round(waveAt(glintX + 1)), theme.hi);
    }
  }

  // ── 杯内气泡（carbonation 驱动，fxMs 纯函数） ──
  const carb = layers.reduce((s, l) => s + Math.max(0, l.toH - l.fromH) * l.carbonation, 0);
  if (carb > 0.02 && layers.length > 0) {
    const top = layers[layers.length - 1]!;
    const surfRow = cy - Math.round(top.toH * gh);
    const span = Math.max(2, cy - surfRow - 2);
    const n = Math.min(26, Math.round(carb * 46));
    for (let i = 0; i < n; i++) {
      const rise = frac(hash01(i, 11) + (fxMs / 1000) * (0.1 + hash01(i, 17) * 0.12));
      const y = cy - 1 - Math.round(rise * span);
      const hw = Math.max(1, halfWAt(cy - y) - 2);
      const x = cx + Math.round((hash01(i, 23) * 2 - 1) * hw);
      dot(b, x, y, rise > 0.85 ? theme.hi : theme.frost);
    }
  }

  // ── 冰 ──
  // 快照此刻的 buffer（背景+液体已画好）：冰体按极低系数与它混色 → 近全透明
  if (c.ice.length > 0) {
    const snap = b.getImageData(0, 0, b.canvas.width, b.canvas.height);
    const cache = new Map<number, string>();
    const underAt = (x: number, y: number): string => {
      const k = y * b.canvas.width + x;
      let hex = cache.get(k);
      if (hex === undefined) {
        const o = k * 4;
        // rgbToHex 接收 0-1 分量，ImageData 是 0-255 —— 先归一化
        hex = rgbToHex({
          r: snap.data[o]! / 255,
          g: snap.data[o + 1]! / 255,
          b: snap.data[o + 2]! / 255,
        });
        cache.set(k, hex);
      }
      return hex;
    };
    for (const ice of c.ice) drawIce(b, ice, halfWAt, gh, cx, cy, theme, underAt, c.agitation, fxMs);
  }

  // ── 泡沫冠（白噪点带，顶部起伏） ──
  if (c.foam) {
    const fTop = cy - Math.round(c.foam.toH * gh);
    const fBot = cy - Math.round(c.foam.fromH * gh);
    const fr = rampOf(c.foam.color);
    for (let y = fTop; y <= fBot; y++) {
      const hw = Math.max(1, halfWAt(cy - y) - 1);
      for (let x = cx - hw; x <= cx + hw; x++) {
        const n = hash01(x * 3 + y * 5, 91);
        dot(b, x, y, n < 0.18 ? fr.dark : n < 0.3 ? fr.light : fr.base);
      }
    }
  }

  // ── 杯内烟雾 ──
  if (c.smoke > 0.02) {
    const sTop = cy - gh;
    for (let y = sTop; y < cy; y++) {
      const hw = Math.max(1, halfWAt(cy - y) - 1);
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (hash01(x * 5 + y * 3, 57) < c.smoke * 0.4) dot(b, x, y, theme.frost);
      }
    }
  }

  // ── 结霜 ──
  if (c.frost > 0.02) {
    const n = Math.round(c.frost * gh * 1.6);
    for (let i = 0; i < n; i++) {
      const gyUp = Math.round(hash01(i, 5) * gh * 0.9);
      const hw = Math.max(1, halfWAt(gyUp) - 1);
      const x = cx + Math.round((hash01(i, 9) * 2 - 1) * hw);
      dot(b, x, cy - gyUp, theme.frost);
    }
  }

  // ── 杯壁（轮廓 + 内壁 + 左侧高光列） ──
  for (let gyUp = 0; gyUp <= gh; gyUp++) {
    const hw = halfWAt(gyUp);
    const y = cy - gyUp;
    dot(b, cx - hw, y, theme.glassStroke);
    dot(b, cx + hw, y, theme.glassStroke);
    // 空杯区（液面以上）的内壁
    const top = layers[layers.length - 1];
    const surfRow = top ? cy - Math.round(top.toH * gh) : cy;
    if (y < surfRow && hw > 1) {
      dot(b, cx - hw + 1, y, theme.glassFill);
      dot(b, cx + hw - 1, y, theme.glassFill);
    }
    // 左侧高光列（隔行，像素感）
    if (gyUp % 2 === 0 && hw > 2) dot(b, cx - hw + 1, y, theme.hi);
  }
  // 杯底与杯口横线
  const hwB = halfWAt(0);
  hline(b, cx - hwB, cx + hwB, cy, theme.glassStroke);
  const hwT = halfWAt(gh);
  hline(b, cx - hwT, cx + hwT, cy - gh, theme.glassStroke);
  if (!stem) hline(b, cx - hwB, cx + hwB, cy + 1, theme.glassFill); // 无脚杯厚底

  // ── 盐/糖边 + 闪光 ──
  if (c.rim) {
    const rr = rampOf(c.rim.color);
    const start = c.rim.coverage === "half" ? 0.5 : 0;
    for (let i = 0; i <= hwT * 2; i++) {
      if (i / (hwT * 2) < start) continue;
      const x = cx - hwT + i;
      if (hash01(i, 21) < 0.7) dot(b, x, cy - gh - 1, hash01(i, 33) < 0.5 ? rr.base : rr.light);
      if (hash01(i, 41) < 0.25) dot(b, x, cy - gh - 2, rr.light);
    }
    // 四角星闪光：三个固定相位轮流闪
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const ph = frac(fxMs / 1500 + sIdx * 0.37);
      const sx = cx - hwT + Math.round(hash01(sIdx, 77) * hwT * 2);
      sparkle(b, sx, cy - gh - 2, ph, theme.hi);
    }
  }

  // ── 盖子 ──
  if (c.lidOn) {
    const lw = hwT + 2;
    rectPx(b, cx - lw, cy - gh - 3, lw * 2 + 1, 3, theme.metalLo);
    hline(b, cx - lw, cx + lw, cy - gh - 3, theme.metalHi);
    rectPx(b, cx - lw + 1, cy - gh - 4, lw * 2 - 1, 1, theme.metalHi);
  }

  // ── 装饰（像素 sprite，加入后持久存在） ──
  for (const g of c.garnishes) {
    if (g.opacity < 0.05) continue;
    const anchor = garnishAnchor(g, cx, cy, gh, halfWAt(gh));
    drawGarnishSprite(b, g.garnishId, g.prep, anchor.x, anchor.y, g.color, theme);
  }

  // ── 摇晃速度线 ──
  if (c.shake) {
    const side = Math.sin((opts.timeMs / 1000) * c.shake.freqHz * Math.PI * 2 + c.shake.phase) > 0 ? -1 : 1;
    const lx = cx + side * (halfWAt(Math.round(gh * 0.6)) + 3);
    for (let i = 0; i < 3; i++) {
      hline(b, lx, lx + side * (2 + i), cy - Math.round(gh * (0.3 + i * 0.25)), theme.glassStroke);
    }
  }

  if (opts.debug) {
    for (const l of layers) {
      for (const yn of [l.fromH, l.toH]) {
        const y = cy - Math.round(yn * gh);
        const hw = halfWAt(cy - y);
        hline(b, cx - hw, cx + hw, y, "#ff2a92");
      }
    }
  }
}

function garnishAnchor(
  g: RenderedContainer["garnishes"][number],
  cx: number,
  cy: number,
  gh: number,
  hwTop: number,
): { x: number; y: number } {
  let x = cx + Math.round(g.dx / PS);
  let y = cy - gh + Math.round(g.dy / PS);
  if (g.position === "rim") x += Math.round(hwTop * 0.8);
  if (g.position === "side") x += hwTop + 4;
  if (g.position === "in_glass") y += Math.round(gh * 0.3);
  return { x, y };
}

/* ── 冰 ── */

function drawIce(
  b: PCtx,
  ice: RenderedIce,
  halfWAt: (gyUp: number) => number,
  gh: number,
  cx: number,
  cy: number,
  theme: RenderTheme,
  /** 冰体透明合成：取此刻 buffer（背景+液体）的颜色。 */
  underAt: (x: number, y: number) => string,
  /** 扰动度：驱动冰块浮动/晃动（摇、搅、落冰余波）。 */
  agit: number,
  fxMs: number,
): void {
  const sizePx = Math.max(2, Math.round((ice.size * gh) / 2));
  const gyUp = ice.y * gh;
  const hw = halfWAt(Math.round(gyUp));
  const salt = Math.round(ice.rot * 100);
  // 浮动/晃动：确定性正弦，每块冰相位不同（salt 派生）
  const bobX = Math.round(Math.cos(fxMs * 0.016 + salt) * agit * 1.4);
  const bobY = Math.round(Math.sin(fxMs * 0.021 + salt * 1.7) * agit * 1.8);
  const x = cx + Math.round(ice.x * hw * 0.7) + bobX;
  // 沉底钳位：静止冰块贴住杯底（不悬空、不穿底）—— block 走底对齐，crushed 颗粒云不钳
  let y = cy - Math.round(gyUp);
  if (ice.kind === "sphere") {
    y = Math.min(y, cy - Math.max(2, sizePx) - 1);
  } else if (ice.kind !== "block" && ice.kind !== "crushed") {
    const s2 = ice.kind === "large_cube" ? sizePx + 1 : sizePx;
    y = Math.min(y, cy - s2 - 1);
  }
  y += bobY;

  // 冰体近全透明：极低系数的混色，隐约带一层冷色调
  const body = (xx: number, yy: number): string => mixOver(underAt(xx, yy), "#dceef8", 0.15);

  switch (ice.kind) {
    case "block": {
      // 长条冰柱：底边 = y + 半高（静止时 y≈0 贴杯底；落冰编排插值 y 时整根下落）
      const w = Math.max(3, sizePx);
      const hPx = Math.min(Math.round(gh * 0.86), sizePx * 5);
      const yBot = Math.min(cy - 1, y + Math.round(hPx / 2));
      const yTop = Math.max(cy - gh + 2, yBot - hPx);
      for (let yy = yTop; yy <= yBot; yy++) {
        for (let xx = x - (w >> 1); xx <= x + (w >> 1); xx++) {
          dot(b, xx, yy, body(xx, yy));
        }
        dot(b, x - (w >> 1), yy, theme.hi);
        dot(b, x + (w >> 1), yy, "#8fb4cc");
      }
      // 顶/底封口
      hline(b, x - (w >> 1), x + (w >> 1), yTop, theme.frost);
      hline(b, x - (w >> 1), x + (w >> 1), yBot, "#8fb4cc");
      break;
    }
    case "sphere": {
      const rr = Math.max(2, sizePx);
      // 球体：近透明 + 完整环形描边（上左亮、下右暗）
      for (let dy = -rr; dy <= rr; dy++) {
        const half = Math.floor(Math.sqrt(rr * rr - dy * dy));
        for (let xx = x - half; xx <= x + half; xx++) {
          dot(b, xx, y + dy, body(xx, y + dy));
        }
        dot(b, x - half, y + dy, dy <= 0 ? theme.frost : "#9cc0d8");
        dot(b, x + half, y + dy, dy >= 0 ? "#9cc0d8" : theme.frost);
      }
      // 顶点高光：点，不画横线（圆顶上平线会像一条横杠）
      dot(b, x - 1, y - rr + 1, theme.hi);
      dot(b, x, y - rr + 1, theme.hi);
      break;
    }
    case "crushed": {
      // 碎冰：微小近透明颗粒 + 少量亮霜点当"边"
      for (let i = 0; i < sizePx * 2 + 3; i++) {
        const dx2 = Math.round((hash01(i, salt) * 2 - 1) * sizePx);
        const dy2 = Math.round((hash01(i, salt + 7) * 2 - 1) * sizePx * 0.7);
        const px = x + dx2;
        const py = y + dy2;
        dot(b, px, py, mixOver(underAt(px, py), "#dceef8", 0.3));
        if (hash01(i, salt + 31) < 0.3) dot(b, px, py - 1, theme.frost);
      }
      break;
    }
    case "cracked":
    case "cube":
    case "large_cube":
    case "dry_ice":
    default: {
      const s2 = ice.kind === "large_cube" ? sizePx + 1 : sizePx;
      // 方冰：近透明体 + 四边完整描边（上左亮、下右暗）
      for (let yy = y - s2; yy <= y + s2; yy++) {
        for (let xx = x - s2; xx <= x + s2; xx++) {
          dot(b, xx, yy, body(xx, yy));
        }
      }
      hline(b, x - s2, x + s2, y - s2, theme.frost);
      vline(b, x - s2, y - s2, y + s2, theme.frost);
      hline(b, x - s2, x + s2, y + s2, "#9cc0d8");
      vline(b, x + s2, y - s2, y + s2, "#9cc0d8");
      // 内部囚禁气泡（亮点）
      dot(b, x + Math.round(hash01(1, salt) * s2) - 1, y, theme.frost);
      dot(b, x - 1, y + Math.round(hash01(2, salt) * s2) - 1, theme.hi);
      if (ice.kind === "cracked") {
        dot(b, x, y, "#9cc0d8");
        dot(b, x + 1, y + 1, "#9cc0d8");
      }
      break;
    }
  }
}

/* ══════════════════════════ 装饰 sprite ══════════════════════════ */

/**
 * 像素装饰：字符串点阵，字符映射到色板。
 *  o=描边(深)  b=基色  l=亮色  d=暗色  w=白  s=柄/签（深色）
 */
const SPRITES: Record<string, string[]> = {
  wheel: [
    "..ooo..",
    ".obbbo.",
    "oblbblo",
    "oblllbo",
    "oblbblo",
    ".obbbo.",
    "..ooo..",
  ],
  wedge: ["...oo..", "..obbo.", ".obbbo.", "obdbbbo", "ooooooo"],
  twist: ["..oo.", ".obb.", ".bb..", "obbo.", "bb...", "obb..", "..bbo", "..oo."],
  cherry: ["....ss.", "...s...", ".oooo..", "owbbbo.", "obbbbdo", ".obddo.", "..ooo.."],
  mint: [".l...l.", "ll.b.ll", ".llbl..", "..bb...", "...s...", "...s...", "..sss.."],
  flag: ["c.....w..", ".c...w.s.", "..c.w..s.", "...c...s.", ".......s."],
};

function drawGarnishSprite(
  b: PCtx,
  garnishId: string,
  prep: string,
  x: number,
  y: number,
  color: string,
  theme: RenderTheme,
): void {
  let key = "wheel";
  if (garnishId.includes("cherry")) key = "cherry";
  else if (garnishId.includes("mint") || prep === "slapped") key = "mint";
  else if (prep === "twist" || prep === "expressed") key = "twist";
  else if (prep === "wedge") key = "wedge";
  else if (prep === "flag") key = "flag";
  const rows = SPRITES[key]!;
  const rp = rampOf(color);
  const pal = (ch: string): string | null => {
    switch (ch) {
      case "o":
        return rp.dark;
      case "b":
        return rp.base;
      case "l":
        return rp.light;
      case "d":
        return shade(color, -0.45);
      case "w":
        return theme.hi;
      case "s":
        return theme.woodLo;
      case "c":
        return rampOf("#8c1024").base;
      default:
        return null;
    }
  };
  const ox = x - Math.round(rows[0]!.length / 2);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let i = 0; i < row.length; i++) {
      const col = pal(row[i]!);
      if (col) dot(b, ox + i, y + r, col);
    }
  }
}

/* ══════════════════════════ 道具与液流 ══════════════════════════ */

const PROP_SPRITES: Record<string, string[]> = {
  jigger: [
    "mmmmmmm",
    "mhmmmm.",
    ".mhmm..",
    "..mm...",
    "..mm...",
    ".mhmm..",
    "mhmmmm.",
    "mmmmmmm",
  ],
  bottle: [
    "..mm...",
    "..mm...",
    "..mm...",
    ".mmmm..",
    "mmmmmm.",
    "mhmmmm.",
    "mllllm.",
    "mllllm.",
    "mhmmmm.",
    "mmmmmm.",
    "mmmmmm.",
    ".mmmm..",
  ],
  strainer: ["....hhhhh", "mmmmmmmm.", "sssssss..", "mmmmmmmm."],
  muddler: [
    ".mmm.",
    "mmmmm",
    ".mmm.",
    "..m..",
    "..m..",
    "..m..",
    "..m..",
    "..m..",
    "mmmmm",
    "mmmmm",
    "mmmmm",
  ],
  spray: [".mm.", "mm..", "mmmm", "mmmm", "mmmm", ".mm."],
  swizzle: ["..m..", "..m..", "..m..", "..m..", "..m..", "m.m.m", ".mmm.", "..m.."],
  barspoon_head: ["..mm..", ".mmmm.", "..mm.."],
};

function drawProp(b: PCtx, p: Prop, theme: RenderTheme, fxMs: number): void {
  const gx = Math.round(p.x / PS);
  const gy = Math.round(p.y / PS);
  if (p.opacity < 0.05) return;

  // 液流先画（道具压在上面）—— 起点用壶口坐标（缺省回退道具中心）
  if (p.stream) {
    drawStream(
      b,
      Math.round((p.stream.fromX ?? p.x) / PS),
      Math.round((p.stream.fromY ?? p.y) / PS),
      p.stream,
      theme,
      fxMs,
      p.opacity,
    );
  }

  const pal = (ch: string): string | null => {
    switch (ch) {
      case "m":
        return theme.metalLo;
      case "h":
        return theme.metalHi;
      case "l":
        return "#e8dcc0"; // 标签
      case "s":
        return theme.metalHi; // 弹簧圈
      default:
        return null;
    }
  };

  if (p.kind === "barspoon" || p.kind === "swizzle" || p.kind === "muddler") {
    drawRodProp(b, p, theme, fxMs);
    return;
  }

  const rows = PROP_SPRITES[p.kind];
  if (!rows) {
    // 未知道具：小方块兜底
    rectPx(b, gx - 2, gy - 2, 4, 4, theme.metalLo);
    hline(b, gx - 2, gx + 1, gy - 2, theme.metalHi);
    return;
  }
  const ox = gx - Math.round(rows[0]!.length / 2);
  const tilt = Math.round(p.rot * 3); // 倾斜量化成整体横移，像素质感
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const rowShift = Math.round(tilt * (1 - r / rows.length));
    for (let i = 0; i < row.length; i++) {
      const col = pal(row[i]!);
      if (col) dot(b, ox + i + rowShift, gy + r, col);
    }
  }
}

/**
 * 长杆道具（吧勺/搅棒/捣棒）：杆身从杯口上方直插杯底（tipY），
 * 搅拌时杆身 + 头部画圆（正视投影 = 正弦横移，fxMs 确定性驱动，可 seek）。
 */
function drawRodProp(b: PCtx, p: Prop, theme: RenderTheme, fxMs: number): void {
  const gx = Math.round(p.x / PS);
  const gy = Math.round(p.y / PS);
  const tip = p.tipY !== undefined ? Math.round(p.tipY / PS) : gy + 40;
  const stirring = p.kind !== "muddler"; // 捣棒只上下捣压，不画圈
  // 圆周投影：顶部摆幅大（柄尾画圈）、尖端贴底几乎不动
  const amp = stirring ? 2 : 0;
  const phase = fxMs * 0.02;
  const swayAt = (yy: number): number => {
    if (!stirring) return 0;
    const k = (tip - yy) / Math.max(1, tip - gy); // 0 尖端 → 1 顶部
    return Math.round(Math.sin(phase + k * 0.6) * amp * k);
  };

  // 杆身：1px 竖线 + 沿杆滚动的螺旋 tick（像金属反光在转）
  for (let yy = gy; yy <= tip; yy++) {
    const dx = swayAt(yy);
    dot(b, gx + dx, yy, theme.metalHi);
    if ((yy + Math.floor(fxMs / 90)) % 5 === 0) dot(b, gx + dx + 1, yy, theme.metalLo);
  }

  if (p.kind === "barspoon") {
    // 勺头：小圆勺，画圈时横移
    const hx = gx + swayAt(tip - 1);
    const rows = PROP_SPRITES["barspoon_head"]!;
    for (let r = 0; r < rows.length; r++) {
      for (let i = 0; i < rows[r]!.length; i++) {
        if (rows[r]![i]! !== ".") dot(b, hx - 2 + i, tip - 2 + r, theme.metalLo);
      }
    }
    dot(b, hx - 1, tip - 2, theme.metalHi);
  } else if (p.kind === "swizzle") {
    // 搅棒头：底端三根枝杈（真实 swizzle stick 的分叉在底端）
    const hx = gx + swayAt(tip - 1);
    dot(b, hx, tip, theme.metalLo);
    dot(b, hx - 1, tip - 2, theme.metalLo);
    dot(b, hx + 1, tip - 2, theme.metalLo);
    dot(b, hx - 2, tip - 4, theme.metalHi);
    dot(b, hx + 2, tip - 4, theme.metalHi);
    dot(b, hx, tip - 5, theme.metalLo);
  } else {
    // 捣棒头：宽扁捣头（3px 宽）
    vline(b, gx - 1, tip - 3, tip, theme.metalLo);
    vline(b, gx, tip - 3, tip, theme.metalHi);
    vline(b, gx + 1, tip - 3, tip, theme.metalLo);
    hline(b, gx - 1, gx + 1, tip, theme.metalHi);
    // 柄尾加粗
    vline(b, gx - 1, gy, gy + 3, theme.metalLo);
    vline(b, gx + 1, gy, gy + 3, theme.metalLo);
  }
}

/**
 * 液流：从壶口到液面的重力抛物线。
 * 物理表现：出口段粗、下落中加速变细（流量守恒 v↑ → 截面↓）、
 * 表面张力让液流末端收成滴；细流（dash 等）画成下落的像素滴。
 */
function drawStream(
  b: PCtx,
  gx: number,
  gy: number,
  s: NonNullable<Prop["stream"]>,
  theme: RenderTheme,
  fxMs: number,
  opacity: number,
): void {
  const tx = Math.round(s.toX / PS);
  const ty = Math.round(s.toY / PS);
  const rp = rampOf(s.color);
  const topW = s.width >= 4.4 ? 3 : s.width >= 2.4 ? 2 : 1;

  if (s.width < 2.4) {
    // 小剂量：3 滴错相下落的像素滴（初速 0、加速下坠）
    for (let i = 0; i < 3; i++) {
      const ph = frac(fxMs / 640 + i / 3);
      const y = gy + Math.round(ph * ph * (ty - gy));
      const x = gx + Math.round((tx - gx) * ph * ph);
      dot(b, x, y, rp.light);
      if (ph > 0.5) dot(b, x, y - 1, rp.base);
    }
  } else {
    for (let y = gy; y <= ty; y++) {
      const t = (y - gy) / Math.max(1, ty - gy);
      // 重力抛物线：水平速度恒定 → x 随 t² 走
      const x = gx + Math.round((tx - gx) * t * t * 0.9);
      // 流量守恒：v ∝ √(下落高度) → 截面宽 ∝ 1/√(1+t)，出口宽末端细
      const wNow = Math.max(1, Math.round(topW / Math.sqrt(1 + t * 2.2)));
      // 加速感：条纹间隔越靠下越密
      const gap = 3 + Math.round((1 - t) * 2);
      const stripe = (y + Math.floor(fxMs / 70)) % gap === 0;
      hline(b, x - (wNow - 1), x + (wNow - 1), y, stripe ? rp.light : rp.base);
      // 出口段两侧亮边（表面张力收缩出的亮缘）
      if (t < 0.2 && topW >= 2) {
        dot(b, x - wNow, y, rp.light);
        dot(b, x + wNow, y, rp.light);
      }
    }
  }

  // 落点：水花 + 扩散环（像素阶梯）
  const ph = frac(fxMs / 420);
  const rw = 1 + Math.round(ph * 3);
  hline(b, tx - rw, tx + rw, ty, ph > 0.6 ? rp.dark : theme.hi);
  for (let i = 0; i < 3; i++) {
    const ph2 = frac(fxMs / 380 + i * 0.33);
    const sx = tx + Math.round((hash01(i, 7) * 2 - 1) * 3);
    const sy = ty - Math.round(Math.sin(ph2 * Math.PI) * (1.5 + hash01(i, 13) * 2));
    dot(b, sx, sy, theme.hi);
  }
  void opacity;
}

/* ══════════════════════════ 效果粒子 ══════════════════════════ */

function drawEffect(b: PCtx, e: Effect, fxMs: number, theme: RenderTheme): void {
  if (e.kind === "splash") {
    drawSplash(b, e, fxMs);
    return;
  }
  const ps = particlesAt(e, fxMs);
  for (const p of ps) {
    const x = Math.round(p.x / PS);
    const y = Math.round(p.y / PS);
    if (e.kind === "bubbles") {
      dot(b, x, y, theme.frost);
    } else if (e.kind === "flame" || e.kind === "sparks") {
      dot(b, x, y, "#fff3c4");
      if (p.size > 2.4) {
        dot(b, x + 1, y, e.color);
        dot(b, x, y + 1, e.color);
      }
    } else {
      // smoke / mist：抖动淡出的像素团
      if (hash01(x * 3 + y * 7, Math.floor(fxMs / 120)) < p.opacity) {
        dot(b, x, y, e.color);
        if (p.size > 6) dot(b, x + 1, y, e.color);
      }
    }
  }
}

/**
 * 水花：冰块冲击液面时溅起的液滴 —— 抛物线（初速向上 + 重力），
 * 每滴的初速/方向/延迟由 (seed, i) 确定，是 fxMs 的纯函数，可 seek。
 */
function drawSplash(b: PCtx, e: Effect, fxMs: number): void {
  if (fxMs < e.startMs || fxMs > e.endMs) return;
  const lifeMs = e.endMs - e.startMs;
  const n = Math.round(e.rate);
  for (let i = 0; i < n; i++) {
    const delay = hash01(i * 3 + 1, e.seed) * 0.15 * lifeMs;
    const age = fxMs - e.startMs - delay;
    if (age < 0 || age > lifeMs * 0.8) continue;
    const tSec = age / 1000;
    // 舞台单位/秒：向上初速 + 重力回落（20 单位 ≈ 1cm）
    const vy0 = -(50 + hash01(i * 3 + 2, e.seed) * 36);
    const vx = (hash01(i * 3 + 3, e.seed) * 2 - 1) * 30;
    const x =
      e.region.x + e.region.w * 0.5 + (hash01(i * 5 + 7, e.seed) * 2 - 1) * e.region.w * 0.4 + vx * tSec;
    const y = e.region.y + vy0 * tSec + 150 * tSec * tSec;
    const px = Math.round(x / PS);
    const py = Math.round(y / PS);
    // 回落到液面以下后不再画
    if (py > Math.round((e.region.y + e.region.h) / PS)) continue;
    dot(b, px, py, e.color);
  }
}

/** 成品定格：杯旁弹三颗像素星星（出现进度量化成阶梯，之后闪烁）。 */
function drawServeStars(
  b: PCtx,
  scene: Scene,
  opts: RenderOptions,
  fxMs: number,
  theme: RenderTheme,
): void {
  const focus = scene.containers.find((c) => c.id === scene.focus);
  if (!focus) return;
  const cx = Math.round(focus.x / PS);
  const cy = Math.round(focus.y / PS);
  const gh = Math.round(focus.height / PS);
  const prog = opts.serveProgress ?? 0;
  const spots = [
    { x: cx - Math.round(gh * 0.62), y: cy - gh - 4, delay: 0.05 },
    { x: cx + Math.round(gh * 0.6), y: cy - gh - 7, delay: 0.25 },
    { x: cx + Math.round(gh * 0.45), y: cy - gh + 3, delay: 0.45 },
  ];
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]!;
    const local = clamp01((prog - s.delay) / 0.2);
    if (local <= 0) continue;
    // 弹出：0→大→小→常驻闪烁
    const pop = local < 1 ? (local < 0.5 ? 0.1 : 0.35) : frac(fxMs / 1300 + i * 0.41);
    sparkle(b, s.x, s.y, pop, theme.hi);
  }
}
