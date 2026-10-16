/**
 * Canvas 2D 像素风绘制后端（ADR-024、ADR-031）。
 *
 * 管线：
 *   rasterize(scene) → Surface    纯函数，逐像素写 Uint32Array（Node 里也能跑：快照测试、导出 PNG）
 *   renderScene(ctx, scene)       putImageData 到离屏 buffer，再关平滑放大贴到主画布
 *
 * 绘制顺序：后墙 + 酒架（缓存）→ 架上酒瓶 → 台面器具（含冰、固体）→ 液柱 → 手持器具
 * → 工具 → 装饰 → 粒子 → 成品星星。
 *
 * 渲染器不做几何决策：器具姿态、液面、液柱、冰块位置全部来自 Scene（世界坐标）。
 */
import type { Scene, VesselView } from "@shaker/animator-core";
import { drawIce } from "./ice.ts";
import { drawEffect, drawStream } from "./fx.ts";
import { bayer, clamp01, frac, hline, mixRGB, PS, set, shade, sparkle, surface, type Surface } from "./pixels.ts";
import { DARK_THEME, LIGHT_THEME, palette, type Palette, type RenderTheme } from "./theme.ts";
import { drawGarnish, drawSolid, drawTool } from "./tools.ts";
import { drawVessel } from "./vessel.ts";

export { DARK_THEME, LIGHT_THEME, type RenderTheme };
export { PS } from "./pixels.ts";
export type { Surface } from "./pixels.ts";

export interface RenderOptions {
  theme?: RenderTheme;
  debug?: boolean;
  /**
   * 封面模式（mix 0→1 过渡）。1 = 只留指定成品杯：纯净背景、杯中一切内容随之
   * 居中并归一到统一尺度；酒架/工具/液柱/粒子全部隐去。0 < mix < 1 时与普通场景交叉淡化。
   */
  cover?: { vessel: string; mix: number };
}

/* ────────────────────────── 背景（按主题 + 舞台尺寸缓存） ────────────────────────── */

const BACKDROPS = new Map<string, Uint32Array>();

function backdrop(scene: Scene, pal: Palette, theme: RenderTheme, w: number, h: number): Uint32Array {
  const st = scene.stage;
  const key = `${theme.background}|${w}x${h}|${st.counterY}|${st.shelves.map((s) => s.y).join(",")}`;
  let bg = BACKDROPS.get(key);
  if (bg) return bg;
  const s = surface(w, h);
  const counter = Math.round(st.counterY / PS);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y >= counter) {
        const t = (y - counter) / Math.max(1, h - counter);
        set(s, x, y, bayer(x, y) < t ? pal.counterBottom : pal.counterTop);
      } else {
        const t = y / counter;
        // 主位背光：舞台中下一团暖光
        const glow = clamp01(1 - Math.hypot((x - w / 2) / (w * 0.45), (y - counter) / (counter * 0.7)));
        let c = bayer(x, y) < t ? pal.backgroundLow : pal.background;
        if (glow > 0) c = mixRGB(c, pal.glow, glow * glow * 0.12);
        set(s, x, y, c);
      }
    }
  }
  hline(s, 0, w - 1, counter, pal.counterEdge);
  // 酒架：隔板（上沿受光、下沿投影）+ 两端支架
  for (const sh of st.shelves) {
    const y = Math.round(sh.y / PS);
    const x0 = Math.round(sh.x0 / PS);
    const x1 = Math.round(sh.x1 / PS);
    hline(s, x0, x1, y, pal.shelfEdge);
    hline(s, x0, x1, y + 1, pal.shelf);
    hline(s, x0, x1, y + 2, shade(pal.backgroundLow, -0.2), 0.6);
    for (const xx of [x0 + 1, x1 - 1]) {
      set(s, xx, y + 2, pal.shelf);
      set(s, xx, y + 3, pal.shelf);
    }
  }
  bg = s.data.slice();
  BACKDROPS.set(key, bg);
  return bg;
}

/* ────────────────────────── 光栅化 ────────────────────────── */

export function rasterize(scene: Scene, opts: RenderOptions = {}, target?: Surface): Surface {
  const theme = opts.theme ?? DARK_THEME;
  const pal = palette(theme);
  const w = Math.round(scene.stage.width / PS);
  const h = Math.round(scene.stage.height / PS);
  const s = target && target.w === w && target.h === h ? target : surface(w, h);

  // 封面过渡：成品杯连续滑动到封面位（推到你面前），杂物淡出、台面保留
  const coverMix = clamp01(opts.cover?.mix ?? 0);
  if (coverMix > 0 && opts.cover) {
    coverTransition(scene, s, pal, theme, opts.cover.vessel, coverMix, w, h);
    return s;
  }

  s.data.set(backdrop(scene, pal, theme, w, h));
  drawSceneContents(scene, s, pal, opts);
  return s;
}

