/**
 * 主题：两套色板（夜班 = 暗调吧台，日班 = 羊皮纸酒馆）。界面主题 token 也取自这里（ADR-026）。
 */
import { rgb, type RGB } from "./pixels.ts";

export interface RenderTheme {
  background: string;
  backgroundLow: string;
  glassStroke: string;
  glassFill: string;
  propStroke: string;
  frost: string;
  counterTop: string;
  counterBottom: string;
  counterEdge: string;
  glow: string;
  metalHi: string;
  metalLo: string;
  woodHi: string;
  woodLo: string;
  hi: string;
  /** 酒架隔板与后墙。 */
  shelf: string;
  shelfEdge: string;
  wall: string;
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
  shelf: "#3a2630",
  shelfEdge: "#8a5a4a",
  wall: "#1d1629",
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
  shelf: "#b8916a",
  shelfEdge: "#7a5434",
  wall: "#e8dcc6",
};

/** 预解析成 RGB 的色板（渲染热路径不再解析 hex）。 */
export type Palette = { [K in keyof RenderTheme]: RGB };

const CACHE = new WeakMap<RenderTheme, Palette>();

export function palette(t: RenderTheme): Palette {
  let p = CACHE.get(t);
  if (!p) {
    p = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, rgb(v)])) as Palette;
    CACHE.set(t, p);
  }
  return p;
}
