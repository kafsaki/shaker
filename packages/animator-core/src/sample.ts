/**
 * 在给定时刻对 Timeline 取样。
 *
 * **seek 是 O(1)**：找到 t 所属的关键帧区间、对两端插值即可 ——
 * 不需要重放历史。这是「拖时间轴」和「单步回看」能工作的前提（规范 §9.1）。
 *
 * 粒子不在这里插值 —— 它们由 Effect 的发射器在渲染时按 t 确定性算出。
 */
import { lerpOklab, hexToOklab, oklabToHex } from "@shaker/recipe-ir/core";
import type {
  Ease,
  Effect,
  Prop,
  RenderedContainer,
  RenderedGarnish,
  RenderedIce,
  RenderedLayer,
  Scene,
  Timeline,
  TimelineStep,
} from "./types.ts";

/* ────────────────────────── 缓动 ────────────────────────── */

export function applyEase(t: number, ease: Ease): number {
  const k = Math.max(0, Math.min(1, t));
  switch (ease) {
    case "linear":
      return k;
    case "easeIn":
      return k * k;
    case "easeOut":
      return 1 - (1 - k) * (1 - k);
    case "easeInOut":
      return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  }
}

/* ────────────────────────── 定位 ────────────────────────── */

export interface SampleResult {
  scene: Scene;
  /** 当前所在步骤，便于 UI 高亮步骤列表。 */
  step: TimelineStep;
  stepIndex: number;
  /** 该步骤内的进度 0..1。 */
  stepProgress: number;
}

/** 找到 tMs 所在的步骤。二分查找。 */
export function stepAt(tl: Timeline, tMs: number): { step: TimelineStep; index: number } {
  const t = Math.max(0, Math.min(tl.totalMs, tMs));
  let lo = 0;
  let hi = tl.steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.steps[mid]!.startMs <= t) lo = mid;
    else hi = mid - 1;
  }
  return { step: tl.steps[lo]!, index: lo };
}

/** 在任意时刻取样出可直接绘制的场景。 */
export function sample(tl: Timeline, tMs: number): SampleResult {
  const { step, index } = stepAt(tl, tMs);
  const local = Math.max(0, Math.min(step.durationMs, tMs - step.startMs));
  const scene = sampleStep(step, local);
  return {
    scene,
    step,
    stepIndex: index,
    stepProgress: step.durationMs > 0 ? local / step.durationMs : 1,
  };
}

function sampleStep(step: TimelineStep, localMs: number): Scene {
  const kfs = step.keyframes;
  if (kfs.length === 0) throw new Error(`步骤 ${step.stepId} 没有关键帧`);
  if (kfs.length === 1) return kfs[0]!.scene;

  // 找到 localMs 所在区间
  let i = 0;
  while (i < kfs.length - 2 && kfs[i + 1]!.tMs <= localMs) i++;
  const a = kfs[i]!;
  const b = kfs[i + 1]!;
  const span = b.tMs - a.tMs;
  if (span <= 0) return b.scene;
  const raw = (localMs - a.tMs) / span;
  return lerpScene(a.scene, b.scene, applyEase(raw, a.ease));
}

/* ────────────────────────── 场景插值 ────────────────────────── */

