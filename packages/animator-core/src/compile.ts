/**
 * IR → Timeline 编译器。
 *
 * **这是纯函数**（规范 §9.2）：无 IO、无随机、无 Date.now()、不 import 任何渲染 API。
 * 同一份输入在浏览器、Node、WebView 里必须产出逐字节相同的 Timeline。
 */
import {
  heightForVolume,
  physics,
  type ContainerId,
  type IngredientRef,
  type RecipeIR,
  type Step,
  type VesselSpec,
} from "@shaker/recipe-ir/core";
import { stepLabel } from "./labels.ts";
import {
  addIce,
  addToContainer,
  buildFoam,
  dilute,
  hashString,
  iceSolidMl,
  killCarbonation,
  liquidCapacityMl,
  liquidMl,
  mix,
  newContainer,
  transfer,
  type ContainerState,
} from "./state.ts";
import type {
  CompileOptions,
  Effect,
  Keyframe,
  Prop,
  RenderedContainer,
  RenderedLayer,
  ResolvedVocab,
  Scene,
  Timeline,
  TimelineStep,
} from "./types.ts";

/* ────────────────────────── 舞台布局 ────────────────────────── */

const DEFAULT_STAGE = { width: 400, height: 520 };
/** 剖面 scale 的单位是厘米（见 glass.ts），这里换算到舞台单位。 */
const UNITS_PER_CM = 20;
/** 主位置：舞台中下。 */
const MAIN_POS = { x: 200, y: 448 };
/** 双容器并列时的左右位置。 */
const LEFT_POS = { x: 126, y: 448 };

/**
 * 台面线的舞台 y —— 渲染器 buffer 高 = stage.height / 4（PS），台面线在倒数第 14 行
 * （见 animator-web drawBackdrop）。与 DEFAULT_STAGE.height=520 对应 464。
 */
const COUNTER_Y = DEFAULT_STAGE.height - 14 * 4;

/**
 * 器皿最低像素到碗底（液体零点、RenderedContainer.y）的落差：
 * 高脚杯是柱脚 + 底座（≈1 像素行），无脚杯是厚底一行（4 舞台单位）。
 * 与渲染器 drawContainer 的柱脚/底座画法保持一致。
 */
function footDrop(vessel: VesselSpec): number {
  const stem = vessel.def.shape.stem;
  return stem ? stem.height * vessel.scale * UNITS_PER_CM + 4 : 4;
}

/** 静置容器的碗底舞台 y —— 任何杯型放在台面上时，最低点都落在同一条台面线上。 */
function restBowlY(vessel: VesselSpec): number {
  return COUNTER_Y - footDrop(vessel);
}

/** 工作容器的内置定义（不在 glassware 词表里）。 */
export const WORK_VESSEL_IDS: Record<Exclude<ContainerId, "glass">, string> = {
  shaker: "__shaker",
  mixing_glass: "__mixing_glass",
  blender: "__blender",
  secondary: "__secondary",
};

/* ────────────────────────── 主入口 ────────────────────────── */

export function compile(ir: RecipeIR, vocab: ResolvedVocab, opts: CompileOptions = {}): Timeline {
  const stage = opts.stage ?? DEFAULT_STAGE;
  const speed = opts.speedScale && opts.speedScale > 0 ? opts.speedScale : 1;

  const bySlot = new Map<string, IngredientRef>(ir.ingredients.map((r) => [r.slot, r]));
  const containers = new Map<ContainerId, ContainerState>();

  const ensure = (id: ContainerId): ContainerState => {
    let c = containers.get(id);
    if (c) return c;
    const vesselId = id === "glass" ? ir.glass : WORK_VESSEL_IDS[id];
    const vessel = vocab.vessel(vesselId);
    if (!vessel) throw new Error(`容器 ${id} 的杯型 "${vesselId}" 不在词表中`);
    c = newContainer(id, vessel);
    containers.set(id, c);
    return c;
  };

  // 成品杯从一开始就存在（但 active=false，不绘制），这样 focus 总有落点
  ensure("glass");

  const steps: TimelineStep[] = [];
  let cursorMs = 0;

  for (const step of ir.steps) {
    // 扰动衰减：上一步动作留下的余波（波浪/冰块晃动）逐步平息
    for (const c of containers.values()) {
      if (c.active) c.agitation = Math.max(0, c.agitation * 0.3);
    }
    const emit = new StepEmitter(step, containers, stage);
    applyStep(step, { containers, ensure, bySlot, vocab, emit });

    const durationMs = Math.max(120, Math.round(emit.durationMs / speed));
    // emit.at 拍下的效果用步骤内相对时间 —— 这里换成时间轴绝对时间（渲染器按 fxMs 取样）
    const shifted = new Set<Effect>();
    for (const f of emit.frames) {
      for (const e of f.scene.effects) {
        if (shifted.has(e)) continue;
        shifted.add(e);
        e.startMs += cursorMs;
        e.endMs += cursorMs;
      }
    }
    steps.push({
      stepId: step.id,
      action: step.action,
      startMs: cursorMs,
      durationMs,
      label: stepLabel(step, bySlot, vocab),
      keyframes: emit.finish(durationMs),
    });
    cursorMs += durationMs;
  }

  // 成品定格：给一段静止时间，供截封面图（ADR-015）
  const holdMs = Math.round(900 / speed);
  const finalScene = toScene(containers, "glass", [], collectEffects(containers, 0, holdMs, stage));
  steps.push({
    stepId: "__final",
    action: "SERVE",
    startMs: cursorMs,
    durationMs: holdMs,
    label: { zh: "完成", en: "Serve" },
    keyframes: [
      { tMs: 0, scene: finalScene, ease: "linear" },
      { tMs: holdMs, scene: finalScene, ease: "linear" },
    ],
  });

  return {
    totalMs: cursorMs + holdMs,
    finalSceneMs: cursorMs,
    steps,
    stage,
  };
}

