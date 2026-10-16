/**
 * 工具（吧勺、捣棒、滤网、冰铲……）与杯中固体、装饰 sprite。
 *
 * 工具姿态由核心算好（世界坐标 + 转角），这里只按局部形状逐点画：
 *   杆状工具：原点 = 尖端（插进杯底的那一头），沿局部 −v 方向（向上）伸出杆身；
 *   器皿类工具（滤网、冰铲、喷瓶……）：原点 = 工作点（滤网中心、铲口）。
 */
import type { GarnishView, SolidView, ToolView } from "@shaker/animator-core";
import { garnishSpriteRows } from "@shaker/visual-assets";
import { rampOf } from "./vessel.ts";
import { blend, hash, line, mixRGB, PS, rgb, set, shade, type RGB, type Surface } from "./pixels.ts";
import type { Palette } from "./theme.ts";

/** 工具局部坐标 → 像素格：u 向右、v 向上，原点为工具锚点。 */
function mapper(t: ToolView) {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return (u: number, v: number) => ({
    x: Math.round((t.x + (u * c + v * s) * t.scale) / PS - 0.5),
    y: Math.round((t.y + (u * s - v * c) * t.scale) / PS - 0.5),
  });
}

/** 沿局部轴画一条杆（v 从 v0 到 v1），每像素一点。 */
function rod(s: Surface, at: ReturnType<typeof mapper>, v0: number, v1: number, u: number, c: RGB, tick?: (i: number) => RGB | null): void {
  const n = Math.max(1, Math.ceil(Math.abs(v1 - v0) / (PS * 0.7)));
  for (let i = 0; i <= n; i++) {
    const v = v0 + ((v1 - v0) * i) / n;
    const p = at(u, v);
    set(s, p.x, p.y, c);
    const tc = tick?.(i);
    if (tc) {
      const q = at(u + PS, v);
      set(s, q.x, q.y, tc);
    }
  }
}

function disc(s: Surface, at: ReturnType<typeof mapper>, cu: number, cv: number, rx: number, ry: number, c: RGB): void {
  for (let v = -ry; v <= ry; v += PS * 0.6) {
    for (let u = -rx; u <= rx; u += PS * 0.6) {
      if ((u * u) / (rx * rx) + (v * v) / (ry * ry) > 1) continue;
      const p = at(cu + u, cv + v);
      set(s, p.x, p.y, c);
    }
  }
}

