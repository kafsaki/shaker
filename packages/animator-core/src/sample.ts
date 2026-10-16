/**
 * 在给定时刻对 Timeline 取样（ADR-031）：各轨道插值 + 物理求解 → 可直接绘制的 Scene。
 *
 * 取样期才求解的物理量（渲染器不做几何决策）：
 *   - 液面：各液层边界 = 倾斜器具里「装下累计体积」的水平面（geometry.tiltedLevel）；
 *   - 液柱：每一小段液体按它离开口沿的时刻 τ、那一刻的口沿位置做抛体运动；
 *   - 冰块：落冰自由落体 + 落地回弹；摇和时在罐内乱撞；液面漫过冰堆时整堆上浮；
 *   - 周期运动：振荡器按绝对时间求值，相位天然连续。
 *
 * 全部是 (timeline, t) 的纯函数 —— seek 任意时刻、正反向拖动结果一致。
 */
import { hexToOklab, lerpOklab, oklabToHex } from "@shaker/recipe-ir/core";
import {
  pourLip,
  radiusAtV,
  rimRadius,
  tiltedLevel,
  toLocal,
  toWorld,
  uprightLevel,
  type Frame,
} from "./geometry.ts";
import { hash01 } from "./random.ts";
import { occupiedMl } from "./state.ts";
import { ageAtY, fallTime, G, VY0, yAtAge } from "./stream.ts";
import { lerpNum, numAt, valueAt } from "./track.ts";
import type {
  Contents,
  Effect,
  GarnishView,
  IceView,
  LayerState,
  LayerView,
  Osc,
  Pose,
  Scene,
  ShapeData,
  SolidView,
  StreamSpec,
  StreamView,
  Timeline,
  TimelineStep,
  ToolTrack,
  ToolView,
  VesselTrack,
  VesselView,
} from "./types.ts";

export { applyEase } from "./track.ts";

/* ────────────────────────── 定位 ────────────────────────── */

export interface SampleResult {
  scene: Scene;
  step: TimelineStep;
  stepIndex: number;
  stepProgress: number;
}

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

export function sample(tl: Timeline, tMs: number): SampleResult {
  const t = Math.max(0, Math.min(tl.totalMs, tMs));
  const { step, index } = stepAt(tl, t);
  const local = Math.max(0, Math.min(step.durationMs, t - step.startMs));
  const progress = step.durationMs > 0 ? local / step.durationMs : 1;
  return {
    scene: sceneAt(tl, t, step.stepId === "__final" ? progress : undefined),
    step,
    stepIndex: index,
    stepProgress: progress,
  };
}

/* ────────────────────────── 场景 ────────────────────────── */

function sceneAt(tl: Timeline, t: number, serve: number | undefined): Scene {
  const frames = new Map<string, Frame>();
  const vessels: VesselView[] = [];
  for (const v of tl.vessels) {
    const view = vesselAt(tl, v, t);
    if (!view) continue;
    frames.set(v.id, { x: view.x, y: view.y, rot: view.rot, scale: view.scale });
    vessels.push(view);
  }
  const tools: ToolView[] = [];
  for (const tr of tl.tools) {
    const view = toolAt(tl, tr, t);
    if (view) tools.push(view);
  }
  vessels.sort((a, b) => a.z - b.z);
  const streams: StreamView[] = [];
  for (const s of tl.streams) {
    const sv = streamAt(tl, s, t);
    if (sv) streams.push(sv);
  }
  const effects = tl.effects.filter((e) => t >= e.startMs && t <= e.endMs + lifeOf(e.kind));

  // 整屏震动：剧烈摇和时（摇壶振幅 ≥ 14 且在翻滚）
  let sx = 0;
  let sy = 0;
  for (const v of tl.vessels) {
    const o = oscAt(v.osc, t);
    if (o.wave === "snap" && o.along >= 14 && numAt(v.tumble, t) > 0.5) {
      sx = Math.round(Math.sin(t * 0.047) * 1.2) * 2;
      sy = Math.round(Math.cos(t * 0.061)) * 2;
    }
  }

  return {
    tMs: t,
    stage: tl.stage,
    shapes: tl.shapes,
    vessels,
    tools,
    streams,
    effects,
    screenShake: { x: sx, y: sy },
    ...(serve !== undefined ? { serve } : {}),
  };
}