/* ────────────────────────── 步骤发射器 ────────────────────────── */

/**
 * 收集一个步骤内的关键帧。
 *
 * 用法：`emit.at(0.0, {...})` 传归一化时刻，`finish(durationMs)` 时换算成绝对毫秒。
 * 这样步骤内的编排不用关心最终时长（会被 speedScale 缩放）。
 */
class StepEmitter {
  /**
   * 已收集的帧。公开是刻意的 —— 后处理（摇晃姿态、装饰落位、派生效果）
   * 需要回头修改已拍下的帧，那些逻辑放在类外更好读。
   */
  readonly frames: { t: number; scene: Scene; ease: Keyframe["ease"] }[] = [];
  /** 该步骤的建议时长（毫秒），由 applyStep 设置。 */
  durationMs: number;
  // 显式字段而非 TS 参数属性 —— node --experimental-strip-types 不支持参数属性
  // （那需要类型导向的代码生成）。这条约束适用于全仓所有会被 node 直接跑的 TS。
  private readonly containers: Map<ContainerId, ContainerState>;
  private readonly stage: { width: number; height: number };

  constructor(
    step: Step,
    containers: Map<ContainerId, ContainerState>,
    stage: { width: number; height: number },
  ) {
    this.containers = containers;
    this.stage = stage;
    this.durationMs = defaultDuration(step);
  }

  /** 在归一化时刻 t（0..1）拍一张快照。 */
  at(
    t: number,
    o: { focus: ContainerId; props?: Prop[]; effects?: Effect[]; ease?: Keyframe["ease"] },
  ): void {
    this.frames.push({
      t,
      scene: toScene(this.containers, o.focus, o.props ?? [], o.effects ?? []),
      ease: o.ease ?? "easeInOut",
    });
  }

  finish(durationMs: number): Keyframe[] {
    if (this.frames.length === 0) {
      // 兜底：至少两帧，避免渲染器拿到空区间
      const s = toScene(this.containers, "glass", [], []);
      return [
        { tMs: 0, scene: s, ease: "linear" },
        { tMs: durationMs, scene: s, ease: "linear" },
      ];
    }
    const out = this.frames.map((f) => ({
      tMs: Math.round(Math.max(0, Math.min(1, f.t)) * durationMs),
      scene: f.scene,
      ease: f.ease,
    }));
    // 保证首尾帧存在
    if (out[0]!.tMs > 0) out.unshift({ ...out[0]!, tMs: 0 });
    const last = out[out.length - 1]!;
    if (last.tMs < durationMs) out.push({ ...last, tMs: durationMs });
    // 追加时间衰减的烟雾/粒子效果区间由 collectEffects 统一处理
    void this.stage;
    return out;
  }
}

function defaultDuration(step: Step): number {
  const d = physics.DEFAULT_ANIM_MS[step.action as keyof typeof physics.DEFAULT_ANIM_MS];
  if ("durationSec" in step && step.durationSec !== undefined) {
    return physics.realToAnimMs(step.durationSec, d ?? 800);
  }
  if (step.action === "ADD" || step.action === "FLOAT" || step.action === "TOP_UP") {
    // 倒注时长按原料数量加权，但设上限避免六种原料的配方拖太久
    const n = "items" in step ? step.items.length : 1;
    return Math.min(2400, (d ?? 700) * Math.min(3, 0.6 + n * 0.5));
  }
  return d ?? 800;
}

/* ────────────────────────── 状态 → 场景 ────────────────────────── */

function toScene(
  containers: Map<ContainerId, ContainerState>,
  focus: ContainerId,
  props: Prop[],
  effects: Effect[],
): Scene {
  const rendered: RenderedContainer[] = [];
  const active = [...containers.values()].filter((c) => c.active);

  for (const c of containers.values()) {
    if (!c.active) continue;
    const pos = positionFor(c, focus, active);
    rendered.push({
      id: c.id,
      vesselId: c.vessel.def.id,
      x: pos.x,
      y: pos.y,
      height: c.vessel.scale * UNITS_PER_CM,
      scale: 1,
      opacity: 1,
      tilt: 0,
      shake: null,
      frost: frostLevel(c),
      layers: layerBands(c),
      ice: c.ice.map((i) => ({
        kind: i.kind,
        x: i.x,
        y: i.y,
        size: i.size,
        rot: i.rot,
        opacity: 0.82,
      })),
      foam: foamBand(c),
      rim: c.rim,
      // 装饰来自容器状态：加入后跨步骤持久存在（GARNISH 步骤内的落位动画由 attachGarnish 覆写）
      garnishes: c.garnishes.map((g) => ({
        garnishId: g.garnishId,
        position: g.position,
        prep: g.prep,
        dx: 0,
        dy: 0,
        rot: 0,
        opacity: 1,
        color: g.color,
      })),
      smoke: c.smokeDensity,
      lidOn: c.lidOn,
      agitation: c.agitation,
    });
  }

  return { focus, containers: rendered, props, effects };
}

function positionFor(
  c: ContainerState,
  focus: ContainerId,
  active: ContainerState[],
): { x: number; y: number } {
  const others = active.filter((o) => o.id !== c.id);
  if (others.length === 0) return { x: MAIN_POS.x, y: restBowlY(c.vessel) };
  // 焦点容器占主位，其余靠左；更多容器时挤在左侧（v1 不会超过两个同时活跃）
  if (c.id === focus) return { x: MAIN_POS.x, y: restBowlY(c.vessel) };
  return { x: LEFT_POS.x, y: restBowlY(c.vessel) };
}

function frostLevel(c: ContainerState): number {
  if (c.temperatureC >= physics.TEMP_FROST_THRESHOLD_C) return 0;
  const span = physics.TEMP_FROST_THRESHOLD_C - physics.TEMP_SWIZZLE_C;
  return Math.max(0, Math.min(1, (physics.TEMP_FROST_THRESHOLD_C - c.temperatureC) / span));
}

