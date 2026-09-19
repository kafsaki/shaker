/**
 * 装饰像素 sprite —— 字符串点阵，字符映射到渲染端调色板：
 *   o=描边(深)  b=基色  l=亮色  d=暗色  w=白  s=柄/签（深色）  c=固定樱桃红
 *
 * 维护方式：只在这里增删改，走 GitHub PR；渲染端（animator-web）只做查表，
 * 不认识任何具体装饰。新装饰 = 一段字符画 + 在 garnishSpriteRows 里挂匹配规则。
 */

/** 装饰 sprite 表。key 是内部素材名（不是 garnishId），由 garnishSpriteRows 选择。 */
export const GARNISH_SPRITES: Record<string, readonly string[]> = {
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
  /** 签串樱桃：首行横签（架在杯口），樱桃垂挂签中点下方。 */
  cherry_skewer: ["sssssss", "...s...", ".oooo..", "owbbbo.", "obbbbdo", ".obddo.", "..ooo.."],
  mint: [".l...l.", "ll.b.ll", ".llbl..", "..bb...", "...s...", "...s...", "..sss.."],
  flag: ["c.....w..", ".c...w.s.", "..c.w..s.", "...c...s.", ".......s."],
};

/** 兜底 sprite：查不到匹配规则时用圆片，保证渲染端永远不炸。 */
export const GARNISH_FALLBACK = "wheel";

/**
 * 装饰 sprite 选择：签串樱桃用横签变体，其余按原料/预处理匹配。
 * 输入是结构化字段而不是 animator-core 类型 —— 本包不依赖动画器。
 */
export function garnishSpriteRows(g: {
  garnishId: string;
  prep: string;
  position: string;
}): readonly string[] {
  if (g.garnishId.includes("cherry")) {
    return GARNISH_SPRITES[g.position === "skewer" ? "cherry_skewer" : "cherry"]!;
  }
  if (g.garnishId.includes("mint") || g.prep === "slapped") return GARNISH_SPRITES.mint!;
  if (g.prep === "twist" || g.prep === "expressed") return GARNISH_SPRITES.twist!;
  if (g.prep === "wedge") return GARNISH_SPRITES.wedge!;
  if (g.prep === "flag") return GARNISH_SPRITES.flag!;
  return GARNISH_SPRITES[GARNISH_FALLBACK]!;
}