/* ────────────────────────── 姿态 + 振荡 ────────────────────────── */

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    x: lerpNum(a.x, b.x, k),
    y: lerpNum(a.y, b.y, k),
    rot: lerpNum(a.rot, b.rot, k),
    scale: lerpNum(a.scale, b.scale, k),
    opacity: lerpNum(a.opacity, b.opacity, k),
    // 层级不插值：一离开原位就到手持层，落回才回原层
    z: k < 1 ? Math.max(a.z, b.z) : b.z,
  };
}

/** 振荡参数插值：只插幅度，频率与波形取有值的一侧 —— 否则相位 2πf·t 会随 f 狂跳。 */
function lerpOsc(a: Osc, b: Osc, k: number): Osc {
  return {
    freqHz: b.freqHz || a.freqHz,
    wave: b.freqHz ? b.wave : a.wave,
    along: lerpNum(a.along, b.along, k),
    across: lerpNum(a.across, b.across, k),
    rot: lerpNum(a.rot, b.rot, k),
  };
}

function oscAt(tr: VesselTrack["osc"], t: number): Osc {
  return valueAt(tr, t, lerpOsc);
}

/** 振荡在 t 时刻的位移（局部轴：along = 器具轴线，across = 横向）与附加转角、相位。 */
function oscOffset(o: Osc, t: number): { along: number; across: number; rot: number; phase: number } {
  if (o.freqHz <= 0) return { along: 0, across: 0, rot: 0, phase: 0 };
  const ph = (t / 1000) * o.freqHz;
  const a = ph * Math.PI * 2;
  const s = Math.sin(a);
  // snap：两端停顿、中间急冲 —— 冰块撞到壶两头的那一下
  const w = o.wave === "snap" ? Math.sign(s) * Math.pow(Math.abs(s), 0.4) : s;
  return {
    along: o.along * w,
    across: o.across * Math.sin(a + 1.3),
    rot: o.rot * Math.cos(a),
    phase: ph - Math.floor(ph),
  };
}

function applyOsc(p: Pose, o: Osc, t: number): { pose: Pose; phase: number } {
  const d = oscOffset(o, t);
  if (d.along === 0 && d.across === 0 && d.rot === 0) return { pose: p, phase: d.phase };
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  // 局部 v 轴（器具轴线）在世界中的方向 = (sin, −cos)，u 轴 = (cos, sin)
  return {
    pose: {
      ...p,
      x: p.x + d.along * s + d.across * c,
      y: p.y - d.along * c + d.across * s,
      rot: p.rot + d.rot,
    },
    phase: d.phase,
  };
}

export function vesselPoseAt(v: VesselTrack, t: number): Pose {
  return applyOsc(valueAt(v.pose, t, lerpPose), oscAt(v.osc, t), t).pose;
}

/* ────────────────────────── 器具 ────────────────────────── */

function vesselAt(tl: Timeline, v: VesselTrack, t: number): VesselView | null {
  const pose = vesselPoseAt(v, t);
  if (pose.opacity < 0.01) return null;
  const shape = tl.shapes[v.shapeId === tl.shapes[v.id]?.id ? v.id : v.shapeId] ?? tl.shapes[v.id]!;
  const f: Frame = { x: pose.x, y: pose.y, rot: pose.rot, scale: pose.scale };
  const contents = valueAt(v.contents, t, lerpContents);
  const lid = numAt(v.lid, t);
  const tumble = numAt(v.tumble, t);

  // ── 液层：按累计体积求水平面 ──
  const sealed = lid > 0.5;
  const layers: LayerView[] = [];
  let cum = 0;
  for (const l of contents.layers) {
    if (l.ml <= 0.02) continue;
    cum += l.ml;
    const occ = occupiedMl(cum, contents.iceSolidMl, contents.icePorosity);
    layers.push({
      topY: tiltedLevel(shape, f, Math.min(occ, shape.capacityMl), sealed),
      color: l.color,
      opacity: l.opacity,
      texture: l.texture,
      carbonation: l.carbonation,
      sourceSlots: l.sourceSlots,
    });
  }
  const occAll = occupiedMl(cum, contents.iceSolidMl, contents.icePorosity);
  const foam =
    contents.foamMl > 0.5 && cum > 0
      ? {
          topY: tiltedLevel(shape, f, Math.min(shape.capacityMl, occAll + contents.foamMl), sealed),
          color: contents.foamColor,
        }
      : null;

  // 直立液面高度（局部 v）：冰块上浮与装饰浮起用
  const levelV = cum > 0 ? uprightLevel(shape, occAll) : 0;
  const swirl = numAt(v.swirl, t);

  return {
    id: v.id,
    kind: v.kind,
    shapeId: v.shapeId,
    height: v.height,
    x: pose.x,
    y: pose.y,
    rot: pose.rot,
    scale: pose.scale,
    opacity: pose.opacity,
    z: pose.z,
    layers,
    ice: iceAt(v, shape, f, t, levelV, layers, tumble, swirl),
    foam,
    frost: numAt(v.frost, t),
    mixedness: contents.mixedness,
    agitation: agitationAt(v, t),
    tumble,
    swirl,
    lid,
    rim: contents.rim,
    coat: contents.coat,
    smoke: numAt(v.smoke, t),
    garnishes: garnishesAt(contents, shape, f, t, levelV),
    solids: solidsAt(contents, shape, f, t),
    ...(v.bottle ? { bottle: v.bottle } : {}),
  };
}