/**
 * 液体在杯中实际占据的体积 —— **必须含冰的实体积**。
 *
 * 冰把液面顶上去：一杯塞满碎冰的柯林斯杯里，131ml 液体的液面接近杯口，
 * 而不是 131/350 ≈ 三分之一处。液体填充冰之间的孔隙，所以液面对应的是
 * 「液体 + 已浸没的冰」的占位总量。
 */
function occupiedMl(c: ContainerState): number {
  const liquid = Math.min(liquidMl(c), liquidCapacityMl(c));
  return Math.min(c.vessel.def.capacityMl, liquid + iceSolidMl(c));
}

/**
 * 把液层体积换算成归一化高度带。
 *
 * 两个关键点：
 *
 * **① 每个带的边界都走 heightForVolume 的非线性映射**，不是按体积比例线性分配。
 *    马天尼杯里等体积的两层，上面那层薄得多。
 *
 * **② 各层在体积空间里按 occupied/liquid 的比例整体拉伸**，这样冰的排开效果
 *    均匀分摊到每一层，顶层上边界正好落在真实液面。
 *
 * 冰融水视为均匀混入（已稀释的酒必然已混匀），一并按比例放大。
 */
function layerBands(c: ContainerState): RenderedLayer[] {
  const sumLayers = c.layers.reduce((s, l) => s + l.volumeMl, 0);
  if (sumLayers <= 0) return [];
  const stretch = occupiedMl(c) / sumLayers;

  // mixedness 越高，层间过渡带越宽；FLOAT 产生的层保持锐利
  const blend = 0.004 + c.mixedness * 0.05;

  const out: RenderedLayer[] = [];
  let vAcc = 0;
  for (const l of c.layers) {
    const v0 = vAcc;
    const v1 = vAcc + l.volumeMl * stretch;
    vAcc = v1;
    out.push({
      fromH: heightForVolume(c.vessel, v0),
      toH: heightForVolume(c.vessel, v1),
      color: l.color,
      opacity: l.opacity,
      blend,
      carbonation: l.carbonation,
      texture: l.texture,
      sourceSlots: [...l.sourceSlots],
    });
  }
  return out;
}

function foamBand(c: ContainerState): RenderedContainer["foam"] {
  if (c.foamMl <= 0.5) return null;
  const surface = occupiedMl(c);
  const fromH = heightForVolume(c.vessel, surface);
  const toH = heightForVolume(c.vessel, Math.min(surface + c.foamMl, c.vessel.def.capacityMl));
  if (toH <= fromH) return null;
  return { fromH, toH, color: "#fbf8f2" };
}

/* ────────────────────────── 效果 ────────────────────────── */

/**
 * 从容器状态收集粒子效果。
 *
 * 效果是**参数化发射器**，不是粒子列表 —— 渲染时按 t 和 seed 确定性算出位置。
 * 这是「粒子必须是 t 的纯函数」纪律的落点（规范 §9.1）。
 */
function collectEffects(
  containers: Map<ContainerId, ContainerState>,
  startMs: number,
  endMs: number,
  stage: { width: number; height: number },
): Effect[] {
  const out: Effect[] = [];
  for (const c of containers.values()) {
    if (!c.active) continue;
    const h = c.vessel.scale * UNITS_PER_CM;
    const radius = c.vessel.def.shape.profile[c.vessel.def.shape.profile.length - 1]!.r * h;

    // 气泡：**任何**含气液层都会冒泡，不只是最上层。
    // 只看顶层是错的 —— 苏打水密度 1.0，排序后往往在烈酒（0.94）下面，
    // 那样一杯 Mojito 会一个气泡都没有。
    const carbonatedMl = c.layers.reduce(
      (s, l) => s + (l.carbonation > 0.05 ? l.volumeMl * l.carbonation : 0),
      0,
    );
    if (carbonatedMl > 0.5) {
      const surfaceH = heightForVolume(c.vessel, occupiedMl(c));
      out.push({
        kind: "bubbles",
        seed: hashString(`bubbles:${c.id}`),
        startMs,
        endMs,
        rate: (physics.BUBBLE_RATE_PER_100ML * carbonatedMl) / 100,
        region: {
          x: MAIN_POS.x - radius * 0.8,
          y: restBowlY(c.vessel) - surfaceH * h * 0.9,
          w: radius * 1.6,
          h: surfaceH * h * 0.85,
        },
        drift: { vx: 0, vy: -34 },
        size: { min: 1.2, max: 3.4 },
        color: "#ffffff",
        opacity: 0.5,
      });
    }

    // 烟雾：杯口溢出后沿壁下沉（重烟）
    if (c.smokeDensity > 0.05) {
      out.push({
        kind: "smoke",
        seed: hashString(`smoke:${c.id}`),
        startMs,
        endMs,
        rate: 16 * c.smokeDensity,
        region: { x: MAIN_POS.x - radius, y: restBowlY(c.vessel) - h, w: radius * 2, h: h * 0.25 },
        drift: { vx: 6, vy: c.lidOn ? -4 : 10 },
        size: { min: 6, max: 18 },
        color: "#e8eef2",
        opacity: 0.3 * c.smokeDensity,
      });
    }

    // 喷雾残留
    if (c.aromaMist > 0.05) {
      out.push({
        kind: "mist",
        seed: hashString(`mist:${c.id}`),
        startMs,
        endMs: startMs + Math.min(endMs - startMs, 900),
        rate: 40 * c.aromaMist,
        region: { x: MAIN_POS.x - radius, y: restBowlY(c.vessel) - h * 1.25, w: radius * 2, h: h * 0.3 },
        drift: { vx: 0, vy: 18 },
        size: { min: 0.6, max: 1.6 },
        color: "#fff6d8",
        opacity: 0.35 * c.aromaMist,
      });
    }
  }
  void stage;
  return out;
}

/* ────────────────────────── 步骤语义 + 编排 ────────────────────────── */

