/**
 * Timeline 与 Scene 的数据结构 —— animator-core 的输出，绘制后端的输入（ADR-031）。
 *
 * 两段式：
 *   compile(ir) → Timeline   编译期：语义状态机 + 编排，产出各实体的关键帧轨道
 *   sample(tl, t) → Scene    取样期：各轨道插值 + 物理求解（液面、液流、冰块），
 *                            产出世界坐标下可直接绘制的画面
 *
 * 不可妥协的规则：
 *   ① seek 是 O(log n)：每条轨道二分定位、两端插值，不重放历史。
 *   ② 一切随时间变化的量都是 t 的纯函数 —— 粒子、振荡、液流前缘、落冰都按绝对时间求值，
 *      拖时间轴来回不会漂移。
 *   ③ 渲染器不做几何决策，只按 Scene 里的世界坐标画。几何只有一份，在这个包里。
 */
import type { ContainerId, Texture, VocabLookup } from "@shaker/recipe-ir/core";

/* ════════════════════════════ 顶层 ════════════════════════════ */

export interface Timeline {
  totalMs: number;
  /** 与 IR steps 一一对应，末尾追加 `__final` 定格段。只划定时间段与文案。 */
  steps: TimelineStep[];
  /** 成品定格段末帧（= totalMs），截封面用（ADR-015）。 */
  finalSceneMs: number;
  stage: StageLayout;
  /** 本时间轴用到的全部器具剖面（舞台单位），渲染器据此画，不再需要词表。 */
  shapes: Record<string, ShapeData>;
  vessels: VesselTrack[];
  tools: ToolTrack[];
  streams: StreamSpec[];
  effects: Effect[];
}

/**
 * 器具剖面（已换算成舞台单位）。几何的唯一来源：液面求解、冰块堆积、
 * 渲染器画杯壁都用这一份，不再各自插值。
 */
export interface ShapeData {
  id: string;
  /** 碗身高度（舞台单位）。局部原点在碗底中心，柱脚画在原点下方。 */
  height: number;
  /**
   * 这只器具的「舞台单位 / 厘米」。玻璃杯按真实尺寸 = 20；工作器具（摇壶、搅拌杯）
   * 为了放进吧台被画小了，比 20 小 —— 冰块、吧勺这类按真实厘米定尺寸的东西要用它换算，
   * 否则 2.6cm 的方冰塞进缩小过的搅拌杯就只能摞成一竖条。
   */
  cm: number;
  capacityMl: number;
  /** 半径采样：radii[i] 是 v = i/(n−1)·height 处的半径（舞台单位）。 */
  radii: number[];
  stem: { height: number; width: number } | null;
  base: { radius: number } | null;
  material: "glass" | "metal" | "bottle";
  /** 酒瓶：瓶颈起点（归一化高度），渲染器在这里收窄、画标签。 */
  neckAt?: number;
}

export interface TimelineStep {
  stepId: string;
  action: string;
  startMs: number;
  durationMs: number;
  label: { zh: string; en: string };
}

/** 舞台布局：渲染器画背景（酒架、台面）要用，几何定义只在 core。 */
export interface StageLayout {
  width: number;
  height: number;
  /** 台面线（静置器皿最低点所在的 y）。 */
  counterY: number;
  /** 后墙酒架隔板：板面 y 与横向范围。 */
  shelves: { y: number; x0: number; x1: number }[];
}

/* ════════════════════════════ 轨道 ════════════════════════════ */

export type Ease = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";

/** 一条关键帧轨道。`t` 是时间轴绝对毫秒，`ease` 作用于到下一帧的区间。 */
export interface Track<T> {
  keys: { t: number; v: T; ease: Ease }[];
}

/**
 * 器具姿态。(x, y) = 局部原点（碗底中心）的世界坐标；rot = 顺时针倾角（弧度）。
 * 局部坐标 (u 向右, v 向上) → 世界：wx = x + u·cos + v·sin，wy = y + u·sin − v·cos。
 */