export function drawTool(s: Surface, t: ToolView, pal: Palette, tMs: number): void {
  const at = mapper(t);
  switch (t.kind) {
    case "barspoon": {
      // 吧勺：螺旋杆 + 小勺头 + 柄尾圆片
      const L = t.size;
      rod(s, at, 6, L, 0, pal.metalHi, (i) => ((i + Math.floor(tMs / 90)) % 5 === 0 ? pal.metalLo : null));
      disc(s, at, 0, 3, 5, 3, pal.metalLo);
      disc(s, at, -1, 4, 2.4, 1.4, pal.metalHi);
      disc(s, at, 0, L + 2, 6, 3, pal.metalHi);
      break;
    }
    case "float_spoon": {
      // 浮注吧勺：勺背朝上的勺碗贴着液面，杆斜着伸出杯口
      const L = t.size;
      rod(s, at, 4, L, 0, pal.metalHi, (i) => (i % 3 === 1 ? pal.metalLo : null));
      for (let u = -10; u <= 10; u += PS * 0.6) {
        const k = 1 - (u / 10) ** 2;
        const p = at(u, 2 + k * 3);
        set(s, p.x, p.y, pal.metalHi);
        const q = at(u, k * 3);
        set(s, q.x, q.y, pal.metalLo);
      }
      disc(s, at, 0, L + 2, 6, 3, pal.metalHi);
      break;
    }
    case "swizzle": {
      // 搅棒：细杆 + 底端星形枝杈，自旋时枝杈两组朝向轮换
      const L = t.size;
      rod(s, at, 0, L, 0, rgb("#c8a070"), (i) => ((i + Math.floor(tMs / 36)) % 3 === 0 ? rgb("#8a6440") : null));
      const spin = t.phase < 0.5;
      const prongs = spin ? [[-8, 6], [8, 6], [-4, 12], [4, 12]] : [[-10, 9], [10, 9], [0, 14], [0, 3]];
      for (const [u, v] of prongs) {
        const a = at(0, 0);
        const b = at(u!, v!);
        line(s, a.x, a.y, b.x, b.y, rgb("#8a6440"));
      }
      break;
    }
    case "muddler": {
      // 捣棒：粗木杆 + 宽捣头（2 像素宽）
      const L = t.size;
      const wood = rgb("#b98a56");
      const woodLo = rgb("#6e4a2a");
      for (let u = -PS; u <= PS; u += PS) rod(s, at, 10, L, u, u > 0 ? woodLo : wood);
      for (let u = -10; u <= 10; u += PS * 0.6) for (let v = 0; v <= 10; v += PS * 0.6) {
        const p = at(u, v);
        set(s, p.x, p.y, v < 3 ? woodLo : u < -4 ? shade(wood, 0.2) : wood);
      }
      break;
    }
    case "hawthorne":
    case "julep": {
      // 滤网：卡在器具口上（原点 = 口沿中心），盘面 + 弹簧圈 + 把手
      const R = t.size / 2;
      const julep = t.kind === "julep";
      for (let u = -R; u <= R; u += PS * 0.6) {
        const p = at(u, 0);
        set(s, p.x, p.y, pal.metalHi);
        const q = at(u, -PS);
        if (!julep && Math.round(u / PS) % 2 === 0) set(s, q.x, q.y, pal.metalLo);
        if (julep) {
          const k = 1 - (u / R) ** 2;
          const r2 = at(u, -k * 8);
          set(s, r2.x, r2.y, pal.metalLo);
        }
      }
      // 把手伸向器具外侧
      const a = at(R, 0);
      const b = at(R + 26, 6);
      line(s, a.x, a.y, b.x, b.y, pal.metalLo);
      break;
    }
    case "fine_strainer": {
      // 细滤网：锥形网兜 + 长柄
      const R = t.size / 2;
      for (let v = 0; v >= -16; v -= PS * 0.6) {
        const w = R * (1 + v / 18);
        for (let u = -w; u <= w; u += PS * 0.6) {
          const p = at(u, v);
          const edge = Math.abs(u) > w - PS;
          set(s, p.x, p.y, edge ? pal.metalHi : hash(p.x * 3 + p.y, 9) < 0.5 ? pal.metalLo : mixRGB(pal.metalLo, pal.metalHi, 0.4));
        }
      }
      const a = at(R, 0);
      const b = at(R + 46, 10);
      line(s, a.x, a.y, b.x, b.y, pal.metalHi);
      break;
    }
    case "scoop": {
      // 冰铲：铲斗 + 把手（rot 负时铲口朝下倾倒）
      for (let u = -22; u <= 16; u += PS * 0.6) {
        const h = u < -12 ? 10 : 14;
        for (let v = -h / 2; v <= h / 2; v += PS * 0.6) {
          const p = at(u, v);
          const edge = Math.abs(v) > h / 2 - PS || u < -21;
          set(s, p.x, p.y, edge ? pal.metalHi : pal.metalLo);
        }
      }
      for (let u = 16; u <= 40; u += PS * 0.6) {
        const p = at(u, 0);
        set(s, p.x, p.y, rgb("#2a2a33"));
      }
      break;
    }
    case "spray": {
      const body = rgb("#e8dcc0");
      for (let v = -30; v <= 0; v += PS * 0.6) for (let u = -6; u <= 6; u += PS * 0.6) {
        const p = at(u, v);
        set(s, p.x, p.y, u < -3 ? shade(body, 0.2) : body);
      }
      disc(s, at, 0, 4, 4, 3, pal.metalLo);
      disc(s, at, -6, 6, 3, 2, pal.metalHi);
      break;
    }
    case "lighter": {
      const body = rgb("#c8423a");
      for (let v = -26; v <= 0; v += PS * 0.6) for (let u = -5; u <= 5; u += PS * 0.6) {
        const p = at(u, v);
        set(s, p.x, p.y, u < -2 ? shade(body, 0.25) : body);
      }
      disc(s, at, 0, 3, 5, 2, pal.metalHi);
      // 小火苗
      const f = at(0, 8 + Math.sin(tMs * 0.03) * 1.5);
      set(s, f.x, f.y, rgb("#ffc94d"));
      set(s, f.x, f.y - 1, rgb("#fff6d8"));
      break;
    }
    case "peel": {
      const col = t.color ? rgb(t.color) : rgb("#e8912a");
      for (let u = -12; u <= 12; u += PS * 0.6) {
        const k = 1 - (u / 12) ** 2;
        for (let v = 0; v <= 2 + k * 4; v += PS * 0.6) {
          const p = at(u, v);
          set(s, p.x, p.y, v < 1.5 ? shade(col, -0.25) : col);
        }
      }
      break;
    }
    case "smoke_gun": {
      const body = rgb("#2a2a33");
      for (let u = -16; u <= 16; u += PS * 0.6) for (let v = -6; v <= 6; v += PS * 0.6) {
        const p = at(u, v);
        set(s, p.x, p.y, v < -3 ? shade(body, 0.3) : body);
      }
      for (let u = -40; u <= -16; u += PS * 0.6) {
        const p = at(u, 2);
        set(s, p.x, p.y, pal.metalLo);
      }
      break;
    }
    case "cloche": {
      // 玻璃罩：原点 = 底边中心，半透明半球
      const R = t.size / 2;
      for (let v = 0; v <= R * 1.2; v += PS * 0.6) {
        const w = R * Math.sqrt(Math.max(0, 1 - (v / (R * 1.2)) ** 2));
        for (const sg of [-1, 1]) {
          const p = at(sg * w, v);
          set(s, p.x, p.y, pal.glassStroke);
        }
      }
      for (let u = -R; u <= R; u += PS * 0.6) {
        const p = at(u, 0);
        set(s, p.x, p.y, pal.glassStroke);
      }
      disc(s, at, 0, R * 1.2 + 3, 4, 3, pal.metalHi);
      break;
    }
    case "rim_plate": {
      // 盐碟：浅碟 + 碟里的盐/糖
      const R = t.size / 2;
      const salt = t.color ? rgb(t.color) : pal.hi;
      for (let u = -R; u <= R; u += PS * 0.6) {
        const p = at(u, 0);
        set(s, p.x, p.y, pal.glassStroke);
        if (Math.abs(u) < R - PS) {
          const q = at(u, PS);
          set(s, q.x, q.y, hash(q.x, 3) < 0.5 ? salt : shade(salt, -0.15));
        }
      }
      for (const sg of [-1, 1]) {
        const p = at(sg * R, PS * 1.5);
        set(s, p.x, p.y, pal.glassStroke);
      }
      break;
    }
    case "blender_base": {
      // 搅拌机底座：原点 = 底边中心
      const body = rgb("#3a3a46");
      for (let v = 0; v <= 44; v += PS * 0.6) {
        const w = 34 - v * 0.12;
        for (let u = -w; u <= w; u += PS * 0.6) {
          const p = at(u, v);
          set(s, p.x, p.y, u < -w + PS * 1.5 ? shade(body, 0.3) : v > 40 ? shade(body, 0.2) : body);
        }
      }
      // 指示灯
      const led = at(18, 18);
      set(s, led.x, led.y, rgb("#5ad07a"));
      break;
    }
  }
}