interface Ctx {
  containers: Map<ContainerId, ContainerState>;
  ensure: (id: ContainerId) => ContainerState;
  bySlot: Map<string, IngredientRef>;
  vocab: ResolvedVocab;
  emit: StepEmitter;
}

function refsOf(slots: readonly string[], bySlot: Map<string, IngredientRef>): IngredientRef[] {
  return slots.map((s) => bySlot.get(s)).filter((r): r is IngredientRef => r !== undefined);
}

function applyStep(step: Step, ctx: Ctx): void {
  const { ensure, bySlot, vocab, emit, containers } = ctx;
  const stage = DEFAULT_STAGE;

  switch (step.action) {
    /* ── 准备 ── */
    case "CHILL": {
      const c = ensure(step.target);
      c.active = true;
      emit.at(0, { focus: c.id });
      c.temperatureC = physics.TEMP_CHILLED_C;
      emit.at(1, { focus: c.id });
      break;
    }

    case "RIM": {
      const c = ensure(step.target);
      c.active = true;
      const mat = bySlot.get(step.material);
      const color = (mat && vocab.ingredient(mat.ingredientId)?.viz.color) ?? "#ffffff";
      emit.at(0, { focus: c.id });
      c.rim = { coverage: step.coverage ?? "full", color };
      emit.at(1, { focus: c.id });
      break;
    }

    case "RINSE": {
      const c = ensure(step.target);
      const refs = refsOf(step.items, bySlot);
      emit.at(0, { focus: c.id });
      addToContainer(c, refs, vocab);
      emit.at(0.5, { focus: c.id, props: [swirlProp(c)] });
      if (step.discard) {
        // 倒掉多余，只留挂壁着色
        const tint = c.layers[c.layers.length - 1];
        c.layers = tint ? [{ ...tint, volumeMl: 2, opacity: 0.35 }] : [];
      }
      emit.at(1, { focus: c.id });
      break;
    }

    /* ── 装填 ── */
    case "ADD": {
      const c = ensure(step.target);
      const refs = refsOf(step.items, bySlot);
      c.active = true;
      c.agitation = 0.55; // 倒酒激起液面波纹
      if (refs.length <= 1 || step.pour === "simultaneous") {
        emit.at(0, { focus: c.id, props: [pourProp(c, refs, vocab, 0)] });
        emit.at(0.18, { focus: c.id, props: [pourProp(c, refs, vocab, 1)], ease: "easeOut" });
        addToContainer(c, refs, vocab);
        emit.at(0.86, { focus: c.id, props: [pourProp(c, refs, vocab, 1)] });
        emit.at(1, { focus: c.id, props: [pourProp(c, refs, vocab, 0)] });
      } else {
        // 默认逐个倒：吧台上本来就是一种一种来，同时倒只响应显式 pour: "simultaneous"。
        // 每种原料一段：抬起 → 保持倒入（状态在此刻变更）→ 收回，段与段之间不跳变。
        const n = refs.length;
        for (let k = 0; k < n; k++) {
          const one = [refs[k]!];
          const t0 = (k / n) * 0.88;
          const t1 = ((k + 1) / n) * 0.88;
          emit.at(t0, { focus: c.id, props: [pourProp(c, one, vocab, 0)] });
          emit.at(t0 + (t1 - t0) * 0.28, { focus: c.id, props: [pourProp(c, one, vocab, 1)], ease: "easeOut" });
          addToContainer(c, one, vocab);
          emit.at(t1 - (t1 - t0) * 0.12, { focus: c.id, props: [pourProp(c, one, vocab, 1)] });
          emit.at(t1, { focus: c.id, props: [pourProp(c, one, vocab, 0)] });
        }
        emit.at(1, { focus: c.id, props: [] });
      }
      break;
    }

    case "ICE": {
      const c = ensure(step.target);
      c.active = true;
      addIce(c, step.iceType, step.fill);

      // 落冰编排：杯口上方 → 自由落体 → 冲击下压（碰撞）→ 回弹 → 静止
      const rest = c.ice.map((i) => ({ ...i }));
      const lifted = rest.map((i) => ({ ...i, y: 1.25 }));
      const sunk = rest.map((i) => ({ ...i, y: Math.max(0.02, i.y - 0.07) }));
      const landT = 0.5;

      // 水花：冲击液面时溅起（粒子是 fxMs 的纯函数，可 seek）
      const h = c.vessel.scale * UNITS_PER_CM;
      const radius = c.vessel.def.shape.profile[c.vessel.def.shape.profile.length - 1]!.r * h;
      const surfaceH = heightForVolume(c.vessel, occupiedMl(c));
      const splashMs = Math.round(landT * emit.durationMs);
      const splash: Effect = {
        kind: "splash",
        seed: hashString(`splash:${step.id}`),
        startMs: splashMs,
        endMs: splashMs + 700,
        rate: 14,
        region: {
          x: MAIN_POS.x - radius * 0.75,
          y: restBowlY(c.vessel) - Math.max(0.04, surfaceH) * h - 3,
          w: radius * 1.5,
          h: 6,
        },
        drift: { vx: 0, vy: 0 },
        size: { min: 1, max: 2 },
        color: c.layers.length > 0 ? c.layers[c.layers.length - 1]!.color : "#dceef8",
        opacity: 0.9,
      };
      c.ice = lifted;
      emit.at(0, { focus: c.id, effects: [splash] });
      c.ice = rest;
      emit.at(landT, { focus: c.id, ease: "easeIn", effects: [splash] });
      c.ice = sunk;
      c.agitation = 0.95;
      emit.at(landT + 0.12, { focus: c.id, ease: "easeOut", effects: [splash] });
      c.ice = rest;
      c.agitation = 0.5;
      emit.at(1, { focus: c.id, effects: [splash] });
      break;
    }

    case "MUDDLE": {
      const c = ensure(step.target);
      const refs = refsOf(step.items, bySlot);
      c.active = true;
      c.agitation = 0.6; // 捣压搅动
      emit.at(0, { focus: c.id, props: [muddlerProp(c, 0)] });
      emit.at(0.3, { focus: c.id, props: [muddlerProp(c, 1)] });
      // firm 捣压出汁
      if (step.intensity === "firm") {
        const juiced = refs.filter((r) => ["piece", "wedge", "slice"].includes(r.unit));
        for (const r of juiced) {
          const count = "amount" in r ? r.amount : 1;
          const meta = vocab.ingredient(r.ingredientId);
          if (!meta) continue;
          addToContainer(
            c,
            [{ ...r, unit: "ml", amount: count * physics.MUDDLE_JUICE_YIELD_ML.firm } as IngredientRef],
            vocab,
          );
        }
      }
      emit.at(0.7, { focus: c.id, props: [muddlerProp(c, 0.4)] });
      emit.at(1, { focus: c.id, props: [] });
      break;
    }

    /* ── 混合 ── */
    case "SHAKE": {
      const c = ensure(step.target);
      c.active = true;
      const intensity = step.intensity ?? "standard";
      const refs = [...bySlot.values()];

      c.lidOn = true;
      c.agitation = 1; // 剧烈摇晃：冰块乱撞、液面狂乱
      emit.at(0, { focus: c.id });
      // 摇晃姿态由渲染器按 shake 参数叠加正弦，这里只给幅度
      const shakeFrames = 3;
      for (let i = 1; i <= shakeFrames; i++) {
        emit.at((i / (shakeFrames + 1)) * 0.85, { focus: c.id, ease: "linear" });
      }

      if (step.dryShake) {
        buildFoam(c, refs, vocab, physics.FOAM_YIELD.dryShake);
      } else {
        buildFoam(c, refs, vocab, physics.FOAM_YIELD.wetShake);
        const rate =
          physics.SHAKE_DILUTION[intensity] *
          Math.min(1, (step.durationSec ?? physics.SHAKE_REFERENCE_SEC) / physics.SHAKE_REFERENCE_SEC);
        dilute(c, rate);
      }
      mix(c, physics.MIXEDNESS_TARGET.SHAKE, { cloudy: true });
      killCarbonation(c);
      c.lidOn = false;
      emit.at(1, { focus: c.id });
      // 摇晃姿态需要渲染器知道，附加到全部帧
      markShake(emit, c.id, intensity);
      break;
    }

    case "STIR": {
      const c = ensure(step.target);
      c.active = true;
      c.agitation = 0.55; // 搅动液面与冰块
      emit.at(0, { focus: c.id, props: [barspoonProp(c, 0)] });
      emit.at(0.4, { focus: c.id, props: [barspoonProp(c, 1)], ease: "linear" });
      dilute(
        c,
        physics.STIR_DILUTION *
          Math.min(1, (step.durationSec ?? physics.STIR_REFERENCE_SEC) / physics.STIR_REFERENCE_SEC),
      );
      mix(c, physics.MIXEDNESS_TARGET.STIR);
      emit.at(0.9, { focus: c.id, props: [barspoonProp(c, 1)], ease: "linear" });
      emit.at(1, { focus: c.id, props: [] });
      break;
    }

    case "SWIZZLE": {
      const c = ensure(step.target);
      c.active = true;
      c.agitation = 0.6; // 搅拌棒搅动碎冰
      emit.at(0, { focus: c.id, props: [swizzleProp(c)] });
      dilute(c, physics.SWIZZLE_DILUTION);
      mix(c, physics.MIXEDNESS_TARGET.SWIZZLE, { cloudy: true });
      c.temperatureC = physics.TEMP_SWIZZLE_C;
      emit.at(0.85, { focus: c.id, props: [swizzleProp(c)] });
      emit.at(1, { focus: c.id, props: [] });
      break;
    }

    case "ROLL":
    case "THROW": {
      const from = ensure(step.from);
      const to = ensure(step.to);
      from.agitation = 0.5;
      to.active = true; // 倒换前目标杯先到位（占据主位）
      const pourColor = from.layers[0]?.color ?? "#e8d9b0"; // transfer 前捕获
      emit.at(0, { focus: from.id });
      dilute(from, step.action === "ROLL" ? physics.ROLL_DILUTION : physics.THROW_DILUTION);
      mix(from, physics.MIXEDNESS_TARGET[step.action]);
      from.active = false; // 源容器由 pour_vessel 道具接管
      emit.at(0.4, { focus: to.id, props: [pourVesselProp(from, to, pourColor)], ease: "easeIn" });
      transfer(from, to, { carryIce: false });
      to.agitation = 0.55; // 倒进目标杯激起波纹
      emit.at(0.9, { focus: to.id, props: [pourVesselProp(from, to, pourColor)] });
      emit.at(1, { focus: to.id, props: [] });
      break;
    }

    case "BLEND": {
      const c = ensure(step.target);
      c.active = true;
      c.lidOn = true;
      c.agitation = 0.85; // 搅拌机全速搅打
      emit.at(0, { focus: c.id });
      dilute(
        c,
        physics.BLEND_DILUTION *
          Math.min(1, (step.durationSec ?? physics.BLEND_REFERENCE_SEC) / physics.BLEND_REFERENCE_SEC),
      );
      // 冰打成雪泥：体积并入液层，不透明度大幅提升
      c.ice = [];
      mix(c, physics.MIXEDNESS_TARGET.BLEND);
      for (const l of c.layers) {
        l.texture = "creamy";
        l.opacity = Math.min(1, l.opacity + 0.15);
      }
      emit.at(0.5, { focus: c.id, ease: "linear" });
      c.lidOn = false;
      emit.at(1, { focus: c.id });
      break;
    }

    /* ── 转移 ── */
    case "STRAIN": {
      const from = ensure(step.from);
      const to = ensure(step.to);
      to.active = true;
      to.agitation = 0.5; // 滤入激起波纹
      const pourColor = from.layers[0]?.color ?? "#e8d9b0"; // transfer 前捕获
      emit.at(0, { focus: to.id });
      from.active = false; // 摇壶由 pour_vessel + strainer 道具接管
      emit.at(0.2, { focus: to.id, props: strainPourProps(from, to, pourColor), ease: "easeIn" });
      transfer(from, to, {
        carryIce: false,
        fineStrain: step.double === true || step.strainer === "fine",
      });
      emit.at(0.85, { focus: to.id, props: strainPourProps(from, to, pourColor) });
      emit.at(1, { focus: to.id, props: [] });
      break;
    }

    case "DUMP": {
      const from = ensure(step.from);
      const to = ensure(step.to);
      to.active = true;
      to.agitation = 0.7; // 连冰带酒倒入，扰动更强
      const pourColor = from.layers[0]?.color ?? "#e8d9b0"; // transfer 前捕获
      emit.at(0, { focus: to.id });
      from.active = false; // 源容器由 pour_vessel 道具接管
      emit.at(0.2, { focus: to.id, props: [pourVesselProp(from, to, pourColor)], ease: "easeIn" });
      transfer(from, to, { carryIce: true });
      emit.at(0.85, { focus: to.id, props: [pourVesselProp(from, to, pourColor)] });
      emit.at(1, { focus: to.id, props: [] });
      break;
    }

    /* ── 完成 ── */
    case "TOP_UP": {
      const c = ensure(step.target);
      const refs = refsOf(step.items, bySlot);
      c.active = true;
      c.agitation = 0.5; // 补满激起波纹
      emit.at(0, { focus: c.id, props: [pourProp(c, refs, vocab, 0)] });
      emit.at(0.15, { focus: c.id, props: [pourProp(c, refs, vocab, 1)] });

      // 补满量在编译期算（ADR-014）：杯容量 − 已有液体 − 冰排水 − 杯口余量
      const room = liquidCapacityMl(c) - liquidMl(c) - physics.HEADROOM_ML;
      if (room > 0 && refs.length > 0) {
        const each = room / refs.length;
        for (const r of refs) {
          addToContainer(c, [{ ...r, unit: "ml", amount: each } as IngredientRef], vocab);
        }
      }
      emit.at(0.88, { focus: c.id, props: [pourProp(c, refs, vocab, 1)] });
      emit.at(1, { focus: c.id, props: [] });
      break;
    }

    case "FLOAT": {
      const c = ensure(step.target);
      const refs = refsOf(step.items, bySlot);
      c.active = true;
      c.agitation = 0.3; // 沿吧勺背面缓倒，扰动轻
      emit.at(0, { focus: c.id, props: [barspoonProp(c, 0.6)] });
      // forceNewLayer：作者的显式意图优先于物理（规范 §7.3）
      addToContainer(c, refs, vocab, true);
      emit.at(0.9, { focus: c.id, props: [barspoonProp(c, 0.6)], ease: "easeOut" });
      emit.at(1, { focus: c.id, props: [] });
      break;
    }

    case "GARNISH": {
      const c = ensure(step.target);
      c.active = true;
      const gid =
        step.garnishId ??
        (step.items && step.items[0] ? bySlot.get(step.items[0])?.ingredientId : undefined);
      const color = (gid && vocab.ingredient(gid)?.viz.color) ?? "#8fbf5a";
      const placed = {
        garnishId: gid ?? "unknown",
        position: step.position,
        prep: step.prep ?? "none",
        color,
      } as const;
      // 写进容器状态（持久），再让 attachGarnish 在本步骤的帧上做落位动画
      c.garnishes = [
        ...c.garnishes.filter((g) => !(g.garnishId === placed.garnishId && g.position === placed.position)),
        placed,
      ];
      emit.at(0, { focus: c.id });
      if (step.prep === "expressed") c.aromaMist = 0.8;
      emit.at(1, { focus: c.id });
      attachGarnish(emit, c.id, placed);
      break;
    }

    case "SPRITZ": {
      const c = ensure(step.target);
      c.active = true;
      emit.at(0, { focus: c.id, props: [sprayProp(c)] });
      c.aromaMist = Math.min(1, 0.4 * (step.sprays ?? 1));
      emit.at(1, { focus: c.id, props: [sprayProp(c)] });
      break;
    }

    case "FLAME": {
      const c = ensure(step.target);
      c.active = true;
      const h = c.vessel.scale * UNITS_PER_CM;
      const flame: Effect = {
        kind: step.subject === "peel_oil" ? "sparks" : "flame",
        seed: hashString(`flame:${step.id}`),
        startMs: 0,
        endMs: emit.durationMs,
        rate: step.subject === "peel_oil" ? 90 : 40,
        region: { x: MAIN_POS.x - 16, y: restBowlY(c.vessel) - h - 14, w: 32, h: 14 },
        drift: { vx: 0, vy: step.subject === "peel_oil" ? 20 : -46 },
        size: { min: 1.5, max: 5 },
        color: step.subject === "peel_oil" ? "#ffb038" : "#ff8a24",
        opacity: 0.85,
      };
      emit.at(0, { focus: c.id, effects: [flame] });
      emit.at(1, { focus: c.id, effects: [flame] });
      break;
    }

    case "SMOKE": {
      const c = ensure(step.target);
      c.active = true;
      c.lidOn = step.cover === true;
      emit.at(0, { focus: c.id });
      c.smokeDensity = physics.SMOKE_PEAK_DENSITY;
      emit.at(0.6, { focus: c.id });
      if (step.cover) c.lidOn = false; // 揭盖
      emit.at(1, { focus: c.id });
      break;
    }

    case "WAIT": {
      const c = ensure(step.target);
      c.active = true;
      emit.at(0, { focus: c.id });
      if (step.reason === "bloom") c.foamMl *= physics.FOAM_BLOOM_FACTOR;
      if (step.reason === "settle") {
        // 分层边界收紧
        c.mixedness = Math.max(0, c.mixedness - 0.15);
      }
      // 烟雾按半衰期衰减
      if (c.smokeDensity > 0) {
        const halfLives = ((step.durationSec ?? 10) * 1000) / physics.SMOKE_HALFLIFE_MS;
        c.smokeDensity *= Math.pow(0.5, halfLives);
      }
      emit.at(1, { focus: c.id, ease: "linear" });
      break;
    }
  }

  // 统一补上由容器状态派生的持续性效果（气泡、烟雾、喷雾）
  attachStateEffects(emit, containers, stage);
}