/** 液面波动的衰减时间常数（毫秒）。 */
export const AGITATION_TAU_MS = 300;

function agitationAt(v: VesselTrack, t: number): number {
  let a = 0;
  for (const im of v.agitation) {
    if (t < im.t) continue;
    const dt = t - im.t;
    const rise = Math.min(1, dt / 120);
    const tail = dt > im.dur ? Math.exp(-(dt - im.dur) / AGITATION_TAU_MS) : 1;
    a += im.peak * rise * tail;
  }
  return Math.min(1, a);
}

/* ── 内容插值：液层按 uid 配对 ── */

function lerpContents(a: Contents, b: Contents, k: number): Contents {
  return {
    layers: lerpLayers(a.layers, b.layers, k),
    iceSolidMl: lerpNum(a.iceSolidMl, b.iceSolidMl, k),
    icePorosity: k < 0.5 ? a.icePorosity : b.icePorosity,
    foamMl: lerpNum(a.foamMl, b.foamMl, k),
    foamColor: b.foamColor,
    mixedness: lerpNum(a.mixedness, b.mixedness, k),
    rim: k < 0.5 ? a.rim : b.rim,
    coat: a.coat && b.coat ? { color: color(a.coat.color, b.coat.color, k), strength: lerpNum(a.coat.strength, b.coat.strength, k) } : k < 0.5 ? a.coat : b.coat,
    garnishes: b.garnishes,
    solids: b.solids.map((s) => {
      const o = a.solids.find((x) => x.slot === s.slot && x.u === s.u);
      return o ? { ...s, bruised: lerpNum(o.bruised, s.bruised, k) } : s;
    }),
  };
}

/**
 * 液层插值。三种情况：
 *   - 同 uid：体积与颜色插值；
 *   - 只在 b（新倒入）：从 0 长出；只在 a（被倒走）：缩到 0；
 *   - 同时有「消失的」和「出现的」（混匀合层）：出现的层从消失层的混合色渐变到自己的颜色，
 *     体积从消失层的总量渐变过去 —— 摇匀、搅匀时颜色是慢慢变的，不是一层层塌掉。
 */
function lerpLayers(as: readonly LayerState[], bs: readonly LayerState[], k: number): LayerState[] {
  const aMap = new Map(as.map((l) => [l.uid, l]));
  const bIds = new Set(bs.map((l) => l.uid));
  const vanish = as.filter((l) => !bIds.has(l.uid));
  const appear = bs.filter((l) => !aMap.has(l.uid));
  const remix = vanish.length > 0 && appear.length > 0;
  const vTotal = vanish.reduce((s, l) => s + l.ml, 0);
  const aTotal = appear.reduce((s, l) => s + l.ml, 0);
  const vColor = remix ? mixHex(vanish) : "#000000";

  const out: LayerState[] = [];
  for (const b of bs) {
    const a = aMap.get(b.uid);
    if (a) {
      out.push({ ...b, ml: lerpNum(a.ml, b.ml, k), color: color(a.color, b.color, k), opacity: lerpNum(a.opacity, b.opacity, k), carbonation: lerpNum(a.carbonation, b.carbonation, k), texture: k < 0.5 ? a.texture : b.texture });
    } else if (remix) {
      const share = aTotal > 0 ? b.ml / aTotal : 1 / appear.length;
      out.push({ ...b, ml: lerpNum(vTotal * share, b.ml, k), color: color(vColor, b.color, k), texture: k < 0.5 ? vanish[0]!.texture : b.texture });
    } else {
      out.push({ ...b, ml: b.ml * k });
    }
  }
  if (!remix) for (const a of vanish) out.push({ ...a, ml: a.ml * (1 - k) });
  return out;
}

