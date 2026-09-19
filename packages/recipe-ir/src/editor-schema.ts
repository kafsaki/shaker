/**
 * 编辑器的字段描述表：21 个动作 → 通用表单字段的声明式定义。
 * web 编辑器（StepCard）与原型调试编辑器据此渲染，无需为每个动作写专用组件。
 * 只进 barrel，不进 core（core 保持只读播放路径的最小体积）。
 */
import type { Step } from "./ir.ts";

export type FieldKind =
  | "container" // 单容器（target/from/to）
  | "container_from"
  | "container_to"
  | "slots" // 多选 slot（items）
  | "slot" // 单选 slot（RIM material）
  | "number" // 数字（含 min/max/step/integer）
  | "boolean"
  | "ice_type"
  | "fill" // 0..1 冰量
  | "duration" // 秒（可选正数）
  | "enum"; // 通用枚举下拉

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  /** enum 选项。 */
  options?: { value: string; label: string }[];
}

const C = (key: string, label: string): FieldDef => ({ key, label, kind: "container", required: true });

export const ACTION_META: Record<
  string,
  { label: string; group: string; fields: FieldDef[] }
> = {
  CHILL: {
    label: "冰镇",
    group: "准备",
    fields: [
      C("target", "目标容器"),
      {
        key: "method", label: "方式", kind: "enum",
        options: [
          { value: "ice_water", label: "冰水" },
          { value: "freezer", label: "冷冻" },
        ],
      },
    ],
  },
  RIM: {
    label: "挂杯口",
    group: "准备",
    fields: [
      C("target", "目标容器"),
      { key: "material", label: "材料（须 rim 单位）", kind: "slot", required: true },
      {
        key: "coverage", label: "覆盖", kind: "enum",
        options: [
          { value: "full", label: "整圈" },
          { value: "half", label: "半圈" },
        ],
      },
    ],
  },
  RINSE: {
    label: "涮杯",
    group: "准备",
    fields: [
      C("target", "目标容器"),
      { key: "items", label: "材料", kind: "slots", required: true },
      { key: "discard", label: "倒掉多余", kind: "boolean" },
    ],
  },
  ADD: {
    label: "加入",
    group: "装填",
    fields: [
      C("target", "目标容器"),
      { key: "items", label: "材料", kind: "slots", required: true },
      {
        key: "pour", label: "倒法", kind: "enum",
        options: [
          { value: "sequential", label: "依次" },
          { value: "simultaneous", label: "同时" },
        ],
      },
    ],
  },
  ICE: {
    label: "加冰",
    group: "装填",
    fields: [
      C("target", "目标容器"),
      { key: "iceType", label: "冰型", kind: "ice_type", required: true },
      { key: "fill", label: "冰量（占容器）", kind: "fill", required: true },
    ],
  },
  MUDDLE: {
    label: "捣压",
    group: "装填",
    fields: [
      C("target", "目标容器"),
      { key: "items", label: "材料", kind: "slots", required: true },
      {
        key: "intensity", label: "力度", kind: "enum",
        options: [
          { value: "gentle", label: "轻" },
          { value: "firm", label: "用力" },
        ],
      },
    ],
  },
  SHAKE: {
    label: "摇和",
    group: "混合",
    fields: [
      C("target", "目标容器"),
      { key: "durationSec", label: "时长（秒）", kind: "duration" },
      {
        key: "intensity", label: "力度", kind: "enum",
        options: [
          { value: "gentle", label: "轻摇" },
          { value: "standard", label: "标准" },
          { value: "hard", label: "硬摇" },
        ],
      },
      { key: "dryShake", label: "干摇（无冰起泡）", kind: "boolean" },
    ],
  },
  STIR: {
    label: "搅拌",
    group: "混合",
    fields: [
      C("target", "目标容器"),
      { key: "durationSec", label: "时长（秒）", kind: "duration" },
      { key: "revolutions", label: "圈数", kind: "number", min: 1, max: 200, integer: true },
    ],
  },
  SWIZZLE: {
    label: "搅棒",
    group: "混合",
    fields: [C("target", "目标容器"), { key: "durationSec", label: "时长（秒）", kind: "duration" }],
  },
  ROLL: {
    label: "滚倒",
    group: "混合",
    fields: [
      C("from", "从"),
      C("to", "到"),
      { key: "times", label: "次数", kind: "number", min: 1, max: 10, integer: true, required: true },
    ],
  },
  THROW: {
    label: "抛倒",
    group: "混合",
    fields: [
      C("from", "从"),
      C("to", "到"),
      { key: "times", label: "次数", kind: "number", min: 1, max: 10, integer: true, required: true },
      {
        key: "height", label: "高度", kind: "enum",
        options: [
          { value: "low", label: "低" },
          { value: "high", label: "高" },
        ],
      },
    ],
  },
  BLEND: {
    label: "电动混合",
    group: "混合",
    fields: [
      C("target", "目标容器"),
      { key: "durationSec", label: "时长（秒）", kind: "duration" },
      {
        key: "speed", label: "速度", kind: "enum",
        options: [
          { value: "low", label: "低速" },
          { value: "high", label: "高速" },
        ],
      },
    ],
  },
  STRAIN: {
    label: "过滤",
    group: "转移",
    fields: [
      C("from", "从"),
      C("to", "到"),
      {
        key: "strainer", label: "滤网", kind: "enum",
        options: [
          { value: "hawthorne", label: "霍桑滤网" },
          { value: "julep", label: "茱莉普滤网" },
          { value: "fine", label: "细滤网" },
          { value: "none", label: "不用滤网" },
        ],
      },
      { key: "double", label: "双重过滤", kind: "boolean" },
    ],
  },
  DUMP: {
    label: "倒空转移",
    group: "转移",
    fields: [C("from", "从"), C("to", "到")],
  },
  TOP_UP: {
    label: "补满",
    group: "完成",
    fields: [
      C("target", "目标容器"),
      { key: "items", label: "材料（须 top_up 单位）", kind: "slots", required: true },
    ],
  },
  FLOAT: {
    label: "漂浮",
    group: "完成",
    fields: [
      C("target", "目标容器"),
      { key: "items", label: "材料", kind: "slots", required: true },
      {
        key: "technique", label: "手法", kind: "enum",
        options: [
          { value: "over_spoon", label: "吧勺引流" },
          { value: "gentle_pour", label: "缓倒" },
        ],
      },
    ],
  },
  GARNISH: {
    label: "装饰",
    group: "完成",
    fields: [
      C("target", "目标容器"),
      { key: "items", label: "材料", kind: "slots", required: true },
      {
        key: "position", label: "位置", kind: "enum", required: true,
        options: [
          { value: "rim", label: "杯口" },
          { value: "in_glass", label: "杯中" },
          { value: "float", label: "液面" },
          { value: "skewer", label: "串签" },
          { value: "side", label: "杯旁" },
        ],
      },
      {
        key: "prep", label: "处理", kind: "enum",
        options: [
          { value: "twist", label: "扭皮" },
          { value: "wheel", label: "圆片" },
          { value: "wedge", label: "角块" },
          { value: "flag", label: "旗签" },
          { value: "dehydrated", label: "脱水" },
          { value: "expressed", label: "挤油" },
          { value: "slapped", label: "拍香" },
          { value: "none", label: "无" },
        ],
      },
      { key: "discard", label: "挤完丢弃", kind: "boolean" },
    ],
  },
  SPRITZ: {
    label: "喷洒",
    group: "完成",
    fields: [
      C("target", "目标容器"),
      { key: "items", label: "材料", kind: "slots", required: true },
      { key: "sprays", label: "喷数", kind: "number", min: 1, max: 10, integer: true },
    ],
  },
  FLAME: {
    label: "火焰",
    group: "完成",
    fields: [
      C("target", "目标容器"),
      {
        key: "subject", label: "对象", kind: "enum",
        options: [
          { value: "garnish", label: "装饰" },
          { value: "surface", label: "液面" },
          { value: "peel_oil", label: "皮油" },
        ],
      },
      { key: "durationSec", label: "时长（秒）", kind: "duration" },
    ],
  },
  SMOKE: {
    label: "烟熏",
    group: "完成",
    fields: [
      C("target", "目标容器"),
      {
        key: "method", label: "方式", kind: "enum",
        options: [
          { value: "smoking_gun", label: "烟枪" },
          { value: "torched_wood", label: "烧木板" },
          { value: "dry_ice", label: "干冰" },
        ],
      },
      { key: "cover", label: "加盖聚烟", kind: "boolean" },
      { key: "durationSec", label: "时长（秒）", kind: "duration" },
    ],
  },
  WAIT: {
    label: "等待",
    group: "完成",
    fields: [
      C("target", "目标容器"),
      { key: "durationSec", label: "时长（秒）", kind: "duration", required: true },
      {
        key: "reason", label: "原因", kind: "enum",
        options: [
          { value: "settle", label: "分层稳定" },
          { value: "bloom", label: "泡沫成型" },
          { value: "infuse", label: "风味融合" },
        ],
      },
    ],
  },
};