/* ────────────────────────── 后处理助手 ────────────────────────── */

/**
 * 把容器状态派生的效果补到该步骤的每一帧上。
 *
 * 单独做一遍而不在 emit.at 里做的原因：效果依赖**该帧的**容器状态，
 * 而 emit.at 已经把状态快照成 Scene 了，这里直接对 Scene 补效果更直白。
 */
function attachStateEffects(
  emit: StepEmitter,
  containers: Map<ContainerId, ContainerState>,
  stage: { width: number; height: number },
): void {
  const derived = collectEffects(containers, 0, emit.durationMs, stage);
  if (derived.length === 0) return;
  for (const f of emit.frames) {
    for (const e of derived) {
      if (!f.scene.effects.some((x) => x.kind === e.kind && x.seed === e.seed)) {
        f.scene.effects.push(e);
      }
    }
  }
}

function markShake(emit: StepEmitter, id: ContainerId, intensity: string): void {
  const amp = { gentle: 5, standard: 9, hard: 14 }[intensity] ?? 9;
  const frames = emit.frames;
  for (const f of frames) {
    // 首尾帧不摇，中间帧摇
    const active = f.t > 0.02 && f.t < 0.92;
    const c = f.scene.containers.find((x) => x.id === id);
    if (!c) continue;
    c.shake = active
      ? { ampX: amp, ampY: amp * 0.55, rot: 0.07 * (amp / 9), freqHz: 9, phase: f.t * Math.PI * 2 }
      : null;
    c.lidOn = active;
  }
}

