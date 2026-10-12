/**
 * 资源覆盖测试夹具 —— 虚构配方，只为让渲染器的每种资源（杯型 / 冰型 / 道具 /
 * 动作 / 装饰位姿）都能被人眼检查到。命名 asset_testN，不进种子数据。
 *
 * 覆盖矩阵（7 个真实夹具已覆盖的不重复列）：
 *   asset_test1  martini 杯 · mixing_glass · RINSE · julep 滤网
 *   asset_test2  cracked 冰 · FLOAT 强制分层 · 装饰 float + skewer/flag
 *   asset_test3  blender + blender_lid · BLEND(creamy) · DUMP 连冰倒 · 装饰 side/wedge
 *   asset_test4  ROLL · secondary 双容器来回
 *   asset_test5  THROW（high + low 两种抛掷高度）
 *   asset_test6  RIM 半圈盐边 · SPRITZ 喷雾 · FLAME(peel_oil 火花 + surface 火焰)
 *   asset_test7  dry_ice · SMOKE 熏枪揭盖 · WAIT infuse
 */
import { parse, type Fixture } from "./index.ts";

export const ASSET_TEST_FIXTURES: Fixture[] = [
  {
    title: "asset_test1",
    subtitle: "马天尼杯 · 搅拌杯 · RINSE · julep 滤网",
    family: "martini_duo",
    tests: "RINSE 挂壁倒掉、搅拌杯 STIR、julep 滤网滤入马天尼杯（无冰出品）。",
    ir: parse({
      schemaVersion: 1,
      glass: "martini",
      method: "stirred",
      ingredients: [
        { slot: "i1", ingredientId: "gin-london-dry", amount: 60, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "vermouth-rosso", amount: 20, unit: "ml", role: "modifier" },
        { slot: "i3", ingredientId: "campari", amount: 5, unit: "ml", role: "rinse" },
        { slot: "i4", ingredientId: "lemon-peel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "RINSE", target: "glass", items: ["i3"], discard: true },
        { id: "s2", action: "ADD", target: "mixing_glass", items: ["i1", "i2"] },
        { id: "s3", action: "ICE", target: "mixing_glass", iceType: "cube", fill: 0.7 },
        { id: "s4", action: "STIR", target: "mixing_glass", durationSec: 30 },
        { id: "s5", action: "STRAIN", from: "mixing_glass", to: "glass", strainer: "julep" },
        { id: "s6", action: "GARNISH", target: "glass", items: ["i4"], position: "rim", prep: "twist" },
      ],
    }),
  },

  {
    title: "asset_test2",
    subtitle: "裂冰 · FLOAT 分层 · 签串/漂浮装饰",
    family: "layered_shot",
    tests: "cracked 冰型、FLOAT 强制新层（朗姆浮在橙汁上）、skewer/flag 签串与 float 漂浮装饰。",
    ir: parse({
      schemaVersion: 1,
      glass: "rocks",
      method: "layered",
      ingredients: [
        { slot: "i1", ingredientId: "orange-juice", amount: 90, unit: "ml", role: "lengthener" },
        { slot: "i2", ingredientId: "rum-white", amount: 30, unit: "ml", role: "base" },
        { slot: "i3", ingredientId: "cherry", amount: 1, unit: "piece", role: "garnish" },
        { slot: "i4", ingredientId: "orange-wheel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "ICE", target: "glass", iceType: "cracked", fill: 0.6 },
        { id: "s2", action: "ADD", target: "glass", items: ["i1"] },
        { id: "s3", action: "FLOAT", target: "glass", items: ["i2"], technique: "over_spoon" },
        { id: "s4", action: "GARNISH", target: "glass", items: ["i3"], position: "skewer", prep: "flag" },
        { id: "s5", action: "GARNISH", target: "glass", items: ["i4"], position: "float", prep: "none" },
      ],
    }),
  },

  {
    title: "asset_test3",
    subtitle: "搅拌机 · BLEND 雪泥 · DUMP 连冰倒",
    family: "punch_tiki",
    tests: "blender 工作容器与 blender_lid、BLEND 打冰成雪泥（creamy）、DUMP 连冰转移、side/wedge 装饰。",
    ir: parse({
      schemaVersion: 1,
      glass: "collins",
      method: "blended",
      ingredients: [
        { slot: "i1", ingredientId: "rum-white", amount: 45, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "lime-juice", amount: 20, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", amount: 20, unit: "ml", role: "sweetener" },
        { slot: "i4", ingredientId: "orange-juice", amount: 30, unit: "ml", role: "lengthener" },
        { slot: "i5", ingredientId: "lime-wheel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "blender", items: ["i1", "i2", "i3", "i4"] },
        { id: "s2", action: "ICE", target: "blender", iceType: "cube", fill: 0.7 },
        { id: "s3", action: "BLEND", target: "blender", durationSec: 20, speed: "high" },
        { id: "s4", action: "DUMP", from: "blender", to: "glass" },
        { id: "s5", action: "GARNISH", target: "glass", items: ["i5"], position: "side", prep: "wedge" },
      ],
    }),
  },

  {
    title: "asset_test4",
    subtitle: "ROLL 双容器来回滚动",
    family: "highball",
    tests: "ROLL 在 glass 与 secondary 之间来回转移（不携冰），验证第二容器与转移液流。",
    ir: parse({
      schemaVersion: 1,
      glass: "highball",
      method: "rolled",
      ingredients: [
        { slot: "i1", ingredientId: "tequila-blanco", amount: 45, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "orange-juice", amount: 90, unit: "ml", role: "lengthener" },
        { slot: "i3", ingredientId: "lime-juice", amount: 15, unit: "ml", role: "souring" },
        { slot: "i4", ingredientId: "orange-wheel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "ICE", target: "glass", iceType: "cube", fill: 0.5 },
        { id: "s2", action: "ADD", target: "glass", items: ["i1", "i2", "i3"] },
        { id: "s3", action: "ROLL", from: "glass", to: "secondary", times: 2 },
        { id: "s4", action: "ROLL", from: "secondary", to: "glass", times: 1 },
        { id: "s5", action: "GARNISH", target: "glass", items: ["i4"], position: "rim", prep: "wheel" },
      ],
    }),
  },

  {
    title: "asset_test5",
    subtitle: "THROW 高抛 + 低抛",
    family: "sour",
    tests: "THROW 两种抛掷高度（high / low），验证长液流拉伸与容器转移。",
    ir: parse({
      schemaVersion: 1,
      glass: "rocks",
      method: "thrown",
      ingredients: [
        { slot: "i1", ingredientId: "bourbon", amount: 45, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "lemon-juice", amount: 20, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", amount: 15, unit: "ml", role: "sweetener" },
      ],
      steps: [
        { id: "s1", action: "ADD", target: "glass", items: ["i1", "i2", "i3"] },
        { id: "s2", action: "THROW", from: "glass", to: "secondary", times: 1, height: "high" },
        { id: "s3", action: "THROW", from: "secondary", to: "glass", times: 1, height: "low" },
      ],
    }),
  },

  {
    title: "asset_test6",
    subtitle: "盐边 · 喷雾 · 火焰（火花+表面）",
    family: "sour",
    tests: "RIM 半圈边饰、SPRITZ 喷雾道具、FLAME 的 peel_oil 火花与 surface 火焰两种形态。",
    ir: parse({
      schemaVersion: 1,
      glass: "coupe",
      method: "built",
      ingredients: [
        { slot: "i1", ingredientId: "tequila-blanco", amount: 50, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "lime-juice", amount: 20, unit: "ml", role: "souring" },
        { slot: "i3", ingredientId: "simple-syrup", unit: "rim", role: "garnish" },
        { slot: "i4", ingredientId: "lime-wheel", amount: 1, unit: "piece", role: "garnish" },
        { slot: "i5", ingredientId: "angostura", amount: 1, unit: "dash", role: "bittering" },
      ],
      steps: [
        { id: "s1", action: "RIM", target: "glass", material: "i3", coverage: "half" },
        { id: "s2", action: "ADD", target: "glass", items: ["i1", "i2"] },
        { id: "s3", action: "SPRITZ", target: "glass", items: ["i5"], sprays: 2 },
        { id: "s4", action: "FLAME", target: "glass", subject: "peel_oil" },
        { id: "s5", action: "FLAME", target: "glass", subject: "surface" },
        { id: "s6", action: "GARNISH", target: "glass", items: ["i4"], position: "rim", prep: "none" },
      ],
    }),
  },

  {
    title: "asset_test7",
    subtitle: "干冰 · 熏枪揭盖 · WAIT infuse",
    family: "punch_tiki",
    tests: "dry_ice 冰型（不排水只产烟）、SMOKE 熏枪加盖/揭盖、WAIT reason=infuse 的烟雾半衰。",
    ir: parse({
      schemaVersion: 1,
      glass: "rocks",
      method: "built",
      ingredients: [
        { slot: "i1", ingredientId: "bourbon", amount: 50, unit: "ml", role: "base" },
        { slot: "i2", ingredientId: "orange-peel", amount: 1, unit: "piece", role: "garnish" },
      ],
      steps: [
        { id: "s1", action: "ICE", target: "glass", iceType: "dry_ice", fill: 0.2 },
        { id: "s2", action: "ADD", target: "glass", items: ["i1"] },
        { id: "s3", action: "SMOKE", target: "glass", method: "smoking_gun", cover: true },
        { id: "s4", action: "WAIT", target: "glass", durationSec: 10, reason: "infuse" },
        { id: "s5", action: "GARNISH", target: "glass", items: ["i2"], position: "rim", prep: "expressed" },
      ],
    }),
  },
];
