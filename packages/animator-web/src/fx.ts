/**
 * 液柱、水花、粒子特效（ADR-031）。
 *
 * 液柱的轨迹由核心按抛体运动算好（StreamView.points，自上而下），这里只沿中心线
 * 逐段铺像素：宽度跟着点走（越往下越细），条纹随时间下行表现流动。
 */
import { particlesAt, type Effect, type StreamView } from "@shaker/animator-core";
import { blend, frac, hash, hline, PS, rgb, set, type Surface } from "./pixels.ts";
import { rampOf } from "./vessel.ts";
import type { Palette } from "./theme.ts";

export function drawStream(s: Surface, st: StreamView, pal: Palette, tMs: number): void {
  const rp = rampOf(st.color);
  const pts = st.points;
  if (st.mode === "drops") {
    for (const p of pts) {
      const x = Math.round(p.x / PS - 0.5);
      const y = Math.round(p.y / PS - 0.5);
      set(s, x, y, rp.light);
      set(s, x, y - 1, rp.base);
    }
  } else {
    // 沿中心线插值成逐像素行
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const rows = Math.max(1, Math.ceil(Math.abs(b.y - a.y) / PS));
      const cols = Math.max(1, Math.ceil(Math.abs(b.x - a.x) / PS));
      const n = Math.max(rows, cols);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const w = a.w + (b.w - a.w) * t;
        const py = Math.round(y / PS - 0.5);
        const half = Math.max(0, Math.round(w / PS / 2 - 0.25));
        const cx = Math.round(x / PS - 0.5);
        const stripe = (py + Math.floor(tMs / 60)) % 4 === 0;
        const col = st.mode === "gentle" ? rp.light : stripe ? rp.light : rp.base;
        hline(s, cx - half, cx + half, py, col);
        // 受光边
        if (half >= 1) set(s, cx - half, py, rp.hi);
      }
    }
  }
  if (st.impact) {
    // 落点：水花环 + 跳起的小液滴
    const ix = Math.round(st.impact.x / PS - 0.5);
    const iy = Math.round(st.impact.y / PS - 0.5);
    const ph = frac(tMs / 380);
    const rw = 1 + Math.round(ph * 2 + st.impact.strength);
    hline(s, ix - rw, ix + rw, iy, ph > 0.6 ? rp.dark : rp.hi);
    const n = st.mode === "gentle" ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const p2 = frac(tMs / 330 + i * 0.33);
      const sx = ix + Math.round((hash(i, 7) * 2 - 1) * 3);
      const sy = iy - Math.round(Math.sin(p2 * Math.PI) * (1.5 + hash(i, 13) * 2.5 * st.impact.strength));
      set(s, sx, sy, pal.hi);
    }
  }
}

export function drawEffect(s: Surface, e: Effect, pal: Palette, tMs: number): void {
  if (e.kind === "splash") return drawSplash(s, e, tMs);
  if (e.kind === "flame" && tMs <= e.endMs) drawFlame(s, e, tMs);
  const col = rgb(e.color);
  for (const p of particlesAt(e, tMs)) {
    const x = Math.round(p.x / PS - 0.5);
    const y = Math.round(p.y / PS - 0.5);
    switch (e.kind) {
      case "flame":
        if (p.opacity > 0.12) set(s, x, y, p.opacity > 0.6 ? rgb("#fff3c4") : p.opacity > 0.35 ? col : rgb("#ff5a1e"));
        break;
      case "sparks":
        set(s, x, y, rgb("#fff3c4"));
        if (p.size > 2.6) set(s, x + 1, y, col);
        break;
      case "chill":
        blend(s, x, y, col, p.opacity);
        break;
      default:
        // smoke / mist：抖动淡出的像素团
        if (hash(x * 3 + y * 7, Math.floor(tMs / 120)) < p.opacity) {
          blend(s, x, y, col, 0.85);
          if (p.size > 6) blend(s, x + 1, y, col, 0.6);
          if (p.size > 10) blend(s, x, y + 1, col, 0.5);
        }
    }
  }
  void pal;
}

/** 火焰：液面上的泪滴形火舌，双频呼吸（确定性，可 seek）。 */
function drawFlame(s: Surface, e: Effect, tMs: number): void {
  const cx = Math.round((e.region.x + e.region.w / 2) / PS);
  const baseY = Math.round((e.region.y + e.region.h) / PS);
  const maxH = Math.max(4, Math.round((e.region.h * 2.4) / PS));
  const halfW = Math.max(2, Math.round(e.region.w / PS / 2));
  const breathe = Math.sin(tMs * 0.018) * 0.6 + Math.sin(tMs * 0.033 + 1.7) * 0.4;
  const hPx = Math.max(3, Math.round(maxH * (0.78 + 0.22 * breathe)));
  const sway = Math.sin(tMs * 0.011 + 0.6);
  const core = rgb("#fff6d8");
  const mid = rgb("#ffc94d");
  const tip = rgb("#ff5a1e");
  const outer = rgb(e.color);
  for (let i = 0; i < hPx; i++) {
    const t = i / hPx;
    const y = baseY - i;
    const w = Math.max(0, Math.round(halfW * Math.sin(Math.min(1, t * 1.25) * Math.PI) * (1 - t * 0.3)));
    const rowCx = cx + Math.round(sway * t * 2);
    for (let dx = -w; dx <= w; dx++) {
      const edge = Math.abs(dx) / Math.max(1, w);
      // 液面上的火是一层，中间还有几簇火苗跳高
      const tongue = hash(dx + 40, Math.floor(tMs / 90)) < 0.35 || Math.abs(dx) < 2;
      if (t > 0.5 && !tongue) continue;
      set(s, rowCx + dx, y, edge < 0.4 && t < 0.55 ? core : edge < 0.75 && t < 0.8 ? mid : t > 0.85 ? tip : outer);
    }
  }
}

/** 水花：冰块砸进液面溅起的液滴，抛物线，(seed, i) 确定。 */
function drawSplash(s: Surface, e: Effect, tMs: number): void {
  if (tMs < e.startMs || tMs > e.endMs + 500) return;
  const col = rgb(e.color);
  const span = e.endMs - e.startMs;
  const n = Math.round(e.rate);
  for (let i = 0; i < n; i++) {
    const delay = hash(i * 3 + 1, e.seed & 0xffff) * span;
    const age = tMs - e.startMs - delay;
    if (age < 0 || age > 420) continue;
    const ts = age / 1000;
    const vy0 = -(60 + hash(i * 3 + 2, e.seed & 0xffff) * 50);
    const vx = (hash(i * 3 + 3, e.seed & 0xffff) * 2 - 1) * 40;
    const x0 = e.region.x + hash(i * 5 + 7, e.seed & 0xffff) * e.region.w;
    const x = x0 + vx * ts;
    const y = e.region.y + vy0 * ts + 420 * ts * ts;
    if (y > e.region.y + e.region.h) continue;
    set(s, Math.round(x / PS - 0.5), Math.round(y / PS - 0.5), col);
  }
}