function attachGarnish(
  emit: StepEmitter,
  id: ContainerId,
  g: { garnishId: string; position: string; prep: string; color: string },
): void {
  const frames = emit.frames;
  for (const f of frames) {
    const c = f.scene.containers.find((x) => x.id === id);
    if (!c) continue;
    // 从上方落位
    const progress = Math.max(0, Math.min(1, (f.t - 0.1) / 0.7));
    c.garnishes = [
      {
        garnishId: g.garnishId,
        position: g.position as never,
        prep: g.prep,
        dx: 0,
        dy: -(1 - progress) * 60,
        rot: (1 - progress) * 0.5,
        opacity: progress,
        color: g.color,
      },
    ];
  }
}

/* ────────────────────────── 道具 ────────────────────────── */

/** 目标容器当前液面的舞台 y 坐标（液流落进酒里，而不是停在杯口上方）。 */
function surfaceStreamY(c: ContainerState): number {
  const h = c.vessel.scale * UNITS_PER_CM;
  const surfaceH = heightForVolume(c.vessel, Math.min(occupiedMl(c), c.vessel.def.capacityMl));
  return restBowlY(c.vessel) - Math.max(0.02, surfaceH) * h - 2;
}

/**
 * 加料倒注：量酒器（pour_vessel，真容器旋转）贴着被倒方杯口上方倾斜，
 * 口沿对准液流起点倒出 —— 不再是固定位置的 sprite 量杯。
 */
