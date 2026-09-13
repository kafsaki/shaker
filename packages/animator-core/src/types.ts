/**
 * Timeline 的数据结构 —— animator-core 的输出，绘制后端的输入。
 *
 * 两条不可妥协的规则（规范 §9.1）：
 *
 * **① 关键帧是完整场景快照，不是增量。** 渲染器只需找到 t 所属区间、对两端插值
 *     即可绘制 —— seek 是 O(1)，不需要重放历史。这是「拖时间轴」和「单步回看」的前提。
 *
 * **② 粒子是 t 的纯函数。** 气泡/烟雾/火焰不进关键帧插值，而由 Effect 的参数化
 *     发射器 + 固定 seed 在渲染时按 t 确定性算出。如果粒子带状态，seek 回退时
 *     位置就会跳变，拖时间轴的体验会立刻崩坏。
 */
import type { ContainerId, VocabLookup } from "@shaker/recipe-ir/core";

/* ════════════════════════════ 顶层 ════════════════════════════ */

export interface Timeline {
  totalMs: number;
  /** 与 IR steps 一一对应 —— 支撑「单步回看」。 */
  steps: TimelineStep[];
  /** 成品定格时刻，用于截封面图（ADR-015）。 */
  finalSceneMs: number;
  /** 舞台逻辑尺寸。所有坐标都是这个坐标系内的，由渲染器映射到像素。 */
  stage: { width: number; height: number };
}

export interface TimelineStep {
  stepId: string;
  action: string;
  startMs: number;
  durationMs: number;
  label: { zh: string; en: string };
  keyframes: Keyframe[];
}

export type Ease = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface Keyframe {
  tMs: number;
  scene: Scene;
  /** 到下一帧的插值曲线。 */
  ease: Ease;
}

/* ════════════════════════════ 场景 ════════════════════════════ */

export interface Scene {
  /** 镜头焦点，驱动缩放与居中。 */
  focus: ContainerId;
  containers: RenderedContainer[];
  props: Prop[];
  effects: Effect[];
}

export interface RenderedContainer {
  id: ContainerId;
  /** 杯型/容器 ID，渲染器据此取剖面。 */
  vesselId: string;
  /** 舞台坐标，杯底中心。 */
  x: number;
  y: number;
  /** 容器绝对高度（舞台单位）。 */
  height: number;
  scale: number;
  opacity: number;
  /** 倾倒角度（弧度）。 */
  tilt: number;
  /** 摇晃位移与旋转。渲染器按 phase 叠加正弦。 */
  shake: ShakeMotion | null;
  /** 杯壁霜，0..1。 */
  frost: number;
  /** 液层，自下而上。 */
  layers: RenderedLayer[];
  ice: RenderedIce[];
  /** 泡沫冠，归一化高度区间。 */
  foam: { fromH: number; toH: number; color: string } | null;
  rim: { coverage: "full" | "half"; color: string } | null;
  garnishes: RenderedGarnish[];
  /** 杯内烟雾浓度 0..1。 */
  smoke: number;
  /** 是否加盖（SHAKE / SMOKE cover）。 */
  lidOn: boolean;
}

export interface ShakeMotion {
  /** 舞台单位的位移幅度。 */
  ampX: number;
  ampY: number;
  /** 旋转幅度（弧度）。 */
  rot: number;
  /** 每秒周期数。 */
  freqHz: number;
  /** 相位偏移，保证不同关键帧间连续。 */
  phase: number;
}

export interface RenderedLayer {
  /** 归一化高度下边界（0 = 杯底）。 */
  fromH: number;
  /** 上边界。 */
  toH: number;
  color: string;
  opacity: number;
  /**
   * 层间渐变带宽度（归一化高度单位）。
   * 由 mixedness 控制：0 = 锐利分层（FLOAT），大值 = 已混匀。
   */
  blend: number;
  /** 气泡发射率 0..1。 */
  carbonation: number;
  /** 溯源 —— UI 悬停原料可高亮它贡献的层。 */
  sourceSlots: string[];
}

export interface RenderedIce {
  kind: "cube" | "large_cube" | "sphere" | "cracked" | "crushed" | "block" | "dry_ice";
  /** 容器内归一化坐标：x 为 -1..1（相对该高度的半径），y 为 0..1 高度。 */
  x: number;
  y: number;
  /** 归一化尺寸。 */
  size: number;
  rot: number;
  opacity: number;
}

export interface RenderedGarnish {
  garnishId: string;
  position: "rim" | "in_glass" | "float" | "skewer" | "side";
  prep: string;
  /** 舞台坐标偏移（相对容器）。 */
  dx: number;
  dy: number;
  rot: number;
  opacity: number;
  color: string;
}

export interface Prop {
  kind:
    | "jigger"
    | "bottle"
    | "lid"
    | "barspoon"
    | "strainer"
    | "muddler"
    | "swizzle"
    | "spray"
    | "peel"
    | "blender_lid";
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  /** 倒注流。存在时渲染一条液流。 */
  stream?: {
    toX: number;
    toY: number;
    width: number;
    color: string;
  };
}

/* ════════════════════════════ 效果 ════════════════════════════ */

export type EffectKind = "bubbles" | "smoke" | "flame" | "mist" | "sparks";

export interface Effect {
  kind: EffectKind;
  /** 固定 seed —— 保证粒子位置可重现、可 seek。 */
  seed: number;
  startMs: number;
  endMs: number;
  /** 发射率（个/秒）。 */
  rate: number;
  /** 发射区域，舞台坐标。 */
  region: { x: number; y: number; w: number; h: number };
  /** 粒子上升/飘移方向与速度，舞台单位/秒。 */
  drift: { vx: number; vy: number };
  size: { min: number; max: number };
  color: string;
  opacity: number;
}

/* ════════════════════════════ 编译输入 ════════════════════════════ */

/**
 * 编译所需的词表视图。
 *
 * 直接复用 recipe-ir 的 `VocabLookup` —— 不另立一个近似接口，
 * 否则同一个词表要同时满足两个形状相似但不相同的类型。
 *
 * 成品杯来自 `ir.glass`；工作容器（shaker 等）用 `WORK_VESSEL_IDS` 里的内置 ID。
 */
export type ResolvedVocab = VocabLookup;

export interface CompileOptions {
  /** 播放速度倍率，> 1 更快。 */
  speedScale?: number;
  /** 舞台逻辑尺寸，默认 400×520。 */
  stage?: { width: number; height: number };
}
