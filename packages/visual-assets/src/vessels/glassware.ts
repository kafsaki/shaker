/**
 * 玻璃杯剖面 —— 内容向素材：配方库的一部分，随经典配方扩展。
 * 物理字段（capacityMl、profile）必须按真实数据填：compile 用它算液面高度与容量，
 * 渲染端用同一剖面画杯壁 —— 改剖面会同时改物理和外观，PR 时需两者一起审。
 */
import {
  coneProfile,
  coupeProfile,
  type ProfilePoint,
  type VesselDef,
} from "@shaker/recipe-ir/core";

/** 直筒/微锥杯的剖面。r 相对**高度**归一化，所以 r 越小杯子越瘦长。 */
export function tumblerProfile(
  rTop: number,
  rBottom = rTop * 0.94,
): ProfilePoint[] {
  return [
    { y: 0, r: rBottom },
    { y: 0.06, r: rTop * 0.98 },
    { y: 1, r: rTop },
  ];
}

export const GLASSWARE_VESSEL_DEFS: readonly VesselDef[] = [
  {
    id: "coupe",
    nameZh: "碟形杯",
    nameEn: "Coupe",
    capacityMl: 180,
    shape: {
      profile: coupeProfile(),
      stem: { height: 0.62, width: 0.05 },
      base: { radius: 0.32 },
    },
  },
  {
    id: "martini",
    nameZh: "马天尼杯",
    nameEn: "Martini",
    capacityMl: 150,
    shape: {
      profile: coneProfile(0.52, 0.05),
      stem: { height: 0.7, width: 0.05 },
      base: { radius: 0.34 },
    },
  },
  { id: "rocks", nameZh: "古典杯", nameEn: "Rocks", capacityMl: 240, shape: { profile: tumblerProfile(0.52) } },
  { id: "highball", nameZh: "高球杯", nameEn: "Highball", capacityMl: 300, shape: { profile: tumblerProfile(0.23) } },
  { id: "collins", nameZh: "柯林斯杯", nameEn: "Collins", capacityMl: 350, shape: { profile: tumblerProfile(0.21) } },
  {
    id: "sour-glass",
    nameZh: "酸酒杯",
    nameEn: "Sour Glass",
    capacityMl: 180,
    shape: { profile: tumblerProfile(0.3), stem: { height: 0.3, width: 0.05 }, base: { radius: 0.26 } },
  },
];