function pourProp(
  c: ContainerState,
  refs: readonly IngredientRef[],
  vocab: ResolvedVocab,
  active: number,
): Prop {
  const meta = refs[0] ? vocab.ingredient(refs[0].ingredientId) : undefined;
  const color = meta?.viz.color ?? "#d8d2c4";
  const visc = meta?.viz.viscosity ?? "low";
  const width = { low: 2.6, medium: 3.4, high: 4.6 }[visc];
  // 量酒器杯型（词表注册的 __jigger）
  const jigger = vocab.vessel("__jigger");
  const h = jigger ? jigger.scale * UNITS_PER_CM : 60;
  const rimR = jigger
    ? jigger.def.shape.profile[jigger.def.shape.profile.length - 1]!.r * h
    : 14;
  // 口沿目标：被倒方杯口左上方一点（贴着杯口倒）
  const lipX = MAIN_POS.x - rimR * 0.6;
  const lipY = rimYOf(c) - 10;
  const ang = POUR_ROT * 2;
  // 与渲染端一致的旋转三角函数，由口沿位置反推量杯中心（px 系）
  const gh = h / STAGE_PX;
  const hwT = rimR / STAGE_PX;
  const ctrX = lipX / STAGE_PX - (hwT * Math.cos(ang) + gh * Math.sin(ang));
  const ctrY = lipY / STAGE_PX - (hwT * Math.sin(ang) - gh * Math.cos(ang));
  const rot = active > 0.5 ? POUR_ROT : POUR_ROT * 0.55 * active; // 从半倾到全倒
  return {
    kind: "pour_vessel",
    vesselId: "__jigger",
    x: ctrX * STAGE_PX,
    y: (ctrY + gh / 2) * STAGE_PX,
    rot,
    scale: h,
    opacity: 0.95,
    stream:
      active > 0.5
        ? { fromX: lipX, fromY: lipY, toX: MAIN_POS.x, toY: surfaceStreamY(c), width, color }
        : undefined,
  };
}

/** pour_vessel 的倾角（rot，渲染端实际旋转角 = rot × 2 ≈ 103°）。 */
const POUR_ROT = 0.9;
/** 与渲染器一致的舞台像素（PS）。 */
const STAGE_PX = 4;