/** 正常场景的全部内容（skipVessel 用于封面过渡：成品杯单独走滑动路径）。 */
function drawSceneContents(
  scene: Scene,
  s: Surface,
  pal: Palette,
  opts: RenderOptions,
  skipVessel?: string,
): void {
  const t = scene.tMs;

  const byZ = (z: number) => scene.vessels.filter((v) => (z === 2 ? v.z >= 2 : v.z === z));
  const drawOne = (v: VesselView) => {
    if (v.id === skipVessel) return;
    const shape = scene.shapes[v.id] ?? scene.shapes[v.shapeId];
    if (!shape) return;
    if (v.id === "blender" || v.shapeId === "__blender") {
      const base = scene.tools.find((x) => x.kind === "blender_base");
      if (base) drawTool(s, base, pal, t);
    }
    drawVessel(s, v, shape, pal, t);
    if (shape.material !== "metal") {
      for (const sol of v.solids) drawSolid(s, sol, pal);
      drawIce(s, v.ice, pal);
    } else {
      // 金属器具剖视：内容物压暗一档，与罩过壳色的液体亮度一致（vessel.ts 的剖视分支）
      for (const sol of v.solids) drawSolid(s, sol, pal, 0.55);
      drawIce(s, v.ice, pal, 0.7);
    }
  };

  // 后墙酒架上的酒瓶
  for (const v of byZ(0)) drawOne(v);
  // 台面器具
  for (const v of byZ(1)) drawOne(v);
  // 液柱（在手持器具之后画会盖住出液口，所以先画）
  for (const st of scene.streams) drawStream(s, st, pal, t);
  // 手持器具（倒酒的瓶子、量酒器、摇壶）
  for (const v of byZ(2)) drawOne(v);
  // 工具（滤网挂在器具上，画在器具之后）
  for (const tool of scene.tools) if (tool.kind !== "blender_base") drawTool(s, tool, pal, t);
  // 装饰
  for (const v of scene.vessels) {
    if (v.id === skipVessel) continue;
    for (const g of v.garnishes) drawGarnish(s, g, pal);
  }
  // 粒子
  for (const e of scene.effects) drawEffect(s, e, pal, t);
  if (scene.serve !== undefined) drawServeStars(s, scene, pal, t);
  if (opts.debug) drawDebug(s, scene);
}

/** ABGR 打包像素逐通道插值：a 向 b 按 k 交叉淡化（结果写回 a）。 */
function crossfadeInto(a: Surface, b: Surface, k: number): void {
  const da = a.data;
  const db = b.data;
  const q = 1 - k;
  for (let i = 0; i < da.length; i++) {
    const pa = da[i]!;
    const pb = db[i]!;
    const r = Math.round((pa & 255) * q + (pb & 255) * k);
    const g = Math.round(((pa >> 8) & 255) * q + ((pb >> 8) & 255) * k);
    const bl = Math.round(((pa >> 16) & 255) * q + ((pb >> 16) & 255) * k);
    da[i] = ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0;
  }
}

/** 封面背景：保留台面与墙面暖光，只去掉酒架（杂物淡出后杯子仍立在吧台上）。 */
function coverBackdrop(s: Surface, pal: Palette, scene: Scene): void {
  const counter = Math.round(scene.stage.counterY / PS);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (y >= counter) {
        const t = (y - counter) / Math.max(1, s.h - counter);
        set(s, x, y, bayer(x, y) < t ? pal.counterBottom : pal.counterTop);
      } else {
        const t = y / counter;
        const glow = clamp01(1 - Math.hypot((x - s.w / 2) / (s.w * 0.45), (y - counter) / (counter * 0.7)));
        let c = bayer(x, y) < t ? pal.backgroundLow : pal.background;
        if (glow > 0) c = mixRGB(c, pal.glow, glow * glow * 0.12);
        set(s, x, y, c);
      }
    }
  }
  hline(s, 0, s.w - 1, counter, pal.counterEdge);
}

/**
 * 封面过渡（mix 0→1）：调酒师把杯子推到你面前 ——
 *   fadeK  杂物（酒架、背景瓶、工具、液柱）按 1.5 倍速率先淡出，台面保留；
 *   poseK  成品杯以 easeInOutCubic 连续滑向封面位：水平居中、杯底落在台面上、
 *          保持自然尺度（不放大，只防宽口杯横向超 80% 画面宽）。
 */
