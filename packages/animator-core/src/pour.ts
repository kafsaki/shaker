/**
 * 倒注编排（ADR-031）：酒瓶 → 量酒器、量酒器 → 杯、摇壶 → 杯……全部走这一个原语。
 *
 * 真实的倒酒：
 *   1. 把源器具举到目标上方，口沿对准杯口；
 *   2. 慢慢倾斜，液面到达口沿那一刻才开始出液（满瓶一倾就出，半瓶要倾很多）；
 *   3. 出液时**绕口沿转**：口沿基本不动，瓶身越倒越平，直到倒完；
 *   4. 收回。
 *
 * 所以倾角不是编排者拍脑袋定的，而是由「此刻还剩多少液体」反解出来：
 * 第 k 个关键帧的倾角 = 恰好装下剩余体积的倾角（capacityAtTilt 的反函数）。
 * 液面求解器（geometry.tiltedLevel）在取样时按同一套几何画出倾斜液面，
 * 两边自洽 —— 不会出现「瓶子在倒、里面的液面却离口沿老远」。
 */
import { physics, type Viscosity } from "@shaker/recipe-ir/core";
import {
  capacityAtTilt,
  poseForLip,
  rimRadius,
  uprightLevel,
  type Frame,
} from "./geometry.ts";
import { lipXFor, fallTime } from "./stream.ts";
import { HAND_SCALE } from "./stage.ts";
import { liquidMl, occupiedMl, semOccupied } from "./state.ts";
import { key, last, lastT } from "./track.ts";
import type { Pose, StreamSpec } from "./types.ts";
import type { Vessel, World } from "./world.ts";

/** 动画里的流速是真实流速的几倍（真实倒 45ml 要 1.5 秒，动画里不该那么久）。 */
const ANIM_RATE_K = 4.6;
const MAX_TILT = 2.75;

export interface PourOpts {
  /** 倒出的毫升数（源器具里有多少就最多倒多少）。 */
  ml: number;
  color: string;
  viscosity?: Viscosity;
  /** 液柱模式。 */
  mode?: StreamSpec["mode"];
  width?: number;
  /** 出液口高出目标口沿多少（舞台单位）。THROW 用很大的值。 */
  clearance?: number;
  /** 液柱落点相对目标中轴的横向偏移。 */
  aimDx?: number;
  /** 倒注方向：+1 源在左、顺时针倾、液柱向右；缺省按位置推断。 */
  dir?: 1 | -1;
  /** 倒注时长覆盖（毫秒，未缩放）。 */
  durMs?: number;
  /** 出液期间额外的升降（THROW：边倒边把源器具举高，液柱拉长）。 */
  liftDuring?: number;
  /** 出液开始/结束时刻回调：编排者在这里更新目标的语义状态。 */
  onPour?: (startMs: number, endMs: number, landMs: number) => void;
  /** 目标不是器具（倒掉、倒在勺背上）：直接给落点。 */
  to?: { id: string | "counter"; x: number; y: number; rimY: number };
  /** 倒完后停在哪里：home 回静置位；stay 留在出液姿态附近（ROLL 下一趟要接着倒）。 */
  after?: "home" | "stay" | "lift";
  /** 收回时回静置位的弧高。 */
  homeArc?: number;
  /** 出液点不是口沿（细滤网：从滤网尖流出）—— 液柱起点换成这个工具。 */
  streamFrom?: string;
}

export interface PourResult {
  /** 开始出液、停止出液、源器具回到可用状态的时刻。 */
  startMs: number;
  endMs: number;
  doneMs: number;
  /** 液柱落到目标的时刻（目标液面开始上涨）。 */
  landMs: number;
  /** 液柱尾巴落进目标的时刻 —— 在这之前目标不能挪走，否则最后一截液柱会落空。 */
  tailMs: number;
}

