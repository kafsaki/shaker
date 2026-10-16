/**
 * 像素面：所有绘制先写进一块 Uint32Array（每像素一个 ABGR 整数），最后一次性贴到画布。
 *
 * 比旧版逐点 `fillStyle + fillRect` 快一个数量级，而且不碰 DOM —— 光栅化部分在
 * Node 里也能跑（快照测试、导出 PNG）。
 *
 * 坐标：像素格 (px, py)，一个像素格 = PS 舞台单位。像素中心对应舞台坐标
 * ((px + 0.5)·PS, (py + 0.5)·PS)。
 */

export const PS = 4;

export interface Surface {
  w: number;
  h: number;
  data: Uint32Array;
}

export function surface(w: number, h: number): Surface {
  return { w, h, data: new Uint32Array(w * h) };
}

/* ────────────────────────── 颜色 ────────────────────────── */

export type RGB = readonly [number, number, number];

const HEX_CACHE = new Map<string, RGB>();

export function rgb(hex: string): RGB {
  let c = HEX_CACHE.get(hex);
  if (!c) {
    const h = hex.length === 4 ? hex.slice(1).replace(/./g, (x) => x + x) : hex.slice(1, 7);
    const n = parseInt(h, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    HEX_CACHE.set(hex, c);
  }
  return c;
}

export function pack(c: RGB): number {
  return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

export function unpack(v: number): RGB {
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255];
}

/** k > 0 向白、k < 0 向黑。 */
export function shade(c: RGB, k: number): RGB {
  if (k >= 0) return [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
  const f = 1 + k;
  return [c[0] * f, c[1] * f, c[2] * f];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* ────────────────────────── 写像素 ────────────────────────── */

export function set(s: Surface, x: number, y: number, c: RGB): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  s.data[y * s.w + x] = pack(c);
}

export function setPacked(s: Surface, x: number, y: number, v: number): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  s.data[y * s.w + x] = v;
}

export function get(s: Surface, x: number, y: number): RGB {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return [0, 0, 0];
  return unpack(s.data[y * s.w + x]!);
}

/** 半透明叠加：a = 1 完全覆盖。 */
export function blend(s: Surface, x: number, y: number, c: RGB, a: number): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= s.w || y >= s.h || a <= 0) return;
  const i = y * s.w + x;
  if (a >= 1) {
    s.data[i] = pack(c);
    return;
  }
  const d = s.data[i]!;
  const r = d & 255;
  const g = (d >>> 8) & 255;
  const b = (d >>> 16) & 255;
  s.data[i] = pack([r + (c[0] - r) * a, g + (c[1] - g) * a, b + (c[2] - b) * a]);
}

export function hline(s: Surface, x0: number, x1: number, y: number, c: RGB, a = 1): void {
  const lo = Math.round(Math.min(x0, x1));
  const hi = Math.round(Math.max(x0, x1));
  for (let x = lo; x <= hi; x++) blend(s, x, y, c, a);
}

export function vline(s: Surface, x: number, y0: number, y1: number, c: RGB, a = 1): void {
  const lo = Math.round(Math.min(y0, y1));
  const hi = Math.round(Math.max(y0, y1));
  for (let y = lo; y <= hi; y++) blend(s, x, y, c, a);
}

export function rect(s: Surface, x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  for (let yy = y0; yy < y0 + Math.round(h); yy++) for (let xx = x0; xx < x0 + Math.round(w); xx++) blend(s, xx, yy, c, a);
}

/** Bresenham 像素线。 */
export function line(s: Surface, ax: number, ay: number, bx: number, by: number, c: RGB, a = 1): void {
  let x0 = Math.round(ax);
  let y0 = Math.round(ay);
  const x1 = Math.round(bx);
  const y1 = Math.round(by);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 2000; guard++) {
    blend(s, x0, y0, c, a);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/* ────────────────────────── 抖动 / 噪声 ────────────────────────── */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 4×4 Bayer 阈值 0..1。 */
export function bayer(x: number, y: number): number {
  return (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16;
}

/** 确定性 hash —— 装饰元素的位置只允许是索引的纯函数。 */
export function hash(i: number, salt: number): number {
  let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function frac(v: number): number {
  return v - Math.floor(v);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 四角星闪光。 */
export function sparkle(s: Surface, x: number, y: number, phase: number, c: RGB): void {
  if (phase > 0.62) return;
  const big = phase > 0.18 && phase < 0.42;
  set(s, x, y, c);
  set(s, x - 1, y, c);
  set(s, x + 1, y, c);
  set(s, x, y - 1, c);
  set(s, x, y + 1, c);
  if (big) {
    set(s, x - 2, y, c);
    set(s, x + 2, y, c);
    set(s, x, y - 2, c);
    set(s, x, y + 2, c);
  }
}

/* ────────────────────────── 舞台 → 像素 ────────────────────────── */

export function toPx(v: number): number {
  return Math.round(v / PS - 0.5);
}

export function pxCenter(p: number): number {
  return (p + 0.5) * PS;
}
