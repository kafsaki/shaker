/**
 * 游戏化展示层的映射（纯装饰，不改变任何数据语义）：
 * 稀有度 ← 配方来源，称号/等级 ← 公开计数，品类图标 ← 原料品类。
 */
import type { PixelIconName } from "@/lib/pixel-icons";

export type Rarity = "legend" | "rare" | "uncommon" | "common";

export interface RarityMeta {
  key: Rarity;
  label: string;
  tag: string;
  tone: "gold" | "cyan" | "green" | "plain";
  icon: PixelIconName;
}

const RARITY: Record<Rarity, RarityMeta> = {
  legend: { key: "legend", label: "权威", tag: "LEGEND", tone: "gold", icon: "crown" },
  rare: { key: "rare", label: "原创", tag: "RARE", tone: "cyan", icon: "sparkle" },
  uncommon: { key: "uncommon", label: "变体", tag: "VARIANT", tone: "green", icon: "branch" },
  common: { key: "common", label: "配方", tag: "COMMON", tone: "plain", icon: "martini" },
};

/** 权威经典 = 传说；原创 = 稀有；关联了经典或改编自别人的 = 变体。 */
export function rarityOf(r: {
  isCanonical?: boolean;
  source?: string | null;
  classicKey?: string | null;
}): RarityMeta {
  if (r.isCanonical) return RARITY.legend;
  if (r.source === "variant" || r.classicKey) return RARITY.uncommon;
  if (r.source === "original") return RARITY.rare;
  return RARITY.common;
}

/** 调酒师称号（按已发布配方数）。 */
export function rankOf(recipeCount: number): string {
  if (recipeCount >= 30) return "酒馆传奇";
  if (recipeCount >= 10) return "首席调酒师";
  if (recipeCount >= 3) return "资深调酒师";
  if (recipeCount >= 1) return "调酒师";
  return "见习酒保";
}

/** 等级：1 + 配方数 + 粉丝数/5（装饰性，资料页有说明）。 */
export function levelOf(counts: { recipe: number; follower: number }): number {
  return 1 + counts.recipe + Math.floor(counts.follower / 5);
}

/** 原料 14 品类 → 图标。 */
export const CATEGORY_ICON: Record<string, PixelIconName> = {
  spirit: "bottle",
  liqueur: "bottle",
  amaro_bitter: "dropper",
  fortified_wine: "wine",
  wine_beer: "beer",
  juice: "citrus",
  syrup_sweetener: "drop",
  mixer: "can",
  dairy_egg: "egg",
  coffee_tea: "cup",
  spice_herb: "leaf",
  garnish: "cherry",
  ice: "cube",
  other: "question",
};

/** 配方编号显示：经典图鉴用 No.001，UGC 用短号。 */
export function dexNo(n: number): string {
  return `No.${String(n).padStart(3, "0")}`;
}

/** 紧凑计数：1234 → 1.2K。 */
export function compact(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