export const CONTAINER_OPTIONS = [
  { value: "shaker", label: "摇酒壶" },
  { value: "mixing_glass", label: "搅拌杯" },
  { value: "glass", label: "成品杯" },
  { value: "blender", label: "搅拌机" },
  { value: "secondary", label: "第二容器" },
];

export const ICE_TYPE_OPTIONS = [
  { value: "cube", label: "方冰" },
  { value: "large_cube", label: "大方冰" },
  { value: "sphere", label: "球冰" },
  { value: "cracked", label: "裂冰" },
  { value: "crushed", label: "碎冰" },
  { value: "block", label: "冰柱" },
  { value: "dry_ice", label: "干冰" },
];

export const UNIT_GROUPS = [
  { value: "ml", label: "ml", kind: "volume" },
  { value: "cl", label: "cl", kind: "volume" },
  { value: "oz", label: "oz", kind: "volume" },
  { value: "barspoon", label: "吧勺", kind: "spoon" },
  { value: "tsp", label: "茶匙", kind: "spoon" },
  { value: "dash", label: "dash", kind: "quasi" },
  { value: "drop", label: "滴", kind: "quasi" },
  { value: "piece", label: "个", kind: "count" },
  { value: "leaf", label: "片", kind: "count" },
  { value: "wedge", label: "角", kind: "count" },
  { value: "slice", label: "薄片", kind: "count" },
  { value: "top_up", label: "补满", kind: "none" },
  { value: "rim", label: "挂杯口", kind: "none" },
  { value: "to_taste", label: "适量", kind: "none" },
] as const;