/** 恰好装下 vol 毫升（液面贴着口沿最低点）的倾角，0..MAX_TILT。 */
export function angleForVolume(v: Vessel, vol: number): number {
  const s = v.shape;
  if (vol >= s.capacityMl * 0.999) return 0;
  const f: Frame = { x: 0, y: 0, rot: 0, scale: 1 };
  let lo = 0;
  let hi = MAX_TILT;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    f.rot = mid;
    if (capacityAtTilt(s, f) > vol) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 目标容器此刻（直立）的液面世界 y。 */
export function surfaceY(v: Vessel): number {
  const p = last(v.track.pose);
  const lv = uprightLevel(v.shape, semOccupied(v.sem));
  return p.y - Math.max(2, lv) * p.scale;
}

/** 倒进 ml 毫升后目标液面会升高多少（舞台单位）。 */
function expectedRise(dst: Vessel, ml: number): number {
  const p = last(dst.track.pose);
  const occ = semOccupied(dst.sem);
  return (uprightLevel(dst.shape, occ + ml) - uprightLevel(dst.shape, occ)) * p.scale;
}

export function rimY(v: Vessel): number {
  const p = last(v.track.pose);
  return p.y - v.shape.height * p.scale;
}

/**
 * 编排一次倒注。src 从它的当前姿态出发（不在手上就先拿起来）。
 * 返回出液区间与完成时刻；调用方负责 dst 语义状态（通过 onPour）。
 */
export function pour(w: World, src: Vessel, dst: Vessel | null, t0: number, o: PourOpts): PourResult {
  const tr = src.track.pose;
  const startAt = Math.max(t0, lastT(tr));
  const srcPose = last(tr);
  const target = o.to ?? {
    id: dst!.id,
    x: last(dst!.track.pose).x,
    y: surfaceY(dst!),
    rimY: rimY(dst!),
  };

  const dir: 1 | -1 =
    o.dir ?? (src.kind === "bottle" ? (target.x < w.layout.stage.width / 2 ? -1 : 1) : src.home.x <= target.x ? 1 : -1);
  // 手里的瓶子比架上（远处）大一号，但不比台面器具的比例尺更大 —— 否则一只瓶子比碟形杯还宽
  const counterScale = [...w.layout.stations.values()][0]?.scale ?? 1;
  const scale = src.kind === "bottle" ? Math.min(HAND_SCALE * counterScale, Math.max(srcPose.scale, w.layout.shelfScale * 1.15)) : srcPose.scale;

  // ── 出液量与倾角 ──
  const before = liquidMl(src.sem);
  const ml = Math.min(o.ml, before);
  const iceSolid = src.sem.iceSolidMl;
  const por = src.sem.icePorosity;
  const occBefore = occupiedMl(before, iceSolid, por);
  const occAfter = occupiedMl(before - ml, iceSolid, por);
  const rotStart0 = angleForVolume(src, occBefore) + 0.03;
  const rotEnd0 = Math.min(MAX_TILT, angleForVolume(src, Math.max(0.4, occAfter)) + 0.05);
  // 酒瓶自由倒（free pour）：吧台上倒瓶子是整个倒过来、靠瓶颈控流，不是轻轻一斜。
  // 物理上七成满的瓶子斜 20° 就出液，但那样画出来像「瓶子没倒、酒自己流出来」。
  // 液面求解在倾角超过物理值时自动钳在口沿（瓶里的酒贴着瓶颈），画面仍自洽。
  const minTilt = src.kind === "bottle" ? (o.mode === "drops" ? 2.5 : 1.85) : 0;
  const rotStart = Math.max(rotStart0, minTilt);
  const rotEnd = Math.max(rotEnd0, minTilt + (src.kind === "bottle" ? 0.2 : 0));

  // ── 出液点：口沿高出目标口沿 clearance；横向让液柱落在目标中轴 ──
  const visc = o.viscosity ?? "low";
  const speed = { low: 46, medium: 34, high: 22 }[visc];
  const clearance = o.clearance ?? (src.kind === "jigger" ? 14 : 22);
  const ly = target.rimY - clearance;
  // 落点瞄准目标中轴：液面在倒的过程中上涨（落点抬高、下落时间变短），按出液前后液面的
  // 平均高度瞄准，偏差最小
  const aimY = o.to ? target.y : (target.y + Math.max(target.rimY + 4, target.y - (dst ? expectedRise(dst, ml) : 0))) / 2;
  const lx = lipXFor(target.x + (o.aimDx ?? 0), ly, aimY, dir * speed);

  const lipPose = (rot: number, lift = 0): Pose => {
    const r = dir * rot;
    const p = poseForLip(src.shape, r, lx, ly - lift, scale);
    return { x: p.x, y: p.y, rot: r, scale, opacity: 1, z: 2 };
  };

  // ── 1. 拿起 → 举到出液点附近（半倾，口沿还没到液面） ──
  const preRot = Math.max(0.2, rotStart * 0.55);
  const fromHome = Math.abs(srcPose.x - src.home.x) < 1 && Math.abs(srcPose.y - src.home.y) < 1;
  const dist = Math.hypot(lipPose(preRot).x - srcPose.x, lipPose(preRot).y - srcPose.y);
  const travel = w.ms(Math.min(440, 180 + dist * 0.75));
  const tApproach = startAt + travel;
  if (fromHome && src.kind !== "jigger") {
    w.arc(tr, startAt, tApproach, lipPose(preRot), 24);
  } else {
    w.move(tr, startAt, tApproach, lipPose(preRot), "easeInOut");
  }
  // ── 2. 倾到液面贴口沿 ──
  const tStart = tApproach + w.ms(90 + rotStart * 60);
  key(tr, tStart, lipPose(rotStart), "easeIn");

  // ── 3. 出液：绕口沿转，倾角跟剩余体积走 ──
  const rate = (physics.POUR_RATE_ML_PER_SEC[visc] ?? 30) * ANIM_RATE_K;
  const pourMs = w.ms(o.durMs ?? Math.max(280, Math.min(1300, (ml / rate) * 1000)));
  const tEnd = tStart + pourMs;
  const N = 8;
  const lift = o.liftDuring ?? 0;
  for (let i = 1; i <= N; i++) {
    const k = i / N;
    const occ = occupiedMl(before - ml * k, iceSolid, por);
    const rot = Math.min(MAX_TILT, Math.max(rotStart, minTilt + (rotEnd - minTilt) * k, angleForVolume(src, Math.max(0.4, occ)) + 0.03));
    // 升降：前段举高、末段回落（THROW 的拉长液柱）
    const lk = lift > 0 ? Math.sin(Math.min(1, k * 1.25) * Math.PI * 0.5) * (k > 0.85 ? (1 - k) / 0.15 : 1) : 0;
    key(tr, tStart + pourMs * k, lipPose(i === N ? rotEnd : rot, lift * lk), "linear");
  }

  // 源器具的语义：出液区间内线性流失。先让调用方处理目标（转移类动作在 onPour 里
  // 把源的液体整体搬走），剩下的按比例排空 —— 顺序反过来的话，转移时源已经空了。
  w.snap(src, tStart, tStart, "hold");
  const fall = fallTime(target.y - ly) * 1000;
  const landMs = Math.round(tStart + fall);
  o.onPour?.(landMs, Math.round(tEnd + fall), landMs);
  const left = liquidMl(src.sem);
  if (left > before - ml + 0.01) {
    const keep = before > 0 ? Math.max(0, 1 - ml / before) : 0;
    src.sem.layers = src.sem.layers.map((l) => ({ ...l, ml: l.ml * keep })).filter((l) => l.ml > 0.05);
  }
  w.snap(src, tStart, tEnd, "linear");

  // 液柱
  w.streams.push({
    from: o.streamFrom ?? src.id,
    to: target.id,
    startMs: tStart,
    endMs: tEnd,
    color: o.color,
    width: o.width ?? (src.kind === "jigger" ? 2.6 : src.kind === "bottle" ? 3 : 4),
    mode: o.mode ?? "pour",
    speed: dir * speed,
  });

  // ── 4. 收回：先回正（口沿抬起，最后几滴收住），再回家 ──
  const tUp = tEnd + w.ms(130);
  const up = lipPose(Math.max(0.15, rotStart * 0.4));
  key(tr, tUp, { ...up, y: up.y - 10 }, "easeOut");
  let done = tUp;
  if ((o.after ?? "home") === "home") {
    done = src.kind === "bottle" ? w.arc(tr, tUp, tUp + w.ms(380), src.home, 22) : w.move(tr, tUp, tUp + w.ms(320), src.home);
  } else if (o.after === "lift") {
    done = w.move(tr, tUp, tUp + w.ms(200), { rot: 0 });
  }
  return { startMs: tStart, endMs: tEnd, doneMs: done, landMs, tailMs: Math.round(tEnd + fall) + w.ms(40) };
}

/** 目标器具的口沿半径（量酒器口对准杯口时的横向余量）。 */
export function mouthR(v: Vessel): number {
  return rimRadius(v.shape) * last(v.track.pose).scale;
}
