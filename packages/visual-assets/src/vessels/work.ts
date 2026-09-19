/**
 * 工作器具剖面 —— 道具向素材：动画器的固有装置（摇壶/搅拌杯/搅拌机/量酒器），
 * 不属于 glassware 内容词表。它们必须永远内置可查：compile 是纯函数，
 * 词表缺摇壶不能导致编译失败，只能回退到这里。
 *
 * id 以 `__` 开头，与内容词表隔离，不会被配方直接引用为成品杯。
 */
import type { VesselDef } from "@shaker/recipe-ir/core";
import { tumblerProfile } from "./glassware.ts";

export const WORK_VESSEL_DEFS: readonly VesselDef[] = [
  {
    id: "__shaker",
    nameZh: "摇酒壶",
    nameEn: "Shaker",
    capacityMl: 530,
    shape: {
      profile: [
        { y: 0, r: 0.3 },
        { y: 0.62, r: 0.36 },
        { y: 1, r: 0.31 },
      ],
    },
  },
  {
    id: "__mixing_glass",
    nameZh: "搅拌杯",
    nameEn: "Mixing Glass",
    capacityMl: 600,
    shape: { profile: tumblerProfile(0.42) },
  },
  {
    id: "__blender",
    nameZh: "搅拌机",
    nameEn: "Blender",
    capacityMl: 1200,
    shape: { profile: tumblerProfile(0.36) },
  },
  {
    id: "__secondary",
    nameZh: "第二容器",
    nameEn: "Second Vessel",
    capacityMl: 400,
    shape: { profile: tumblerProfile(0.34) },
  },
  // 量酒器 —— 双头量杯：两个锥体底对底（沙漏剖面），上杯大下杯小，
  // 用 pour_vessel 绘制（贴杯口倾斜倒出）
  {
    id: "__jigger",
    nameZh: "量酒器",
    nameEn: "Jigger",
    capacityMl: 60,
    shape: {
      profile: [
        { y: 0, r: 0.18 },
        { y: 0.45, r: 0.09 },
        { y: 1, r: 0.26 },
      ],
    },
  },
];