/* ────────────────────────── 装饰 / 固体 ────────────────────────── */

export function drawGarnish(s: Surface, g: GarnishView, pal: Palette): void {
  if (g.opacity < 0.05) return;
  const rows = garnishSpriteRows(g);
  const rp = rampOf(g.color);
  const palOf = (ch: string): RGB | null => {
    switch (ch) {
      case "o":
        return rp.dark;
      case "b":
        return rp.base;
      case "l":
        return rp.light;
      case "d":
        return shade(rgb(g.color), -0.45);
      case "w":
        return pal.hi;
      case "s":
        return pal.woodLo;
      case "c":
        return rampOf("#8c1024").base;
      default:
        return null;
    }
  };
  const w = rows[0]!.length;
  const h = rows.length;
  const cx = g.x / PS;
  const cy = g.y / PS;
  // 锚点：side 底边立台面；其余（含串签）中心对齐 —— 串签装饰骑在签线上
  const oy = g.position === "side" ? -h : -h / 2;
  // 金属串签：metalLo 杆身 + 上侧 metalHi 高光，外露端（端点 2）一颗圆珠 —— 不锈钢酒签
  if (g.stick) {
    const sa = Math.min(1, g.opacity);
    const x1 = Math.round(g.stick.x1 / PS);
    const y1 = Math.round(g.stick.y1 / PS);
    const x2 = Math.round(g.stick.x2 / PS);
    const y2 = Math.round(g.stick.y2 / PS);
    line(s, x1, y1, x2, y2, pal.metalLo, sa);
    line(s, x1, y1 - 1, x2, y2 - 1, pal.metalHi, sa * 0.9);
    blend(s, x2, y2 - 2, pal.metalHi, sa);
    blend(s, x2 - 1, y2 - 1, pal.metalLo, sa);
    blend(s, x2 + 1, y2 - 1, pal.metalHi, sa);
  }
  const c = Math.cos(g.rot);
  const sn = Math.sin(g.rot);
  for (let r = 0; r < h; r++) {
    for (let i = 0; i < w; i++) {
      const col = palOf(rows[r]![i]!);
      if (!col) continue;
      const lx = i - w / 2;
      const ly = r + oy;
      const x = Math.round(cx + lx * c - ly * sn);
      const y = Math.round(cy + lx * sn + ly * c);
      blend(s, x, y, col, Math.min(1, g.opacity));
    }
  }
}

