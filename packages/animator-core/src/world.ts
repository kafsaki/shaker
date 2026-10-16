/**
 * 编排期的世界模型（ADR-031）：实体（器具、工具）的轨道与编排原语。
 *
 * 编排写法是「时间游标 + 动作原语」：每个原语从实体的当前姿态出发，在 [t0, t1]
 * 内移动到目标，返回结束时刻。实体之间各写各的轨道，可以重叠（酒瓶回架的同时
 * 量酒器去倒酒）。语义状态（液体、冰）由 snap() 在指定时刻快照进 contents 轨道。
 */
import type { IceType } from "@shaker/recipe-ir/core";
import { hashString } from "./random.ts";
import { footDrop, rimRadius, type Frame } from "./geometry.ts";
import { HAND_SCALE, type Layout } from "./stage.ts";
import { newSem, toContents, type Sem, type Uids } from "./state.ts";
import { hold, key, last, lastT, track } from "./track.ts";
import type {
  BottleLook,
  Ease,
  Effect,
  IceEpoch,
  Impulse,
  Osc,
  Pose,
  ShapeData,
  StreamSpec,
  ToolKind,
  ToolTrack,
  Track,
  VesselKind,
  VesselTrack,
} from "./types.ts";

export const NO_OSC: Osc = { freqHz: 0, along: 0, across: 0, rot: 0, wave: "sine" };

export interface Vessel {
  id: string;
  kind: VesselKind;
  shape: ShapeData;
  sem: Sem;
  track: VesselTrack;
  /** 静置位（台面站位 / 酒架瓶位）。 */
  home: Pose;
  /** 当前冰堆（局部坐标），转移时整堆跟着走。 */
  epoch: IceEpoch | null;
  /** 当前冰的种类与堆高（重新堆积时用）。 */
  iceSpec: { kind: IceType; fill: number } | null;
}

export interface Tool {
  id: string;
  kind: ToolKind;
  track: ToolTrack;
  home: Pose;
}

export class World {
  readonly vessels = new Map<string, Vessel>();
  readonly tools = new Map<string, Tool>();
  readonly streams: StreamSpec[] = [];
  readonly effects: Effect[] = [];
  readonly uids: Uids = { next: 1 };
  readonly layout: Layout;
  /** 速度倍率：所有编排时长都除以它。 */
  readonly speed: number;

  constructor(lay: Layout, speed: number) {
    this.layout = lay;
    this.speed = speed;
  }

  /** 编排时长（毫秒）按速度缩放后取整。 */
  ms(d: number): number {
    return Math.max(1, Math.round(d / this.speed));
  }

  /* ── 实体 ── */

  addVessel(id: string, kind: VesselKind, shape: ShapeData, home: Pose, bottle?: BottleLook): Vessel {
    const v: Vessel = {
      id,
      kind,
      shape,
      sem: newSem(),
      home,
      epoch: null,
      iceSpec: null,
      track: {
        id,
        kind,
        shapeId: shape.id,
        height: shape.height,
        pose: track<Pose>(home),
        osc: track<Osc>(NO_OSC),
        contents: track(toContents(newSem())),
        agitation: [],
        tumble: track(0),
        swirl: track(0),
        lid: track(0),
        frost: track(0),
        smoke: track(0),
        ice: [],
        ...(bottle ? { bottle } : {}),
      },
    };
    this.vessels.set(id, v);
    return v;
  }

  addTool(id: string, kind: ToolKind, size: number, home: Pose, color?: string): Tool {
    const t: Tool = {
      id,
      kind,
      home,
      track: {
        id,
        kind,
        size,
        ...(color ? { color } : {}),
        pose: track<Pose>(home),
        osc: track<Osc>(NO_OSC),
        attach: [],
      },
    };
    this.tools.set(id, t);
    return t;
  }

  vessel(id: string): Vessel {
    const v = this.vessels.get(id);
    if (!v) throw new Error(`场景里没有器具 ${id}`);
    return v;
  }

  /** 工具：没有就在舞台外（右侧画面外）建一个，入场时从那里进来。 */
  tool(id: string, kind: ToolKind, size: number, color?: string): Tool {
    const t = this.tools.get(id);
    if (t) return t;
    const off: Pose = { x: this.layout.stage.width + 60, y: this.layout.stage.counterY - 160, rot: 0, scale: 1, opacity: 0, z: 2 };
    return this.addTool(id, kind, size, off, color);
  }

  /* ── 语义快照 ── */

  /** 把器具当前语义状态写进 contents 轨道：在 [t0, t1] 内从旧状态过渡到新状态。 */
  snap(v: Vessel, t0: number, t1: number, ease: Ease = "linear"): void {
    const tr = v.track.contents;
    const a = Math.max(t0, lastT(tr));
    hold(tr, a);
    key(tr, Math.max(t1, a), toContents(v.sem), ease);
  }

