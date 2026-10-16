/**
 * 酒瓶剖面 —— 舞台后墙酒架上的瓶子（ADR-031）。道具向素材，不进 glassware 词表。
 *
 * 瓶子不按真实尺寸（30cm 的酒瓶会把舞台挤满），按「一眼认得出是什么瓶」画：
 * 高瓶肩的烈酒瓶、圆肚利口酒瓶、带滴头的苦精小瓶、细长汽水瓶、果汁玻璃壶、矮胖糖浆瓶。
 * 选哪种由原料的视觉字段推断（animator-core 的 bottleShapeFor），不需要新的词表字段。
 *
 * `capacityMl` 只用于倒注时求瓶内液面，不代表真实容量。
 */
import type { VesselDef } from "@shaker/recipe-ir/core";

export const BOTTLE_VESSEL_DEFS: readonly VesselDef[] = [
  {
    id: "__bottle_spirit",
    nameZh: "烈酒瓶",
    nameEn: "Spirit Bottle",
    capacityMl: 700,
    shape: {
      profile: [
        { y: 0, r: 0.2, corner: true },
        { y: 0.56, r: 0.2 },
        { y: 0.66, r: 0.15 },
        { y: 0.72, r: 0.065 },
        { y: 1, r: 0.06, corner: true },
      ],
    },
  },
  {
    id: "__bottle_liqueur",
    nameZh: "利口酒瓶",
    nameEn: "Liqueur Bottle",
    capacityMl: 700,
    shape: {
      profile: [
        { y: 0, r: 0.2 },
        { y: 0.22, r: 0.27 },
        { y: 0.46, r: 0.25 },
        { y: 0.64, r: 0.1 },
        { y: 1, r: 0.07, corner: true },
      ],
    },
  },
  {
    id: "__bottle_bitters",
    nameZh: "苦精瓶",
    nameEn: "Bitters Bottle",
    capacityMl: 200,
    shape: {
      profile: [
        { y: 0, r: 0.25, corner: true },
        { y: 0.58, r: 0.25 },
        { y: 0.7, r: 0.12 },
        { y: 1, r: 0.09, corner: true },
      ],
    },
  },
  {
    id: "__bottle_soda",
    nameZh: "汽水瓶",
    nameEn: "Soda Bottle",
    capacityMl: 500,
    shape: {
      profile: [
        { y: 0, r: 0.15 },
        { y: 0.48, r: 0.15 },
        { y: 0.74, r: 0.09 },
        { y: 1, r: 0.06, corner: true },
      ],
    },
  },
  {
    id: "__bottle_carafe",
    nameZh: "玻璃壶",
    nameEn: "Carafe",
    capacityMl: 600,
    shape: {
      profile: [
        { y: 0, r: 0.3 },
        { y: 0.35, r: 0.32 },
        { y: 0.72, r: 0.2 },
        { y: 1, r: 0.22 },
      ],
    },
  },
  {
    id: "__bottle_syrup",
    nameZh: "糖浆瓶",
    nameEn: "Syrup Bottle",
    capacityMl: 500,
    shape: {
      profile: [
        { y: 0, r: 0.28, corner: true },
        { y: 0.6, r: 0.28 },
        { y: 0.72, r: 0.12 },
        { y: 1, r: 0.1, corner: true },
      ],
    },
  },
];

/** 瓶子在舞台上的绝对高度（舞台单位）—— 瓶子按造型画，不按容量反推尺寸。 */
export const BOTTLE_HEIGHTS: Record<string, number> = {
  __bottle_spirit: 200,
  __bottle_liqueur: 170,
  __bottle_bitters: 92,
  __bottle_soda: 184,
  __bottle_carafe: 150,
  __bottle_syrup: 150,
};

/** 瓶颈起点（归一化高度）：渲染器从这里往上画瓶颈与瓶盖、往下画标签。 */
export const BOTTLE_NECK_AT: Record<string, number> = {
  __bottle_spirit: 0.66,
  __bottle_liqueur: 0.64,
  __bottle_bitters: 0.7,
  __bottle_soda: 0.74,
  __bottle_carafe: 0.72,
  __bottle_syrup: 0.72,
};