const SOLID_SPRITES: Record<SolidView["sprite"], readonly string[]> = {
  leaf: [".bb.", "blbb", ".bb.", "..s."],
  wedge: ["..o", ".bo", "bbo", "ooo"],
  wheel: [".ooo.", "oblbo", "olllo", "oblbo", ".ooo."],
  berry: [".o.", "obo", ".o."],
  cube: ["oo", "oo"],
};

export function drawSolid(s: Surface, p: SolidView, pal: Palette, alpha = 1): void {
  const rows = SOLID_SPRITES[p.sprite];
  const base = rgb(p.color);
  const col = p.bruised > 0 ? mixRGB(base, shade(base, -0.4), p.bruised * 0.6) : base;
  const rp = { o: shade(col, -0.3), b: col, l: shade(col, 0.3), s: pal.woodLo };
  const cx = p.x / PS;
  const cy = p.y / PS;
  const c = Math.cos(p.rot);
  const sn = Math.sin(p.rot);
  const w = rows[0]!.length;
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < w; i++) {
      const ch = rows[r]![i]! as keyof typeof rp;
      const cc = rp[ch];
      if (!cc) continue;
      const lx = i - w / 2;
      const ly = r - rows.length;
      const x = Math.round(cx + lx * c - ly * sn);
      const y = Math.round(cy + lx * sn + ly * c);
      // 金属器具剖视时压暗（alpha < 1）
      if (alpha >= 1) set(s, x, y, cc);
      else blend(s, x, y, cc, alpha);
    }
  }
}