  /** 立即生效（同一时刻换值）。 */
  snapNow(v: Vessel, t: number): void {
    this.snap(v, t, t, "hold");
  }

  agitate(v: Vessel, t: number, dur: number, peak: number): void {
    v.track.agitation.push({ t, dur, peak } satisfies Impulse);
  }

  /* ── 运动原语（返回结束时刻） ── */

  poseAt(tr: Track<Pose>): Pose {
    return last(tr);
  }

  /** 在 [t0, t1] 内从当前姿态移动到 to（只覆盖给出的字段）。 */
  move(tr: Track<Pose>, t0: number, t1: number, to: Partial<Pose>, ease: Ease = "easeInOut"): number {
    hold(tr, t0);
    const from = last(tr);
    key(tr, t1, { ...from, ...to }, ease);
    return t1;
  }

  /** 沿抛物线弧移动（拿起放下的手感）：中点抬高 arc。 */
  arc(tr: Track<Pose>, t0: number, t1: number, to: Partial<Pose>, arc: number, ease: Ease = "easeInOut"): number {
    hold(tr, t0);
    const from = last(tr);
    const end = { ...from, ...to };
    const mid = {
      ...from,
      ...to,
      x: (from.x + end.x) / 2,
      y: Math.min(from.y, end.y) - arc,
      rot: (from.rot + end.rot) / 2,
      scale: (from.scale + end.scale) / 2,
      opacity: end.opacity,
    };
    const tm = (t0 + t1) / 2;
    key(tr, tm, mid, ease === "linear" ? "linear" : "easeIn");
    key(tr, t1, end, ease === "linear" ? "linear" : "easeOut");
    return t1;
  }

  osc(tr: Track<Osc>, t0: number, t1: number, o: Osc, ramp: number): void {
    hold(tr, t0);
    key(tr, t0 + ramp, o, "easeOut");
    key(tr, t1 - ramp, o, "linear");
    key(tr, t1, NO_OSC, "easeIn");
  }

  scalar(tr: Track<number>, t0: number, t1: number, v: number, ease: Ease = "easeInOut"): void {
    hold(tr, t0);
    key(tr, t1, v, ease);
  }

  /** 器具回到静置位。 */
  goHome(v: Vessel | Tool, t0: number, dur: number, arc = 0): number {
    const tr = v.track.pose;
    return arc > 0 ? this.arc(tr, t0, t0 + dur, v.home, arc) : this.move(tr, t0, t0 + dur, v.home);
  }

  /** 器具此刻是否就在静置位（编排决定要不要先拿过来）。 */
  atHome(v: Vessel): boolean {
    const p = last(v.track.pose);
    return Math.abs(p.x - v.home.x) < 0.5 && Math.abs(p.y - v.home.y) < 0.5 && Math.abs(p.rot) < 1e-3;
  }

  lastPoseT(v: Vessel | Tool): number {
    return lastT(v.track.pose);
  }

  /* ── 冰时代 ── */

  /** 换一段冰堆（加冰、转移、打碎都开新时代）。 */
  setIce(v: Vessel, t: number, pieces: IceEpoch["pieces"], topV: number): void {
    if (v.epoch) v.epoch.toMs = t;
    if (pieces.length === 0) {
      v.epoch = null;
      return;
    }
    const e: IceEpoch = { fromMs: t, toMs: Infinity, pieces, topV };
    v.track.ice.push(e);
    v.epoch = e;
  }

  seed(s: string): number {
    return hashString(s);
  }

  /** 静置位：器具放在台面上时的碗底中心。 */
  frameOf(v: Vessel): Frame {
    const p = last(v.track.pose);
    return { x: p.x, y: p.y, rot: p.rot, scale: p.scale };
  }
}

/** 手持时的缩放（酒瓶从架上拿下来变大一号，放回去再变小）。 */
export function handPose(p: Partial<Pose>): Partial<Pose> {
  return { scale: HAND_SCALE, z: 2, ...p };
}

/** 杯口上方 h 的世界 y。 */
export function aboveRim(v: Vessel, h: number): number {
  return v.home.y - v.shape.height * v.home.scale - h;
}

/** 台面上静置位的口沿中心。 */
export function rimTop(v: Vessel): { x: number; y: number } {
  return { x: v.home.x, y: v.home.y - v.shape.height * v.home.scale };
}

export function rimR(v: Vessel): number {
  return rimRadius(v.shape) * v.home.scale;
}

export function counterRestY(shape: ShapeData, counterY: number, scale = 1): number {
  return counterY - footDrop(shape) * scale;
}
