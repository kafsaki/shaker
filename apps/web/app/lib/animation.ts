/**
 * 播放路径的动画装配（ADR-020 纪律：这里只引 `@shaker/recipe-ir/core`，
 * zod 不进播放 bundle；编辑器路径才允许引 barrel）。
 *
 * API 的 `expand=viz` 载荷只含 IR 引用到的杯型/原料 —— 编译动画正好够用
 * （compile 只读 viz.color / viz.viscosity）。工作容器（__shaker 等）
 * 由 animator-core 内置，这里把回退并入 vessel 查找。
 */
import {
  compileVessel,
  type IngredientMeta,
  type VesselDef,
  type VesselSpec,
} from "@shaker/recipe-ir/core";
import type { VocabLookup } from "@shaker/recipe-ir/core";
import { WORK_VESSELS } from "@shaker/animator-core";
import type { components } from "@shaker/api-client";

export type VizPayload = NonNullable<components["schemas"]["RecipeBody"]["viz"]>;

/** 把 viz 载荷装配成 compile() 需要的 VocabLookup。 */
export function vizToVocab(viz: VizPayload): VocabLookup {
  const ingredients = new Map<string, IngredientMeta>();
  for (const [id, v] of Object.entries(viz.ingredients ?? {})) {
    ingredients.set(id, {
      id,
      nameZh: v.nameZh,
      nameEn: v.nameEn,
      category: "other", // compile 不读 category；详情页展示走 API 数据
      viz: v.viz as IngredientMeta["viz"],
    });
  }

  const vessels = new Map<string, VesselSpec>();
  for (const [id, g] of Object.entries(viz.glassware ?? {})) {
    const def: VesselDef = {
      id,
      nameZh: g.nameZh,
      nameEn: g.nameEn,
      capacityMl: g.capacityMl,
      shape: g.shape as VesselDef["shape"],
    };
    vessels.set(id, compileVessel(def));
  }

  return {
    ingredient: (id) => ingredients.get(id),
    vessel: (id) => vessels.get(id) ?? WORK_VESSELS.get(id),
  };
}