function mixHex(ls: readonly LayerState[]): string {
  let L = 0;
  let A = 0;
  let B = 0;
  let wsum = 0;
  for (const l of ls) {
    const c = hexToOklab(l.color);
    const w = Math.max(0.1, l.ml);
    L += c.L * w;
    A += c.a * w;
    B += c.b * w;
    wsum += w;
  }
  return oklabToHex({ L: L / wsum, a: A / wsum, b: B / wsum });
}

function color(a: string, b: string, k: number): string {
  if (a === b) return a;
  return oklabToHex(lerpOklab(hexToOklab(a), hexToOklab(b), k));
}

/* ── 冰 ── */

/** 自由落体的重力（舞台单位/s²）：冰块比液流重得多，落得干脆。 */
const ICE_G = 2600;

function iceAt(
  v: VesselTrack,
  shape: ShapeData,
  f: Frame,
  t: number,
  levelV: number,
  layers: readonly LayerView[],
  tumble: number,
  swirl: number,
): IceView[] {
  const epoch = v.ice.find((e) => t >= e.fromMs && t < e.toMs);
  if (!epoch) return [];
  const out: IceView[] = [];
  // 液面漫过冰堆：整堆上浮（冰密度 0.92 —— 只有一成露出液面）
  let lift = 0;
  if (tumble < 0.05 && Math.abs(f.rot) < 0.3) {
    const top = epoch.topV;
    const typicalH = epoch.pieces[0]?.h ?? 0;
    lift = Math.max(0, levelV - top + typicalH * 0.12);
    lift = Math.min(lift, Math.max(0, shape.height - top - typicalH * 0.1));
  }
  const surfY = layers.length > 0 ? layers[layers.length - 1]!.topY : Infinity;
  const tSec = t / 1000;
  for (const p of epoch.pieces) {
    if (t < p.dropAt || t >= p.leaveAt) continue;
    let u = p.u;
    let vv = p.v + (p.kind === "block" || p.kind === "dry_ice" ? 0 : lift);
    let rot = p.rot;
    // 落冰：从铲口自由落下，落地后一次小回弹
    if (p.dropAt > -Infinity) {
      const age = (t - p.dropAt) / 1000;
      const H = Math.max(1, p.dropFromV - p.v);
      const tf = Math.sqrt((2 * H) / ICE_G);
      if (age < tf) {
        const k = age / tf;
        vv = p.dropFromV - 0.5 * ICE_G * age * age;
        u = p.dropFromU + (p.u - p.dropFromU) * k;
        rot = p.rot + (1 - k) * (hash01(p.seed, 1) - 0.5) * 2.2;
      } else {
        const after = age - tf;
        const bounce = Math.max(0, Math.sin(Math.min(1, after / 0.16) * Math.PI)) * Math.min(10, H * 0.06);
        vv += bounce;
      }
    }
    // 摇和 / 搅拌机：冰块在罐内乱撞（每块不同频率的确定性游走）
    if (tumble > 0.01) {
      const r0 = radiusAtV(shape, p.v);
      const ph = hash01(p.seed, 3) * 6.28;
      const fq = 5 + hash01(p.seed, 5) * 4;
      u += tumble * Math.sin(tSec * fq * 6.28 + ph) * r0 * 0.45;
      vv += tumble * Math.cos(tSec * (fq * 0.8) * 6.28 + ph * 1.7) * shape.height * 0.18;
      rot += tumble * tSec * (hash01(p.seed, 7) - 0.5) * 12;
      const lim = Math.max(0, radiusAtV(shape, vv) - p.w * 0.45);
      u = Math.max(-lim, Math.min(lim, u));
      vv = Math.max(p.h / 2, Math.min(shape.height - p.h / 2, vv));
    }
    // 搅拌：冰块绕杯轴慢慢转（侧视是左右往复、前后排交错）
    if (swirl > 0.01) {
      const r0 = Math.max(0, radiusAtV(shape, vv) - p.w * 0.5);
      const ph = hash01(p.seed, 9) * 6.28;
      u += swirl * Math.sin(tSec * 1.6 * 6.28 + ph) * Math.min(r0, 8);
      rot += swirl * Math.sin(tSec * 3 + ph) * 0.2;
    }
    const c = toWorld(f, u, vv);
    out.push({
      kind: p.kind,
      x: c.x,
      y: c.y,
      w: p.w * f.scale,
      h: p.h * f.scale,
      rot: f.rot + rot,
      seed: p.seed,
      depth: p.depth,
      submerged: c.y > surfY,
    });
  }
  // 后排先画
  out.sort((a, b) => a.depth - b.depth);
  return out;
}

