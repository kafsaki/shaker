/**
 * 道具像素 sprite —— 字符串点阵，字符映射到渲染端调色板：
 *   m=金属暗  h=金属亮  l=标签  s=弹簧圈
 *
 * 只放「查表即画」的静态道具。吧勺/搅棒/捣棒是程序化绘制（stirring 画圆、
 * fxMs 动画），pour_vessel / float_spoon 是姿态画法 —— 它们属于渲染端代码，
 * 不是素材，不在本表。
 */
export const PROP_SPRITES: Record<string, readonly string[]> = {
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
