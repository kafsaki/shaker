/**
 * 素材统一查询入口。渲染端/编译端只认识这里，不关心素材具体定义在哪个文件。
 *
 * 查询语义分界（有意保留，不是冗余）：
 *   - glassware 是内容词表 —— 查不到说明 IR 非法，应在校验层（IRV）拦住；
 *   - work 是内置道具 —— 永远命中，给 compile 做兜底。
 */
import type { VesselDef } from "@shaker/recipe-ir/core";
import { GARNISH_SPRITES, garnishSpriteRows, GARNISH_FALLBACK } from "./sprites/garnish.ts";
import { PROP_SPRITES } from "./sprites/props.ts";
import { GLASSWARE_VESSEL_DEFS, tumblerProfile } from "./vessels/glassware.ts";
import { WORK_VESSEL_DEFS } from "./vessels/work.ts";

const VESSEL_DEF_MAP = new Map<string, VesselDef>(
  [...GLASSWARE_VESSEL_DEFS, ...WORK_VESSEL_DEFS].map((d) => [d.id, d]),
);

/** 按 id 查容器剖面定义（玻璃杯 + 工作器具）。 */
export function vesselDef(id: string): VesselDef | undefined {
  return VESSEL_DEF_MAP.get(id);
}

/** 全部容器定义（glassware 在前，work 在后）。 */
export const ALL_VESSEL_DEFS: readonly VesselDef[] = [
  ...GLASSWARE_VESSEL_DEFS,
  ...WORK_VESSEL_DEFS,
];

export {
  GARNISH_SPRITES,
  garnishSpriteRows,
  GARNISH_FALLBACK,
  PROP_SPRITES,
  GLASSWARE_VESSEL_DEFS,
  WORK_VESSEL_DEFS,
  tumblerProfile,
};