/* ── 装饰 ── */

function garnishesAt(c: Contents, shape: ShapeData, f: Frame, t: number, levelV: number): GarnishView[] {
  const rr = rimRadius(shape);
  const out: GarnishView[] = [];
  for (const g of c.garnishes) {
    if (t < g.addedAt) continue;
    const k = Math.min(1, (t - g.addedAt) / 420);
    const fall = (1 - k * k) * 70;
    let u = 0;
    let vv = shape.height;
    let rot = 0;
    switch (g.position) {
      case "rim":
        u = rr * 0.78;
        vv = shape.height + 1;
        rot = 0.12;
        break;
      case "side":
        u = rr + 26;
        vv = 0;
        break;
      case "skewer":
        u = 0;
        vv = shape.height + 2;
        break;
      default:
        // in_glass / float：浮在液面（空杯回退到杯口）
        vv = levelV > 0 ? levelV : shape.height;
        u = rr * 0.15;
    }
    const p = toWorld(f, u, vv);
    out.push({
      garnishId: g.garnishId,
      position: g.position,
      prep: g.prep,
      color: g.color,
      x: p.x,
      y: p.y - fall,
      rot: f.rot + rot + (1 - k) * 0.6,
      opacity: Math.min(1, k * 3),
    });
  }
  return out;
}

function solidsAt(c: Contents, shape: ShapeData, f: Frame, t: number): SolidView[] {
  const out: SolidView[] = [];
  for (const s of c.solids) {
    if (t < s.addedAt) continue;
    const k = Math.min(1, (t - s.addedAt) / 380);
    const rest = 4 + hash01(Math.round(s.u * 100), 2) * 6;
    const vv = rest + (1 - k * k) * (shape.height + 30 - rest);
    const lim = Math.max(0, radiusAtV(shape, vv) - 6);
    const p = toWorld(f, Math.max(-lim, Math.min(lim, s.u)), vv);
    out.push({ sprite: s.sprite, color: s.color, x: p.x, y: p.y, rot: f.rot + s.rot, bruised: s.bruised });
  }
  return out;
}

/* ────────────────────────── 工具 ────────────────────────── */

function toolAt(tl: Timeline, tr: ToolTrack, t: number): ToolView | null {
  let pose = valueAt(tr.pose, t, lerpPose);
  const att = tr.attach.find((a) => t >= a.fromMs && t < a.toMs);
  if (att) {
    const v = tl.vessels.find((x) => x.id === att.vessel);
    if (v) {
      const vp = vesselPoseAt(v, t);
      const p = toWorld({ x: vp.x, y: vp.y, rot: vp.rot, scale: vp.scale }, att.u, att.v);
      pose = { ...pose, x: p.x, y: p.y, rot: vp.rot + att.rot, scale: vp.scale, z: Math.max(pose.z, vp.z) };
    }
  }
  const { pose: p, phase } = applyOsc(pose, valueAt(tr.osc, t, lerpOsc), t);
  if (p.opacity < 0.01) return null;
  if (p.x > tl.stage.width + 30 || p.x < -30) return null;
  return {
    id: tr.id,
    kind: tr.kind,
    size: tr.size,
    ...(tr.color ? { color: tr.color } : {}),
    x: p.x,
    y: p.y,
    rot: p.rot,
    scale: p.scale,
    opacity: p.opacity,
    z: p.z,
    phase,
  };
}

/* ────────────────────────── 液柱 ────────────────────────── */