/**
 * 由「想要的出液口（lip = 旋转后的杯口右端点）位置」反推 pour_vessel 的 x/y。
 * 渲染端 drawPourVessel 绕杯体中心旋转剖面 —— 这里用同一套三角函数把 lip
 * 钉在指定舞台坐标上，保证**口沿精确对准液流起点**（不靠目测偏移）。
 */
function pourPose(from: ContainerState, lipX: number, lipY: number): { x: number; y: number } {
  const h = from.vessel.scale * UNITS_PER_CM;
  const rimR = from.vessel.def.shape.profile[from.vessel.def.shape.profile.length - 1]!.r * h;
  const ang = POUR_ROT * 2;
  const gh = h / STAGE_PX; // px
  const hwT = rimR / STAGE_PX;
  // lip 局部坐标 (hwT, -gh) 旋转 ang 后落在 (ctrX + hwT·cosA + gh·sinA, ctrY + hwT·sinA − gh·cosA)
  const ctrX = lipX / STAGE_PX - (hwT * Math.cos(ang) + gh * Math.sin(ang));
  const ctrY = lipY / STAGE_PX - (hwT * Math.sin(ang) - gh * Math.cos(ang));
  // 渲染端 gy = y/PS 且 ctr = (gx, gy − gh/2) → 反解 prop 坐标
  return { x: ctrX * STAGE_PX, y: (ctrY + gh / 2) * STAGE_PX };
}

/** 目标杯口沿的舞台 y。 */
function rimYOf(to: ContainerState): number {
  return restBowlY(to.vessel) - to.vessel.scale * UNITS_PER_CM;
}

/**
 * 滤酒姿态：摇壶横倒，液流从口沿先落进滤网；滤网**平摊在目标杯口上方
 * （平行于被倒方杯口）**，过滤后短液流落入杯中 —— 口沿、滤网、液流三点连贯。
 */
function strainPourProps(from: ContainerState, to: ContainerState, color: string): Prop[] {
  const strX = MAIN_POS.x; // 滤网中心 = 目标杯口中心
  const strY = rimYOf(to) - 48; // 滤网底部略高于杯口
  // 摇壶口沿：滤网正上方、抬高留出间隙 —— 103° 倾倒下壶身朝上，
  // 口部（宽约 rimR×2）不能横跨到滤网 sprite 上（否则壶左下角叠着半截滤网）
  const lipX = strX - 8;
  const lipY = strY - 46;
  const pose = pourPose(from, lipX, lipY);
  return [
    {
      kind: "pour_vessel",
      vesselId: from.vessel.def.id,
      x: pose.x,
      y: pose.y,
      rot: POUR_ROT,
      scale: from.vessel.scale * UNITS_PER_CM,
      opacity: 1,
      stream: { fromX: lipX, fromY: lipY, toX: strX, toY: strY + 8, width: 3.2, color },
    },
    {
      kind: "strainer",
      x: strX,
      y: strY,
      rot: 0, // 平行于被倒方杯口（水平）
      scale: 2.2,
      opacity: 1,
      stream: { fromX: strX, fromY: strY + 36, toX: MAIN_POS.x, toY: surfaceStreamY(to), width: 3, color },
    },
  ];
}

/**
 * 倒酒姿态：源容器**本身**（不是瓶子）横倒，口沿对准液流起点流出。
 * 倒酒帧里真实源容器被隐藏（from.active=false），由这个道具接管绘制，避免双重出现。
 * 颜色在 transfer 之前捕获 —— transfer 会清空源容器的层。
 */
function pourVesselProp(from: ContainerState, to: ContainerState, color: string): Prop {
  const lipX = MAIN_POS.x - 16; // 口沿落在目标杯口左上方
  const lipY = rimYOf(to) - 16;
  const pose = pourPose(from, lipX, lipY);
  return {
    kind: "pour_vessel",
    vesselId: from.vessel.def.id,
    x: pose.x,
    y: pose.y,
    rot: POUR_ROT,
    scale: from.vessel.scale * UNITS_PER_CM,
    opacity: 1,
    stream: { fromX: lipX, fromY: lipY, toX: MAIN_POS.x, toY: surfaceStreamY(to), width: 3.2, color },
  };
}

/** 杆长基准：吧勺/swizzle 从杯口上方伸入，尖端探到杯底附近。 */
function rodProp(
  kind: "barspoon" | "swizzle",
  c: ContainerState,
  active: number,
): Prop {
  const bowlY = restBowlY(c.vessel);
  const h = c.vessel.scale * UNITS_PER_CM;
  return {
    kind,
    x: MAIN_POS.x + 6,
    y: bowlY - h - 26, // 杆顶在杯口上方（吧勺柄尾）
    rot: active * 0.3,
    scale: 1,
    opacity: 1,
    tipY: bowlY - 8, // 尖端到杯底附近
  };
}

function barspoonProp(c: ContainerState, active: number): Prop {
  return rodProp("barspoon", c, active);
}

function swizzleProp(c: ContainerState): Prop {
  return rodProp("swizzle", c, 0);
}

function muddlerProp(c: ContainerState, depth: number): Prop {
  const bowlY = restBowlY(c.vessel);
  const h = c.vessel.scale * UNITS_PER_CM;
  return {
    kind: "muddler",
    x: MAIN_POS.x,
    y: bowlY - h - 20 + depth * 10,
    rot: 0,
    scale: 1,
    opacity: 1,
    tipY: bowlY - 6 - depth * 14, // 捣压时尖端下探
  };
}

function sprayProp(c: ContainerState): Prop {
  return { kind: "spray", x: MAIN_POS.x + 40, y: restBowlY(c.vessel) - 200, rot: -0.4, scale: 1, opacity: 1 };
}

function swirlProp(c: ContainerState): Prop {
  return { kind: "barspoon", x: MAIN_POS.x, y: restBowlY(c.vessel) - 140, rot: 0.6, scale: 1, opacity: 0.7 };
}