export const ROLE_OPTIONS = [
  { value: "base", label: "基酒" },
  { value: "modifier", label: "修饰" },
  { value: "sweetener", label: "甜味" },
  { value: "souring", label: "酸味" },
  { value: "bittering", label: "苦味" },
  { value: "lengthener", label: "稀释/延长" },
  { value: "texture", label: "口感" },
  { value: "rinse", label: "涮杯" },
  { value: "garnish", label: "装饰" },
  { value: "ice", label: "冰" },
];

/** 家族预设骨架（ADR-010）：选家族 → 铺好步骤模板，用户只填原料。 */
export function familySkeleton(family: string): {
  glass?: string;
  method?: string;
  steps: Array<Pick<Step, "action"> & Record<string, unknown>>;
} {
  switch (family) {
    case "sour":
      return {
        glass: "coupe",
        method: "shaken",
        steps: [
          { action: "ADD", target: "shaker", items: [] },
          { action: "ICE", target: "shaker", iceType: "cube", fill: 0.5 },
          { action: "SHAKE", target: "shaker", intensity: "standard" },
          { action: "STRAIN", from: "shaker", to: "glass", strainer: "hawthorne" },
        ],
      };
    case "highball":
      return {
        glass: "highball",
        method: "built",
        steps: [
          { action: "ADD", target: "glass", items: [] },
          { action: "ICE", target: "glass", iceType: "cube", fill: 0.9 },
          { action: "TOP_UP", target: "glass", items: [] },
        ],
      };
    case "old_fashioned":
      return {
        glass: "rocks",
        method: "built",
        steps: [
          { action: "ADD", target: "glass", items: [] },
          { action: "ICE", target: "glass", iceType: "large_cube", fill: 0.8 },
          { action: "STIR", target: "glass" },
        ],
      };
    case "martini_duo":
      return {
        glass: "martini",
        method: "stirred",
        steps: [
          { action: "ADD", target: "mixing_glass", items: [] },
          { action: "ICE", target: "mixing_glass", iceType: "cube", fill: 0.9 },
          { action: "STIR", target: "mixing_glass" },
          { action: "STRAIN", from: "mixing_glass", to: "glass", strainer: "julep" },
        ],
      };
    case "smash_julep":
      return {
        glass: "rocks",
        method: "built",
        steps: [
          { action: "MUDDLE", target: "glass", items: [], intensity: "gentle" },
          { action: "ADD", target: "glass", items: [] },
          { action: "ICE", target: "glass", iceType: "crushed", fill: 1 },
          { action: "SWIZZLE", target: "glass" },
        ],
      };
    case "equal_parts":
      return {
        glass: "rocks",
        method: "built",
        steps: [
          { action: "ADD", target: "glass", items: [] },
          { action: "ICE", target: "glass", iceType: "large_cube", fill: 0.6 },
          { action: "STIR", target: "glass" },
        ],
      };
    default:
      return { steps: [{ action: "ADD", target: "glass", items: [] }] };
  }
}