/** 一段倒注在 t 时刻的液柱：每小段液体按离开口沿的时刻 τ 做抛体运动。 */
function streamAt(tl: Timeline, s: StreamSpec, t: number): StreamView | null {
  if (t < s.startMs) return null;
  const lipAt = (tau: number): { x: number; y: number } | null => sourcePoint(tl, s.from, tau);
  const landAt = (tau: number, x: number): number => landingY(tl, s.to, tau, x);

  const lip0 = lipAt(Math.min(t, s.endMs));
  if (!lip0) return null;
  const maxFall = fallTime(Math.max(10, tl.stage.counterY + 60 - lip0.y)) * 1000;
  if (t > s.endMs + maxFall) return null;

  if (s.mode === "drops") {
    const n = Math.max(1, s.count ?? 3);
    const pts: StreamView["points"] = [];
    let impact: StreamView["impact"] = null;
    for (let i = 0; i < n; i++) {
      const tau = s.startMs + ((s.endMs - s.startMs) * (i + 0.3)) / n;
      if (t < tau) continue;
      const lip = lipAt(tau);
      if (!lip) continue;
      const a = (t - tau) / 1000;
      const x = lip.x + s.speed * 0.15 * a;
      const y = yAtAge(lip.y, a);
      const land = landAt(t, x);
      if (y >= land) {
        if (a - fallTime(land - lip.y) < 0.18) impact = { x, y: land, strength: 0.4 };
        continue;
      }
      pts.push({ x, y, w: 1.4 });
    }
    return pts.length || impact ? { from: s.from, to: s.to, color: s.color, mode: s.mode, points: pts, impact } : null;
  }

  // 连续液柱：τ 从最新（口沿处）到最旧（前缘），逐段推进。
  // 出液结束后口沿已经离开（收手），尾巴上的液体仍按它们离开时的口沿位置继续下落 ——
  // 所以 τ 只在 [startMs, endMs] 里取，与口沿此刻在哪无关。
  const newest = Math.min(t, s.endMs);
  const oldest = Math.max(s.startMs, t - maxFall);
  const pts: StreamView["points"] = [];
  let impact: StreamView["impact"] = null;
  const N = 22;
  if (newest < oldest) return null;
  // 收手后，最后离开口沿的那一滴也已落进目标：整条液柱都落完了
  if (t > s.endMs) {
    const lipEnd = lipAt(s.endMs);
    if (lipEnd) {
      const a = (t - s.endMs) / 1000;
      if (yAtAge(lipEnd.y, a) >= landAt(t, lipEnd.x + s.speed * a)) return null;
    }
  }
  for (let i = 0; i <= N; i++) {
    const tau = newest - ((newest - oldest) * i) / N;
    const lip = lipAt(tau);
    if (!lip) break;
    const a = (t - tau) / 1000;
    const x = lip.x + s.speed * a;
    const y = yAtAge(lip.y, a);
    const land = landAt(t, x);
    // 流量守恒：越往下越快、越细（指数取得温和，像素尺度下保持可读）
    const w = Math.max(0.9, s.width * Math.pow(1 + (G * a) / VY0, -0.22));
    if (y >= land) {
      // 落到目标：截在液面上，画水花
      const aHit = ageAtY(lip.y, land);
      pts.push({ x: lip.x + s.speed * aHit, y: land, w });
      impact = { x: lip.x + s.speed * aHit, y: land, strength: Math.min(1, s.width / 4) };
      break;
    }
    pts.push({ x, y, w });
  }
  if (pts.length < 2 && !impact) return null;
  return { from: s.from, to: s.to, color: s.color, mode: s.mode, points: pts, impact };
}

/** 液柱起点：器具的出液口（口沿最低点），或工具的出液点（细滤网尖、勺缘）。 */
function sourcePoint(tl: Timeline, id: string, tau: number): { x: number; y: number } | null {
  const v = tl.vessels.find((x) => x.id === id);
  if (v) {
    const p = vesselPoseAt(v, tau);
    const shape = shapeOf(tl, v);
    return pourLip(shape, { x: p.x, y: p.y, rot: p.rot, scale: p.scale });
  }
  const tool = tl.tools.find((x) => x.id === id);
  if (tool) {
    const view = toolAt(tl, tool, tau);
    if (!view) return null;
    // 细滤网：网底尖；浮注吧勺：勺缘
    return { x: view.x, y: view.y + (tool.kind === "fine_strainer" ? 16 : 2) };
  }
  return null;
}

