/**
 * 工作器具剖面 —— 道具向素材：动画器的固有装置（摇壶/搅拌杯/搅拌机/量酒器），
 * 不属于 glassware 内容词表。它们必须永远内置可查：compile 是纯函数，
 * 词表缺摇壶不能导致编译失败，只能回退到这里。
 *
 * id 以 `__` 开头，与内容词表隔离，不会被配方直接引用为成品杯。
 *
 * 比例按真实器具（ADR-031）：r 相对**高度**归一化。旧版摇壶 r = 0.36（直径 = 0.72 倍高），
 * 胖得像个罐头；真实的三段式摇壶约 9cm 宽、20cm 高。
 */
import type { VesselDef } from "@shaker/recipe-ir/core";
import { tumblerProfile } from "./glassware.ts";

export const WORK_VESSEL_DEFS: readonly VesselDef[] = [
  // 三段式摇壶（cobbler）的壶身：收肩，壶盖（带滤网与小帽）是单独的道具
  {
    id: "__shaker",
    nameZh: "摇酒壶",
    nameEn: "Shaker",
    capacityMl: 530,
    shape: {
      profile: [
        { y: 0, r: 0.19 },
        { y: 0.06, r: 0.2 },
        { y: 0.74, r: 0.245 },
        { y: 0.88, r: 0.2 },
        { y: 1, r: 0.15, corner: true },
      ],
    },
  },
  {
    id: "__mixing_glass",
    nameZh: "搅拌杯",
    nameEn: "Mixing Glass",
    capacityMl: 600,
    shape: { profile: tumblerProfile(0.31) },
  },
  {
    id: "__blender",
    nameZh: "搅拌机",
    nameEn: "Blender",
    capacityMl: 1200,
    shape: {
      profile: [
        { y: 0, r: 0.2, corner: true },
        { y: 0.12, r: 0.24 },
        { y: 1, r: 0.33, corner: true },
      ],
    },
  },
  {
    id: "__secondary",
    nameZh: "第二容器",
    nameEn: "Second Vessel",
    capacityMl: 400,
    shape: { profile: tumblerProfile(0.3) },
  },
  // 量酒器 —— 只画上杯（锥形杯口朝上），下杯画成实心杯脚：倒酒时液体只在上杯里，
  // 这样倾倒时液面求解与真实一致（旧版把双头量杯当成一个沙漏腔体，液体会先灌进下杯）
  {
    id: "__jigger",
    nameZh: "量酒器",
    nameEn: "Jigger",
    capacityMl: 45,
    shape: {
      profile: [
        { y: 0, r: 0.1, corner: true },
        { y: 1, r: 0.3, corner: true },
      ],
      stem: { height: 0.62, width: 0.1 },
      base: { radius: 0.24 },
    },
  },
];