export interface Pose {
  x: number;
  y: number;
  rot: number;
  /** 缩放：架上的酒瓶远一些、小一些。 */
  scale: number;
  opacity: number;
  /** 绘制层级：0 = 后墙酒架，1 = 台面，2 = 手持（在台面器具之前）。 */
  z: number;
}

/** 一次液面扰动：t 起 120ms 升到 peak，保持 dur，之后指数衰减（时间常数 450ms）。 */
export interface Impulse {
  t: number;
  dur: number;
  peak: number;
}

/**
 * 叠加在姿态上的周期运动（摇和、涮杯、搅拌），按绝对时间求值，相位天然连续。
 * 位移沿局部轴：`along` 沿器具轴线（摇和往复），`across` 横向。
 */
export interface Osc {
  freqHz: number;
  along: number;
  across: number;
  rot: number;
  /** 波形：sine 平滑往复；snap 两端急停（摇和：冰块撞到壶两头的那一下）。 */
  wave: "sine" | "snap";
}

/* ════════════════════════════ 器具（容器 / 量酒器 / 酒瓶） ════════════════════════════ */

export type VesselKind = "container" | "jigger" | "bottle";

export interface VesselTrack {
  /** 容器用 ContainerId；量酒器 `jigger`；酒瓶 `bottle:<ingredientId>`。 */
  id: string;
  kind: VesselKind;
  /** 剖面 id（杯型 / 工作器具 / 酒瓶素材）。 */
  shapeId: string;
  /** 器具绝对高度（舞台单位）。 */
  height: number;
  pose: Track<Pose>;
  osc: Track<Osc>;
  /** 语义内容快照：只由状态机按时间顺序写入。 */
  contents: Track<Contents>;
  /**
   * 液面波动的冲量（倒酒、落冰、搅拌各激起一次）。用冲量和而不是关键帧，
   * 这样重叠编排的动作互不覆盖：agitation(t) = Σ 冲量包络，取样时求和。
   */
  agitation: Impulse[];
  /** 0..1：摇和 / 搅拌机中，冰块在罐内乱撞、液体被打成气泡。 */
  tumble: Track<number>;
  /** 0..1：搅拌中，冰块绕杯轴转、液面中心微陷。 */
  swirl: Track<number>;
  /** 0 / 1：盖子（摇壶盖、搅拌机盖）。中间值 = 盖子正在落下 / 揭起。 */
  lid: Track<number>;
  frost: Track<number>;
  /** 杯内烟雾浓度 0..1。 */
  smoke: Track<number>;
  /** 冰的各个「时代」：每次加冰、转移都开一段。 */
  ice: IceEpoch[];
  /** 酒瓶外观（kind = bottle）。 */
  bottle?: BottleLook;
}

export interface BottleLook {
  liquid: string;
  glass: string;
  label: string;
  cap: string;
  /** 苦精瓶：倒出是一滴一滴的。 */
  dasher: boolean;
}

/** 一段时间内容器里的冰（局部坐标）。 */
export interface IceEpoch {
  fromMs: number;
  toMs: number;
  pieces: IcePiece[];
  /** 冰堆顶面（局部 v）：液面高过它，整堆开始上浮。 */
  topV: number;
}

export interface IcePiece {
  kind: "cube" | "large_cube" | "sphere" | "cracked" | "crushed" | "block" | "dry_ice";
  /** 局部坐标（舞台单位）：u 相对中轴，v 相对碗底，指块中心。 */
  u: number;
  v: number;
  /** 宽、高（舞台单位）。 */
  w: number;
  h: number;
  rot: number;
  /** 外形 seed：碎冰/裂冰的不规则轮廓由它决定。 */
  seed: number;
  /** 0 = 后排（被前排挡住、偏暗），1 = 前排。侧视图里冰块有前后两层才有体积感。 */
  depth: 0 | 1;
  /** 开始下落的绝对时刻；之前不可见。已在杯中的冰为 -Infinity。 */
  dropAt: number;
  /** 下落起点（局部坐标）。 */
  dropFromU: number;
  dropFromV: number;
  /** 离开这个容器的时刻（连冰倒走、被打成冰沙）；之后不可见。 */
  leaveAt: number;
}