function n(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 颜色在 OKLab 空间插值（感知均匀，过渡不发灰）。 */
function color(a: string, b: string, t: number): string {
  if (a === b) return a;
  return oklabToHex(lerpOklab(hexToOklab(a), hexToOklab(b), t));
}

export function lerpScene(a: Scene, b: Scene, t: number): Scene {
  return {
    // focus 不插值 —— 取后一帧的，镜头切换是离散的
    focus: t < 1 ? a.focus : b.focus,
    containers: lerpByKey(a.containers, b.containers, (c) => c.id, lerpContainer, t),
    props: lerpByKey(a.props, b.props, (p) => p.kind, lerpProp, t),
    // 效果不插值：它们是参数化发射器，取并集，渲染器按自己的 t 算粒子
    effects: unionEffects(a.effects, b.effects),
  };
}

/**
 * 按 key 配对插值。
 *
 * 只在 a 里的 → 淡出；只在 b 里的 → 淡入。这样容器进出场不需要额外编排。
 */
function lerpByKey<T extends { opacity: number }>(
  as: readonly T[],
  bs: readonly T[],
  key: (x: T) => string,
  lerp: (a: T, b: T, t: number) => T,
  t: number,
): T[] {
  const bMap = new Map(bs.map((x) => [key(x), x]));
  const out: T[] = [];
  for (const a of as) {
    const b = bMap.get(key(a));
    if (b) {
      out.push(lerp(a, b, t));
      bMap.delete(key(a));
    } else {
      out.push({ ...a, opacity: a.opacity * (1 - t) });
    }
  }
  for (const b of bMap.values()) {
    out.push({ ...b, opacity: b.opacity * t });
  }
  return out;
}

function lerpContainer(a: RenderedContainer, b: RenderedContainer, t: number): RenderedContainer {
  return {
    id: b.id,
    vesselId: b.vesselId,
    x: n(a.x, b.x, t),
    y: n(a.y, b.y, t),
    height: n(a.height, b.height, t),
    scale: n(a.scale, b.scale, t),
    opacity: n(a.opacity, b.opacity, t),
    tilt: n(a.tilt, b.tilt, t),
    shake: lerpShake(a, b, t),
    frost: n(a.frost, b.frost, t),
    layers: lerpLayers(a.layers, b.layers, t),
    ice: lerpIce(a.ice, b.ice, t),
    foam: lerpFoam(a, b, t),
    // rim/coat 是离散状态，取后一帧
    rim: t < 0.5 ? a.rim : b.rim,
    coat: t < 0.5 ? a.coat : b.coat,
    garnishes: lerpGarnishes(a.garnishes, b.garnishes, t),
    smoke: n(a.smoke, b.smoke, t),
    lidOn: t < 0.5 ? a.lidOn : b.lidOn,
    agitation: n(a.agitation, b.agitation, t),
  };
}

function lerpShake(
  a: RenderedContainer,
  b: RenderedContainer,
  t: number,
): RenderedContainer["shake"] {
  if (!a.shake && !b.shake) return null;
  const from = a.shake ?? { ...b.shake!, ampX: 0, ampY: 0, rot: 0 };
  const to = b.shake ?? { ...a.shake!, ampX: 0, ampY: 0, rot: 0 };
  return {
    ampX: n(from.ampX, to.ampX, t),
    ampY: n(from.ampY, to.ampY, t),
    rot: n(from.rot, to.rot, t),
    freqHz: n(from.freqHz, to.freqHz, t),
    // phase 取起点 —— 渲染器按绝对时间推进相位，插值会让摇晃抖动
    phase: from.phase,
  };
}

/**
 * 液层插值。
 *
 * 按索引配对而不是按 sourceSlots：层数变化（新倒入一层、混匀后合并）时
 * 按索引配对能自然产生"新层从零高度长出来"的效果。
 *
 * **新层的下边界必须贴着下面一层当前的（插值中的）上边界**，而不是固定在自己的
 * 最终 fromH —— 否则多种原料同时倒入时，下层液面还在涨、上层却从最终位置开始长，
 * 两层之间会露出一段杯壁空隙（历史 bug）。
 */
function lerpLayers(as: readonly RenderedLayer[], bs: readonly RenderedLayer[], t: number): RenderedLayer[] {
  const len = Math.max(as.length, bs.length);
  const out: RenderedLayer[] = [];
  for (let i = 0; i < len; i++) {
    const a = as[i];
    const b = bs[i];
    if (a && b) {
      out.push({
        fromH: n(a.fromH, b.fromH, t),
        toH: n(a.toH, b.toH, t),
        color: color(a.color, b.color, t),
        opacity: n(a.opacity, b.opacity, t),
        blend: n(a.blend, b.blend, t),
        carbonation: n(a.carbonation, b.carbonation, t),
        // 质地是类别量，不做连续插值 —— 过半即切换
        texture: t < 0.5 ? a.texture : b.texture,
        sourceSlots: b.sourceSlots,
      });
    } else if (b) {
      // 新层：从下面一层**当前的**液面长出，厚度从 0 长满。
      // 关键帧里液层恒为连续（compile 保证），所以插值结果也连续、无空隙。
      const base = out.length > 0 ? out[out.length - 1]!.toH : b.fromH;
      out.push({ ...b, fromH: base, toH: base + (b.toH - b.fromH) * t });
    } else if (a) {
      // 消失的层：塌回下边界
      out.push({ ...a, toH: n(a.toH, a.fromH, t) });
    }
  }
  return out;
}

function lerpIce(as: readonly RenderedIce[], bs: readonly RenderedIce[], t: number): RenderedIce[] {
  const len = Math.max(as.length, bs.length);
  const out: RenderedIce[] = [];
  for (let i = 0; i < len; i++) {
    const a = as[i];
    const b = bs[i];
    if (a && b) {
      out.push({
        kind: b.kind,
        x: n(a.x, b.x, t),
        y: n(a.y, b.y, t),
        size: n(a.size, b.size, t),
        rot: n(a.rot, b.rot, t),
        opacity: n(a.opacity, b.opacity, t),
      });
    } else if (b) {
      // 新冰块：从杯口上方落下 + 淡入
      out.push({ ...b, y: n(1.25, b.y, t), opacity: b.opacity * Math.min(1, t * 2) });
    } else if (a) {
      out.push({ ...a, opacity: a.opacity * (1 - t) });
    }
  }
  return out;
}

function lerpFoam(
  a: RenderedContainer,
  b: RenderedContainer,
  t: number,
): RenderedContainer["foam"] {
  if (!a.foam && !b.foam) return null;
  if (a.foam && b.foam) {
    return {
      fromH: n(a.foam.fromH, b.foam.fromH, t),
      toH: n(a.foam.toH, b.foam.toH, t),
      color: color(a.foam.color, b.foam.color, t),
    };
  }
  const only = (a.foam ?? b.foam)!;
  const grow = b.foam ? t : 1 - t;
  return { fromH: only.fromH, toH: n(only.fromH, only.toH, grow), color: only.color };
}

function lerpGarnishes(
  as: readonly RenderedGarnish[],
  bs: readonly RenderedGarnish[],
  t: number,
): RenderedGarnish[] {
  const bMap = new Map(bs.map((g) => [g.garnishId + g.position, g]));
  const out: RenderedGarnish[] = [];
  for (const a of as) {
    const k = a.garnishId + a.position;
    const b = bMap.get(k);
    if (b) {
      out.push({
        ...b,
        dx: n(a.dx, b.dx, t),
        dy: n(a.dy, b.dy, t),
        rot: n(a.rot, b.rot, t),
        opacity: n(a.opacity, b.opacity, t),
      });
      bMap.delete(k);
    } else {
      out.push({ ...a, opacity: a.opacity * (1 - t) });
    }
  }
  for (const b of bMap.values()) out.push({ ...b, opacity: b.opacity * t });
  return out;
}

function lerpProp(a: Prop, b: Prop, t: number): Prop {
  return {
    kind: b.kind,
    x: n(a.x, b.x, t),
    y: n(a.y, b.y, t),
    rot: n(a.rot, b.rot, t),
    scale: n(a.scale, b.scale, t),
    opacity: n(a.opacity, b.opacity, t),
    tipY: a.tipY !== undefined && b.tipY !== undefined ? n(a.tipY, b.tipY, t) : (b.tipY ?? a.tipY),
    vesselId: b.vesselId ?? a.vesselId,
    stream:
      a.stream && b.stream
        ? {
            fromX: n(a.stream.fromX ?? a.x, b.stream.fromX ?? b.x, t),
            fromY: n(a.stream.fromY ?? a.y, b.stream.fromY ?? b.y, t),
            toX: n(a.stream.toX, b.stream.toX, t),
            toY: n(a.stream.toY, b.stream.toY, t),
            width: n(a.stream.width, b.stream.width, t),
            color: color(a.stream.color, b.stream.color, t),
          }
        : (b.stream ?? a.stream),
  };
}

function unionEffects(as: readonly Effect[], bs: readonly Effect[]): Effect[] {
  const seen = new Set<string>();
  const out: Effect[] = [];
  for (const e of [...as, ...bs]) {
    const k = `${e.kind}:${e.seed}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/* ────────────────────────── 粒子 ────────────────────────── */

export interface Particle {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

/**
 * 在时刻 tMs 算出某个 Effect 的粒子。
 *
 * **纯函数，只依赖 (effect, tMs)** —— 这是「粒子是 t 的纯函数」纪律的实现
 * （规范 §9.1）。如果粒子带状态，seek 回退时位置就会跳变。
 */
export function particlesAt(e: Effect, tMs: number): Particle[] {
  if (tMs < e.startMs) return [];
  const elapsed = Math.min(tMs, e.endMs) - e.startMs;
  if (elapsed <= 0) return [];

  /** 粒子寿命（毫秒）。 */
  const lifeMs = 1400;
  /** 同时存活的粒子数上限，防止 rate 过大时爆掉。 */
  const maxAlive = 220;

  const spawnInterval = 1000 / Math.max(0.5, e.rate);
  const firstIndex = Math.max(0, Math.ceil((elapsed - lifeMs) / spawnInterval));
  const lastIndex = Math.floor(elapsed / spawnInterval);

  const out: Particle[] = [];
  for (let i = firstIndex; i <= lastIndex && out.length < maxAlive; i++) {
    const age = elapsed - i * spawnInterval;
    if (age < 0 || age > lifeMs) continue;
    const life = age / lifeMs;

    // 每个粒子的随机属性由 (seed, i) 确定 —— 同一个 i 永远得到同一组值
    const r1 = rand(e.seed, i * 3 + 0);
    const r2 = rand(e.seed, i * 3 + 1);
    const r3 = rand(e.seed, i * 3 + 2);

    const ageSec = age / 1000;
    // 横向摆动让气泡/烟雾不呆板；雾滴重，几乎不飘
    const swayAmp = e.kind === "smoke" ? 9 : e.kind === "mist" ? 1.1 : 2.4;
    const sway = Math.sin((r3 * 6.28) + ageSec * 3.4) * swayAmp;
    // 雾滴沉降：初速向下 + 重力加速（0.5·g·t²），不是匀速平移
    const fall = e.kind === "mist" ? 130 * ageSec * ageSec : 0;

    out.push({
      x: e.region.x + r1 * e.region.w + e.drift.vx * ageSec + sway,
      y: e.region.y + r2 * e.region.h + e.drift.vy * ageSec + fall,
      size: e.size.min + r3 * (e.size.max - e.size.min) * (e.kind === "smoke" ? 1 + life : 1),
      // 气泡越接近液面越淡；烟雾先浓后散；雾滴落到寿命尽头完全消散
      opacity:
        e.opacity *
        (e.kind === "smoke" ? Math.sin(life * Math.PI) : e.kind === "mist" ? 1 - life : 1 - life * 0.7),
    });
  }
  return out;
}

/** 由 (seed, index) 确定的 [0,1) 值。 */
function rand(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}
