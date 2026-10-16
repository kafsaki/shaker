/**
 * 冰块（ADR-031）：近透明的冰体 + 受光边 + 内部气泡，按堆积出来的位置与倾角画。
 *
 * 前后两排：后排暗一些、被前排挡住 —— 侧视图里冰堆的体积感从这里来。
 * 碎冰、裂冰的轮廓不规则（按 seed 每块不同），方冰带圆角，球冰是圆。
 */
import type { IceView } from "@shaker/animator-core";
import { blend, clamp01, get, hash, mixRGB, PS, pxCenter, rgb, set, type RGB, type Surface } from "./pixels.ts";
import type { Palette } from "./theme.ts";

const ICE_BODY = rgb("#dceef8");
const ICE_EDGE = rgb("#9cc0d8");

export function drawIce(s: Surface, ice: readonly IceView[], pal: Palette, dimK = 1): void {
  for (const p of ice) drawPiece(s, p, pal, dimK);
}

function drawPiece(s: Surface, p: IceView, pal: Palette, dimK: number): void {
  const hw = p.w / 2;
  const hh = p.h / 2;
  const reach = Math.hypot(hw, hh) + PS;
  const x0 = Math.max(0, Math.floor((p.x - reach) / PS));
  const x1 = Math.min(s.w - 1, Math.ceil((p.x + reach) / PS));
  const y0 = Math.max(0, Math.floor((p.y - reach) / PS));
  const y1 = Math.min(s.h - 1, Math.ceil((p.y + reach) / PS));
  const c = Math.cos(p.rot);
  const sn = Math.sin(p.rot);
  const back = p.depth === 0;
  const tiny = p.w < PS * 5;
  // 冰体透明度：浸在液体里几乎看不见（冰与酒的折射率接近，只看得见边），露在空气里白一些
  // dimK：金属器具剖视时整体压暗（< 1），与罩过壳色的液体亮度一致
  const bodyA = (p.submerged ? 0.07 : 0.3) * (back ? 0.6 : 1) * dimK;
  // 边：碎冰颗粒小，边占了大半，压低一些，否则一杯碎冰像一杯雪
  const edgeA = (p.submerged ? 0.42 : 0.72) * (tiny ? 0.6 : 1) * (back ? 0.65 : 1) * dimK;
  const edgeHi: RGB = back ? mixRGB(pal.frost, ICE_EDGE, 0.5) : pal.frost;
  const edgeLo: RGB = back ? shadeDown(ICE_EDGE) : ICE_EDGE;
  const irregular = p.kind === "crushed" || p.kind === "cracked" || p.kind === "dry_ice";
  const round = p.kind === "sphere";

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = pxCenter(px) - p.x;
      const dy = pxCenter(py) - p.y;
      // 旋转到冰块局部
      const lx = dx * c + dy * sn;
      const ly = -dx * sn + dy * c;
      let inside: boolean;
      let edge: number; // 到边的距离（像素）
      if (round) {
        const r = Math.hypot(lx, ly);
        inside = r <= hw;
        edge = (hw - r) / PS;
      } else {
        // 不规则冰：按角度扰动边界（每块 seed 不同）
        let k = 1;
        if (irregular) {
          const ang = Math.atan2(ly, lx);
          const n = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 7);
          k = 0.72 + hash(n, p.seed & 0xffff) * 0.34;
        }
        // 方冰圆角：超椭圆
        const ex = Math.abs(lx) / (hw * k);
        const ey = Math.abs(ly) / (hh * k);
        const m = Math.pow(Math.pow(ex, 5) + Math.pow(ey, 5), 1 / 5);
        inside = m <= 1;
        edge = (1 - m) * Math.min(hw, hh) * k / PS;
      }
      if (!inside) continue;
      const under = get(s, px, py);
      if (edge < 1) {
        // 受光边：左上亮、右下暗；碎冰只画受光的半边（另半边融进液体）
        const lit = lx * 0.7 + ly * 0.7 < 0;
        if (tiny && !lit && hash(px + py * 7, p.seed & 0xff) < 0.5) {
          blend(s, px, py, ICE_BODY, bodyA);
          continue;
        }
        set(s, px, py, mixRGB(under, lit ? edgeHi : edgeLo, edgeA));
      } else {
        blend(s, px, py, ICE_BODY, bodyA);
      }
    }
  }
  // 内部：囚禁气泡与一道高光（小冰块不画）
  if (p.w > PS * 3 && !irregular) {
    const hx = Math.round((p.x - hw * 0.35) / PS);
    const hy = Math.round((p.y - hh * 0.3) / PS);
    set(s, hx, hy, pal.hi);
    if (p.w > PS * 5) set(s, hx + 1, hy, mixRGB(get(s, hx + 1, hy), pal.hi, 0.6));
    const bx = Math.round((p.x + hw * 0.25 * (hash(p.seed, 1) - 0.5) * 2) / PS);
    const by = Math.round((p.y + hh * 0.3) / PS);
    blend(s, bx, by, pal.frost, 0.7);
  }
  if (p.kind === "cracked" && p.w > PS * 2.5) {
    // 裂纹
    const cx = Math.round(p.x / PS);
    const cy = Math.round(p.y / PS);
    blend(s, cx, cy, ICE_EDGE, 0.8);
    blend(s, cx + 1, cy + 1, ICE_EDGE, 0.6);
  }
  if (p.kind === "dry_ice") {
    const cx = Math.round(p.x / PS);
    const cy = Math.round(p.y / PS);
    set(s, cx, cy, pal.hi);
  }
  void clamp01;
}

function shadeDown(c: RGB): RGB {
  return [c[0] * 0.78, c[1] * 0.8, c[2] * 0.85];
}