function coverTransition(
  scene: Scene,
  s: Surface,
  pal: Palette,
  theme: RenderTheme,
  vesselId: string,
  mix: number,
  w: number,
  h: number,
): void {
  const fadeK = clamp01(mix * 1.5);
  const poseK = mix < 0.5 ? 4 * mix * mix * mix : 1 - (-2 * mix + 2) ** 3 / 2;

  if (fadeK < 1) {
    // A：正常背景 + 除成品杯外的全部内容；B：无酒架背景。A 向 B 淡出
    const a = surface(w, h);
    a.data.set(backdrop(scene, pal, theme, w, h));
    drawSceneContents(scene, a, pal, {}, vesselId);
    const b = surface(w, h);
    coverBackdrop(b, pal, scene);
    crossfadeInto(a, b, fadeK);
    s.data.set(a.data);
  } else {
    coverBackdrop(s, pal, scene);
  }

  const v = scene.vessels.find((x) => x.id === vesselId);
  const shape = v ? (scene.shapes[v.id] ?? scene.shapes[v.shapeId]) : undefined;
  if (!v || !shape) return;

  const stemH = shape.stem ? shape.stem.height : 0;
  // 封面位：保持自然尺度（k ≤ 1，旧封面即自然尺度截帧），水平居中、杯底在台面上
  const totalU = (shape.height + stemH) * v.scale;
  const maxR = Math.max(shape.base?.radius ?? 0, ...shape.radii) * v.scale;
  const k = Math.min(1, (scene.stage.width * 0.8) / (2 * maxR), (scene.stage.counterY - scene.stage.height * 0.06) / totalU);
  const cx = scene.stage.width / 2;
  const cy = scene.stage.counterY - stemH * v.scale * k;
  const lerp = (p: number, q: number): number => p + (q - p) * poseK;
  const x = lerp(v.x, cx);
  const y = lerp(v.y, cy);
  const scale = lerp(v.scale, v.scale * k);
  const r = scale / v.scale;
  const mapX = (wx: number): number => x + (wx - v.x) * r;
  const mapY = (wy: number): number => y + (wy - v.y) * r;
  const slid: VesselView = {
    ...v,
    x,
    y,
    scale,
    rot: v.rot * (1 - poseK),
    layers: v.layers.map((l) => ({ ...l, topY: mapY(l.topY) })),
    ice: v.ice.map((p) => ({ ...p, x: mapX(p.x), y: mapY(p.y), w: p.w * r, h: p.h * r })),
    solids: v.solids.map((p) => ({ ...p, x: mapX(p.x), y: mapY(p.y) })),
    garnishes: v.garnishes.map((g) => ({
      ...g,
      x: mapX(g.x),
      y: mapY(g.y),
      stick: g.stick
        ? { x1: mapX(g.stick.x1), y1: mapY(g.stick.y1), x2: mapX(g.stick.x2), y2: mapY(g.stick.y2) }
        : undefined,
    })),
    foam: v.foam ? { ...v.foam, topY: mapY(v.foam.topY) } : null,
  };
  drawVessel(s, slid, shape, pal, scene.tMs);
  for (const sol of slid.solids) drawSolid(s, sol, pal);
  drawIce(s, slid.ice, pal);
  for (const g of slid.garnishes) drawGarnish(s, g, pal);
}

/** 成品定格：杯旁弹三颗像素星星（出现进度量化成阶梯，之后闪烁；收尾前熄灭 —— 末帧要作封面）。 */
function drawServeStars(s: Surface, scene: Scene, pal: Palette, t: number): void {
  const prog = scene.serve ?? 0;
  if (prog >= 0.85) return;
  const g = scene.vessels.find((v) => v.id === "glass");
  if (!g) return;
  const cx = Math.round(g.x / PS);
  const top = Math.round((g.y - g.height * g.scale) / PS);
  const gh = Math.round((g.height * g.scale) / PS);
  const spots = [
    { x: cx - Math.round(gh * 0.55) - 3, y: top - 4, delay: 0.05 },
    { x: cx + Math.round(gh * 0.5) + 3, y: top - 7, delay: 0.25 },
    { x: cx + Math.round(gh * 0.4) + 2, y: top + 3, delay: 0.45 },
  ];
  spots.forEach((p, i) => {
    const local = clamp01((prog - p.delay) / 0.2);
    if (local <= 0) return;
    const pop = local < 1 ? (local < 0.5 ? 0.1 : 0.35) : frac(t / 1300 + i * 0.41);
    sparkle(s, p.x, p.y, pop, pal.hi);
  });
}

function drawDebug(s: Surface, scene: Scene): void {
  const pink: [number, number, number] = [255, 42, 146];
  for (const v of scene.vessels) {
    for (const l of v.layers) hline(s, Math.round(v.x / PS) - 6, Math.round(v.x / PS) + 6, Math.round(l.topY / PS), pink);
  }
}

/* ────────────────────────── 上屏 ────────────────────────── */

interface Buf {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  surf: Surface;
}

/** 每个目标画布一个离屏 buffer（不再模块级共享 —— 两个播放器互不覆盖）。 */
const BUFS = new WeakMap<CanvasRenderingContext2D, Buf>();

function bufferFor(ctx: CanvasRenderingContext2D, w: number, h: number): Buf {
  let b = BUFS.get(ctx);
  if (!b || b.canvas.width !== w || b.canvas.height !== h) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d", { alpha: false });
    if (!c) throw new Error("拿不到像素 buffer 的 2D 上下文");
    const img = c.createImageData(w, h);
    b = { canvas, ctx: c, img, surf: { w, h, data: new Uint32Array(img.data.buffer) } };
    BUFS.set(ctx, b);
  }
  return b;
}

export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, opts: RenderOptions = {}): void {
  const { width, height } = scene.stage;
  const w = Math.round(width / PS);
  const h = Math.round(height / PS);
  const buf = bufferFor(ctx, w, h);
  rasterize(scene, opts, buf.surf);
  buf.ctx.putImageData(buf.img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(buf.canvas, scene.screenShake.x, scene.screenShake.y, width, height);
  ctx.restore();
}