/** 液柱落点 y：目标器具此刻的液面（空杯 = 杯底），或工具表面，或台面。 */
function landingY(tl: Timeline, id: string, t: number, x: number): number {
  if (id === "counter") return tl.stage.counterY;
  const v = tl.vessels.find((q) => q.id === id);
  if (v) {
    const p = vesselPoseAt(v, t);
    const shape = shapeOf(tl, v);
    const f = { x: p.x, y: p.y, rot: p.rot, scale: p.scale };
    const c = valueAt(v.contents, t, lerpContents);
    const liquid = c.layers.reduce((s, l) => s + l.ml, 0);
    const occ = occupiedMl(liquid, c.iceSolidMl, c.icePorosity);
    // 液面以上若有冰堆露头，液柱先打在冰上
    const lv = liquid > 0.1 ? tiltedLevel(shape, f, Math.min(occ, shape.capacityMl)) : p.y - 3 * p.scale;
    const local = toLocal(f, x, lv);
    void local;
    return lv;
  }
  const tool = tl.tools.find((q) => q.id === id);
  if (tool) {
    const view = toolAt(tl, tool, t);
    if (view) return view.y - (tool.kind === "fine_strainer" ? 6 : 2);
  }
  return tl.stage.counterY;
}

function shapeOf(tl: Timeline, v: VesselTrack): ShapeData {
  return tl.shapes[v.id] ?? tl.shapes[v.shapeId]!;
}

/* ────────────────────────── 粒子 ────────────────────────── */

export interface Particle {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

/** 粒子寿命（毫秒）：火星、火苗余烬短命，烟雾长命。 */
export const PARTICLE_LIFE_MS = 1400;

export function lifeOf(kind: Effect["kind"]): number {
  return kind === "sparks" || kind === "flame" ? 520 : kind === "mist" ? 900 : PARTICLE_LIFE_MS;
}

/**
 * 在时刻 tMs 算出某个 Effect 的粒子。纯函数，只依赖 (effect, tMs) ——
 * 如果粒子带状态，seek 回退时位置就会跳变。
 */
export function particlesAt(e: Effect, tMs: number): Particle[] {
  if (tMs < e.startMs) return [];
  const life = lifeOf(e.kind);
  const elapsed = Math.min(tMs, e.endMs + life) - e.startMs;
  if (elapsed <= 0) return [];
  const maxAlive = 220;
  const spawnInterval = 1000 / Math.max(0.5, e.rate);
  const emitEnd = e.endMs - e.startMs;
  const firstIndex = Math.max(0, Math.ceil((elapsed - life) / spawnInterval));
  const lastIndex = Math.floor(Math.min(elapsed, emitEnd) / spawnInterval);
  const out: Particle[] = [];
  for (let i = firstIndex; i <= lastIndex && out.length < maxAlive; i++) {
    const age = elapsed - i * spawnInterval;
    if (age < 0 || age > life) continue;
    const lifeK = age / life;
    const r1 = hash01(e.seed, i * 3);
    const r2 = hash01(e.seed, i * 3 + 1);
    const r3 = hash01(e.seed, i * 3 + 2);
    const ageSec = age / 1000;
    const swayAmp = e.kind === "smoke" ? 9 : e.kind === "mist" ? 1.1 : e.kind === "chill" ? 3 : 2.4;
    const sway = Math.sin(r3 * 6.28 + ageSec * 3.4) * swayAmp;
    // 雾滴沉降：初速向下 + 重力加速；火星抛出后下坠
    const fall = e.kind === "mist" ? 130 * ageSec * ageSec : e.kind === "sparks" ? 140 * ageSec * ageSec : 0;
    out.push({
      x: e.region.x + r1 * e.region.w + e.drift.vx * ageSec * (e.kind === "sparks" ? r2 * 2 : 1) + sway,
      y: e.region.y + r2 * e.region.h + e.drift.vy * ageSec + fall,
      size: e.size.min + r3 * (e.size.max - e.size.min) * (e.kind === "smoke" ? 1 + lifeK : 1),
      opacity:
        e.opacity *
        (e.kind === "smoke" || e.kind === "chill"
          ? Math.sin(lifeK * Math.PI)
          : e.kind === "mist" || e.kind === "sparks"
            ? 1 - lifeK
            : 1 - lifeK * 0.7),
    });
  }
  return out;
}
