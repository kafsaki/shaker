/**
 * 道具像素 sprite —— 字符串点阵，字符映射到渲染端调色板：
 *   m=金属暗  h=金属亮  l=标签  s=弹簧圈
 *
 * 只放「查表即画」的静态道具。吧勺/搅棒/捣棒由渲染端 drawRodProp 程序化绘制
 * （吧勺画圈、搅棒掌心对搓自旋、捣棒上下 —— 运动语义不同，无法用静态 sprite
 * 表达），pour_vessel / float_spoon 是姿态画法 —— 它们属于渲染端代码，
 * 不是素材，不在本表。muddler 词条目已随 swizzle 一并移除（历史上路由到
 * drawRodProp 后从未被读取）。
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
  // 小喷雾瓶：左上喷口（h 亮面）+ 扳机 + 瓶颈 + 带标签的瓶身
  spray: [
    "hhh...",
    "mmmm..",
    "mm....",
    ".mmm..",
    ".mmmm.",
    ".mllm.",
    ".mllm.",
    ".mmmm.",
    ".mmmm.",
  ],
  barspoon_head: ["..mm..", ".mmmm.", "..mm.."],
};