/** 容器内容（语义快照，可插值）。 */
export interface Contents {
  layers: LayerState[];
  /** 冰实体积 —— 抬高液面（ADR-014 的排水模型）。 */
  iceSolidMl: number;
  icePorosity: number;
  foamMl: number;
  foamColor: string;
  /** 0..1：液层间过渡带宽度。 */
  mixedness: number;
  rim: { coverage: "full" | "half"; color: string } | null;
  coat: { color: string; strength: number } | null;
  garnishes: GarnishState[];
  /** 投进杯里的固体（薄荷叶、青柠角……）。 */
  solids: SolidState[];
}

export interface LayerState {
  /** 稳定 id：插值按它配对，混匀时旧层缩成 0、新层从 0 长出。 */
  uid: number;
  ml: number;
  color: string;
  opacity: number;
  density: number;
  carbonation: number;
  texture: Texture;
  sourceSlots: string[];
}

export interface GarnishState {
  garnishId: string;
  position: "rim" | "in_glass" | "float" | "skewer" | "side";
  prep: string;
  color: string;
  /** 串签姿态（作者显式指定）；缺省时取样按杯口宽度物理判定。 */
  skewerStyle?: "across" | "lean";
  /** 开始落位的绝对时刻（之前不可见）。 */
  addedAt: number;
}

export interface SolidState {
  sprite: "leaf" | "wedge" | "wheel" | "berry" | "cube";
  color: string;
  /** 局部 u（舞台单位），落在杯底附近。 */
  u: number;
  rot: number;
  addedAt: number;
  /** 0..1：被捣压的程度。 */
  bruised: number;
  slot: string;
}

/* ════════════════════════════ 工具 ════════════════════════════ */

export type ToolKind =
  | "barspoon"
  | "float_spoon"
  | "muddler"
  | "swizzle"
  | "hawthorne"
  | "julep"
  | "fine_strainer"
  | "scoop"
  | "spray"
  | "lighter"
  | "peel"
  | "smoke_gun"
  | "cloche"
  | "rim_plate"
  | "blender_base";

export interface ToolTrack {
  id: string;
  kind: ToolKind;
  /** 杆状工具的杆长、器皿类工具的宽（舞台单位）。 */
  size: number;
  color?: string;
  pose: Track<Pose>;
  osc: Track<Osc>;
  /**
   * 时间段内挂在某个器具上（滤网卡在摇壶口、搅拌机座托着杯身）：取样时姿态由
   * 器具姿态 ∘ 局部偏移算出，器具怎么转它就怎么跟 —— 不靠两条轨道各自插值去凑。
   */
  attach: { vessel: string; fromMs: number; toMs: number; u: number; v: number; rot: number }[];
}

/* ════════════════════════════ 液流 ════════════════════════════ */

/**
 * 一段倒注。几何不在编译期定死：出口取源器具当时的口沿最低点，
 * 落点取目标当时的液面，轨迹按抛体运动求（ADR-031）。
 */
export interface StreamSpec {
  /** 源器具 id，或工具 id（细滤网尖、浮注吧勺缘）。 */
  from: string;
  /** 目标器具 id，或工具 id（细滤网、浮注吧勺背），或台面（倒掉）。 */
  to: string | "counter";
  startMs: number;
  endMs: number;
  color: string;
  /** 出口截面宽（舞台单位）。 */
  width: number;
  /** pour 连续液柱；drops 逐滴（苦精）；gentle 贴着勺背的细流。 */
  mode: "pour" | "drops" | "gentle";
  /** 出口水平速度（舞台单位/秒），粘稠的慢。 */
  speed: number;
  /** drops 模式的滴数。 */
  count?: number;
}

/* ════════════════════════════ 粒子效果 ════════════════════════════ */

