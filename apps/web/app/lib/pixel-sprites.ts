/**
 * UI 立绘与装饰 sprite（字符点阵 + 调色板，由 PxSprite 渲染）。
 * 调色板按主题给两套；字符含义见各 sprite 注释。
 */

/** 酒保立绘 16×16：k 描边 h 头发 H 发光 s 皮肤 e 眼 p 腮红 m 嘴 w 衬衫 b 领结 v 马甲 */
export const BARTENDER = [
  "....kkkkkkkk....",
  "...khhhhhhHhk...",
  "..khhhhhhhhHhk..",
  "..khhhhhhhhhhk..",
  "..khhsssssshhk..",
  "..khsesssseshk..",
  "..khpssssssphk..",
  "..khsssmmssshk..",
  "...kssssssssk...",
  "....kksssskk....",
  "..kkwwwbbwwwkk..",
  ".kvvwwbbbbwwvvk.",
  ".kvvvwwbbwwvvvk.",
  "kvvvvwwwwwwvvvvk",
  "kvvvvvwwwwvvvvvk",
  "kvvvvvwwwwvvvvvk",
] as const;

export const BARTENDER_PALETTE = {
  dark: {
    k: "#06030b",
    h: "#5b3b8c",
    H: "#8f6ad0",
    s: "#f6c9a6",
    e: "#1a1028",
    p: "#f08aa0",
    m: "#b84a5a",
    w: "#f4ead5",
    b: "#ff5c8a",
    v: "#2b2140",
  },
  light: {
    k: "#3a2a1e",
    h: "#6e3f22",
    H: "#a8673a",
    s: "#f6c9a6",
    e: "#2e2218",
    p: "#f08aa0",
    m: "#b84a5a",
    w: "#fffaf0",
    b: "#d63e6c",
    v: "#4a3428",
  },
} as const;

/** 招牌摇酒壶 12×16：k 描边 m 金属 h 高光 a 琥珀液 */
export const LOGO_SHAKER = [
  "....kkkk....",
  "....khmk....",
  "...kkkkkk...",
  "...khmmmk...",
  "..kkkkkkkk..",
  "..khmmmmmk..",
  ".kkkkkkkkkk.",
  ".khmmmmmmmk.",
  ".khmaaaammk.",
  ".khmaaaammk.",
  ".khmaaaammk.",
  ".khmmmmmmmk.",
  ".khmmmmmmmk.",
  "..khmmmmmk..",
  "..kkkkkkkk..",
  "............",
] as const;

/** 酒架瓶子（8 宽）：k 描边 g 酒液 h 高光 c 瓶盖 l 标签 */
export const BOTTLES = {
  tall: [
    "...kk...",
    "...cc...",
    "...kk...",
    "...kk...",
    "..kggk..",
    ".kggggk.",
    "kghggggk",
    "kghggggk",
    "kgllllgk",
    "kgllllgk",
    "kgllllgk",
    "kghggggk",
    "kghggggk",
    "kggggggk",
    "kggggggk",
    ".kkkkkk.",
  ],
  squat: [
    "...cc...",
    "...kk...",
    "..kggk..",
    ".kggggk.",
    "kghggggk",
    "kghllggk",
    "kghllggk",
    "kghggggk",
    "kggggggk",
    "kggggggk",
    ".kggggk.",
    "..kkkk..",
  ],
  flask: [
    "...cc...",
    "..kkkk..",
    "..kggk..",
    "kkkggkkk",
    "kghggggk",
    "kghggggk",
    "kgllllgk",
    "kgllllgk",
    "kgllllgk",
    "kghggggk",
    "kghggggk",
    "kggggggk",
    "kggggggk",
    "kkkkkkkk",
  ],
} as const;

/** 酒液色（g / h 两档）—— 琥珀威士忌、祖母绿、宝石红、青柠、紫罗兰、清澈金酒。 */
export const LIQUORS = [
  { g: "#c8781e", h: "#ffc46a" },
  { g: "#2f8a4a", h: "#7ee06a" },
  { g: "#a3243c", h: "#ff5c8a" },
  { g: "#7fb83a", h: "#d4f07a" },
  { g: "#6a3fa0", h: "#b48af0" },
  { g: "#9db4d0", h: "#eef6ff" },
  { g: "#d9a31a", h: "#ffe08a" },
] as const;

export const LOGO_PALETTE = {
  dark: { k: "#06030b", m: "#9db4d0", h: "#e8f0fa", a: "#ffb547" },
  light: { k: "#3a2a1e", m: "#7c8690", h: "#e8eef4", a: "#e08a2c" },
} as const;