export type EffectKind = "smoke" | "flame" | "mist" | "sparks" | "splash" | "chill";

export interface Effect {
  kind: EffectKind;
  seed: number;
  startMs: number;
  endMs: number;
  rate: number;
  /** 发射区域（世界坐标）。 */
  region: { x: number; y: number; w: number; h: number };
  drift: { vx: number; vy: number };
  size: { min: number; max: number };
  color: string;
  opacity: number;
}

/* ════════════════════════════ 取样结果 ════════════════════════════ */

export interface Scene {
  tMs: number;
  stage: StageLayout;
  /** 器具剖面（引用 Timeline.shapes，不复制）。 */
  shapes: Record<string, ShapeData>;
  /** 按绘制顺序排好（后墙 → 前景）。 */
  vessels: VesselView[];
  tools: ToolView[];
  streams: StreamView[];
  effects: Effect[];
  /** 整屏震动（舞台单位），剧烈摇和时非零。 */
  screenShake: { x: number; y: number };
  /** 成品定格进度 0..1（`__final` 段内），否则 undefined。 */
  serve?: number;
}

export interface VesselView {
  id: string;
  kind: VesselKind;
  shapeId: string;
  height: number;
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  z: number;
  /** 液层，自下而上；`topY` 是该层上表面的世界 y（水平面）。 */
  layers: LayerView[];
  ice: IceView[];
  /** 泡沫冠上表面（世界 y），下表面即液面。 */
  foam: { topY: number; color: string } | null;
  frost: number;
  mixedness: number;
  agitation: number;
  tumble: number;
  swirl: number;
  /** 0..1 */
  lid: number;
  rim: Contents["rim"];
  coat: Contents["coat"];
  smoke: number;
  garnishes: GarnishView[];
  solids: SolidView[];
  bottle?: BottleLook;
}

export interface LayerView {
  topY: number;
  color: string;
  opacity: number;
  texture: Texture;
  carbonation: number;
  sourceSlots: string[];
}

export interface IceView {
  kind: IcePiece["kind"];
  /** 世界坐标中心。 */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  seed: number;
  depth: 0 | 1;
  /** 中心是否已浸入液面以下（渲染器据此决定冰下透出的颜色）。 */
  submerged: boolean;
}

export interface GarnishView {
  garnishId: string;
  position: GarnishState["position"];
  prep: string;
  color: string;
  /** 世界坐标锚点（sprite 底边中点）与旋转。 */
  x: number;
  y: number;
  rot: number;
  opacity: number;
  /** 串签（position = skewer 且 sprite 不自带签）：世界坐标线段，渲染端画在 sprite 底下。 */
  stick?: { x1: number; y1: number; x2: number; y2: number };
  /** 串签姿态：across 横架杯口（sprite 顶行对齐签）、lean 斜靠杯壁（sprite 中心对齐锚点）。 */
  skewerPose?: "across" | "lean";
}

export interface SolidView {
  sprite: SolidState["sprite"];
  color: string;
  x: number;
  y: number;
  rot: number;
  bruised: number;
}

export interface ToolView {
  id: string;
  kind: ToolKind;
  size: number;
  color?: string;
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  z: number;
  /** 周期运动的当前相位 0..1（搅棒自旋、捣棒下压的画法要用）。 */
  phase: number;
}

export interface StreamView {
  from: string;
  to: string;
  color: string;
  mode: StreamSpec["mode"];
  /** 液柱中心线采样点（世界坐标，自上而下）与每点宽度。 */
  points: { x: number; y: number; w: number }[];
  /** 落点（液柱已触及目标时）：渲染器画水花。 */
  impact: { x: number; y: number; strength: number } | null;
}

/* ════════════════════════════ 编译输入 ════════════════════════════ */

export type ResolvedVocab = VocabLookup;

export interface CompileOptions {
  /** 播放速度倍率，> 1 更快。 */
  speedScale?: number;
  /** 舞台逻辑尺寸，默认 400×520。 */
  stage?: { width: number; height: number };
}

export type { ContainerId };
