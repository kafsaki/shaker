/**
 * 动作编排（ADR-031）：每个 IR 动作一个函数，从时间游标 t0 出发写各实体的轨道，
 * 返回本步结束时刻（下一步从这里开始）。
 *
 * 写法约定：
 *   - 只写本动作关心的实体；没写的实体保持原样（轨道自动延续最后一个键）。
 *   - 语义状态（液体、冰、装饰）改 v.sem，再 w.snap() 在合适的时间段写进 contents。
 *   - 一切时长经 w.ms() 缩放（speedScale）。
 *   - 动作结束时器具回到静置位、工具离场 —— __final 定格段靠这条保证画面干净。
 */
import {
  physics,
  type IceType,
  type IngredientRef,
  type RecipeIR,
  type Step,
} from "@shaker/recipe-ir/core";
import { poseForLip, rimRadius, radiusAtV, uprightLevel } from "./geometry.ts";
import { pileIce, porosityOf } from "./ice.ts";
import { pour, rimY, surfaceY } from "./pour.ts";
import { makeRandom } from "./random.ts";
import { pourMode, BLENDER_BASE_H } from "./stage.ts";
import {
  buildFoam,
  dilute,
  frostLevel,
  killCarbonation,
  layerOf,
  liquidMl,
  mix,
  mixedColor,
  pourIn,
  semOccupied,
  tintOf,
  transfer,
} from "./state.ts";
import { key, last, lastT } from "./track.ts";
import type { IcePiece, Pose, ResolvedVocab, SolidState, ToolKind } from "./types.ts";
import { NO_OSC, type Tool, type Vessel, type World } from "./world.ts";

export interface Ctx {
  w: World;
  ir: RecipeIR;
  vocab: ResolvedVocab;
  bySlot: Map<string, IngredientRef>;
}

export function runStep(step: Step, ctx: Ctx, t0: number): number {
  // 自转移（from === to，编辑器可选出这种组合）：语义上什么都不发生，停一拍
  if ("from" in step && "to" in step && step.from === step.to) return t0 + ctx.w.ms(400);
  const fn = ACTIONS[step.action];
  return fn ? fn(step as never, ctx, t0) : t0 + ctx.w.ms(600);
}

type Handler<S> = (step: S, ctx: Ctx, t0: number) => number;
type StepOf<A extends Step["action"]> = Extract<Step, { action: A }>;

/* ════════════════════════════ 通用小件 ════════════════════════════ */

function refs(slots: readonly string[] | undefined, bySlot: Map<string, IngredientRef>): IngredientRef[] {
  return (slots ?? []).map((s) => bySlot.get(s)).filter((r): r is IngredientRef => r !== undefined);
}

function colorOf(ctx: Ctx, id: string, fallback = "#d8d2c4"): string {
  return ctx.vocab.ingredient(id)?.viz.color ?? fallback;
}

/** 工具入场：从画面右上外飘进来到 to；离场：飘回去。 */
function enter(w: World, t: Tool, t0: number, to: Pose, dur = 300): number {
  const tr = t.track.pose;
  const off: Pose = { ...to, x: w.layout.stage.width + 40, y: to.y - 60, opacity: 1 };
  if (last(tr).opacity < 0.5) key(tr, Math.max(t0, lastT(tr)), off, "hold");
  return w.move(tr, Math.max(t0, lastT(tr)), t0 + w.ms(dur), { ...to, opacity: 1 }, "easeOut");
}

function exit(w: World, t: Tool, t0: number, dur = 280): number {
  const tr = t.track.pose;
  const p = last(tr);
  return w.move(tr, Math.max(t0, lastT(tr)), t0 + w.ms(dur), { x: w.layout.stage.width + 40, y: p.y - 60, rot: 0, opacity: 1 }, "easeIn");
}

/** 把一个台面器具挪到舞台主位附近？不 —— 器具留在站位，镜头不动（ADR-031 第一阶段）。 */
function vesselOf(ctx: Ctx, id: string): Vessel {
  return ctx.w.vessel(id);
}

/** 加料时的波纹冲量。 */
function stir(w: World, v: Vessel, t: number, dur: number, peak: number): void {
  w.agitate(v, t, dur, peak);
}

/** 冰块浸没后起霜：温度在 dur 内降到目标。 */
function chillTo(w: World, v: Vessel, t0: number, dur: number): void {
  w.scalar(v.track.frost, t0, t0 + dur, frostLevel(v.sem), "easeIn");
}

/* ════════════════════════════ 倒注（ADD / TOP_UP / FLOAT / RINSE） ════════════════════════════ */

/**
 * 把一种原料倒进目标容器：
 *   jigger —— 酒瓶从架上取下 → 倒进量酒器（量到线）→ 酒瓶回架 / 同时量酒器倒进杯；
 *   free   —— 酒瓶直接倒进杯（大剂量、勺量）；
 *   dash   —— 苦精瓶倒扣，一滴一滴；
 *   top    —— 酒瓶倒进杯直到补满。
 * 返回 [下一种原料可以开始的时刻, 本原料全部结束的时刻]。
 */
function pourIngredient(
  ctx: Ctx,
  dst: Vessel,
  ref: IngredientRef,
  t0: number,
  o: { mlOverride?: number; float?: boolean; rinse?: boolean },
): [number, number] {
  const { w, vocab } = ctx;
  const meta = vocab.ingredient(ref.ingredientId);
  const mode = o.mlOverride !== undefined ? "free" : pourMode(ref, vocab);
  const bottle = w.vessels.get(`bottle:${ref.ingredientId}`);
  const layer = layerOf(ref, vocab, w.uids, o.mlOverride);
  if (!layer || !bottle) return [t0 + w.ms(200), t0 + w.ms(200)];
  const color = meta?.viz.color ?? "#d8d2c4";
  const visc = meta?.viz.viscosity ?? "low";
  const tint = tintOf(ref);

  // 目标进液：液柱落到液面的那一刻开始涨，线性涨到出液结束
  const fillDst = (land: number, end: number): void => {
    w.snap(dst, land, land, "hold");
    pourIn(dst.sem, { ...layer }, tint, o.float === true);
    w.snap(dst, land, end, "linear");
    stir(w, dst, land, end - land, o.float ? 0.22 : layer.ml > 0 ? 0.55 : 0.15);
  };

  if (mode === "dash") {
    // 苦精：拿到杯口上方，倒扣，一甩一滴
    const n = "amount" in ref ? Math.max(1, Math.round(ref.amount)) : 1;
    const r = pour(w, bottle, dst, t0, {
      ml: 0.6 * n,
      color,
      viscosity: "low",
      mode: "drops",
      clearance: 34,
      durMs: 220 + n * 200,
      onPour: (land, end) => fillDst(land, end),
    });
    const s = w.streams[w.streams.length - 1]!;
    s.count = n;
    return [r.endMs + w.ms(120), r.doneMs];
  }

  if (mode === "jigger") {
    // 量酒器：先倒进量酒器 → 量酒器倒进杯。酒瓶回架与量酒器倒杯同时进行。
    const jig = w.vessel("jigger");
    const jHome = jig.home;
    // 量酒器要在静置位（上一种原料用完它会回位）
    const tJig = Math.max(t0, lastT(jig.track.pose));
    const ml = layer.ml;
    const r1 = pour(w, bottle, jig, tJig, {
      ml,
      color,
      viscosity: visc,
      clearance: 26,
      onPour: (land, end) => {
        w.snap(jig, land, land, "hold");
        jig.sem.layers = [{ ...layer, uid: w.uids.next++ }];
        w.snap(jig, land, end, "linear");
        w.agitate(jig, land, end - land, 0.4);
      },
      after: "home",
    });
    // 量酒器倒进杯：酒瓶收手时它就出发
    const r2 = pour(w, jig, dst, r1.endMs + w.ms(200), {
      ml,
      color,
      viscosity: visc,
      mode: o.float ? "gentle" : "pour",
      clearance: o.float ? 6 : 14,
      ...(o.float
        ? {
            to: {
              id: "float_spoon",
              x: last(dst.track.pose).x - 2,
              y: surfaceY(dst) - 8,
              rimY: surfaceY(dst) - 8,
            },
            durMs: 900,
            width: 1.4,
          }
        : {}),
      onPour: (land, end) => fillDst(land + (o.float ? w.ms(80) : 0), end + (o.float ? w.ms(120) : 0)),
      after: "home",
    });
    void jHome;
    return [r2.endMs + w.ms(80), Math.max(r1.doneMs, r2.doneMs)];
  }

  // free / top：酒瓶直接倒进杯
  const ml = mode === "top" ? (o.mlOverride ?? layer.ml) : layer.ml;
  const r = pour(w, bottle, dst, t0, {
    ml: Math.max(1, ml),
    color,
    viscosity: visc,
    clearance: mode === "top" ? 30 : 22,
    width: mode === "top" ? 3.6 : 3,
    onPour: (land, end) => fillDst(land, end),
  });
  return [r.endMs + w.ms(160), r.doneMs];
}

/** 一串原料依次倒进目标；返回全部结束时刻。 */
function pourAll(
  ctx: Ctx,
  dst: Vessel,
  rs: IngredientRef[],
  t0: number,
  o: { float?: boolean } = {},
): number {
  let t = t0;
  let end = t0;
  for (const r of rs) {
    const mode = pourMode(r, ctx.vocab);
    if (mode === "solid") {
      const [n, e] = dropSolid(ctx, dst, r, t);
      t = n;
      end = Math.max(end, e);
      continue;
    }
    const [next, done] = pourIngredient(ctx, dst, r, t, o);
    t = next;
    end = Math.max(end, done);
  }
  return Math.max(t, end);
}

/** 固体原料（薄荷叶、青柠角、方糖）：从上方丢进杯里，沉到杯底。 */
function dropSolid(ctx: Ctx, dst: Vessel, ref: IngredientRef, t0: number): [number, number] {
  const { w, vocab } = ctx;
  const meta = vocab.ingredient(ref.ingredientId);
  const n = Math.min(8, "amount" in ref ? Math.max(1, Math.round(ref.amount)) : 1);
  const rnd = makeRandom(w.seed(`solid:${ref.slot}`));
  const sprite: SolidState["sprite"] =
    ref.unit === "leaf" || meta?.category === "spice_herb"
      ? "leaf"
      : ref.unit === "wedge"
        ? "wedge"
        : ref.unit === "slice"
          ? "wheel"
          : meta?.category === "syrup_sweetener"
            ? "cube"
            : "berry";
  const r0 = radiusAtV(dst.shape, 6) * dst.home.scale;
  const color = meta?.viz.color ?? "#4a8f3c";
  w.snap(dst, t0, t0, "hold");
  for (let i = 0; i < n; i++) {
    dst.sem.solids.push({
      sprite,
      color,
      u: (rnd() * 2 - 1) * Math.max(0, r0 - 8),
      rot: (rnd() * 2 - 1) * 0.9,
      addedAt: t0 + w.ms(80 * i),
      bruised: 0,
      slot: ref.slot,
    });
  }
  w.snapNow(dst, t0);
  const end = t0 + w.ms(80 * n + 420);
  stir(w, dst, t0 + w.ms(300), w.ms(200), 0.25);
  return [t0 + w.ms(80 * n + 160), end];
}

/* ════════════════════════════ 动作 ════════════════════════════ */

const CHILL: Handler<StepOf<"CHILL">> = (s, { w }, t0) => {
  const c = w.vessel(s.target);
  // 冷冻 / 冰水：杯壁慢慢起霜，冒一点冷气
  const dur = w.ms(1100);
  c.sem.temperatureC = physics.TEMP_CHILLED_C;
  w.scalar(c.track.frost, t0, t0 + dur, Math.max(0.55, frostLevel(c.sem)), "easeOut");
  const p = c.home;
  const top = p.y - c.shape.height * p.scale;
  w.effects.push({
    kind: "chill",
    seed: w.seed(`chill:${s.id}`),
    startMs: t0,
    endMs: t0 + dur,
    rate: 22,
    region: { x: p.x - rimRadius(c.shape) * p.scale, y: top, w: rimRadius(c.shape) * 2 * p.scale, h: c.shape.height * p.scale },
    drift: { vx: 0, vy: 8 },
    size: { min: 1, max: 2 },
    color: "#e6f2fa",
    opacity: 0.55,
  });
  return t0 + dur;
};

const RIM: Handler<StepOf<"RIM">> = (s, ctx, t0) => {
  const { w, bySlot } = ctx;
  const c = w.vessel(s.target);
  const mat = bySlot.get(s.material);
  const color = mat ? colorOf(ctx, mat.ingredientId, "#ffffff") : "#ffffff";
  // 盐碟滑到杯旁 → 杯子倒扣、杯口在碟里蘸一圈 → 翻回来放下 → 盐碟离场
  const plate = w.tool("rim_plate", "rim_plate", rimRadius(c.shape) * 2.6 * c.home.scale, color);
  const plateY = w.layout.stage.counterY;
  const px = c.home.x + rimRadius(c.shape) * c.home.scale * 2.4 + 16;
  let t = enter(w, plate, t0, { x: px, y: plateY, rot: 0, scale: 1, opacity: 1, z: 1 }, 320);
  const tr = c.track.pose;
  // 倒扣：rot = π 时局部 v 朝下，杯口在 y0 + H·scale —— 让杯口正好压在碟里的盐上
  const flipped: Pose = { ...c.home, x: px, y: plateY - 5 - c.shape.height * c.home.scale, rot: Math.PI, z: 2 };
  t = w.arc(tr, t, t + w.ms(520), flipped, 60);
  // 蘸：左右转一转
  w.osc(c.track.osc, t, t + w.ms(520), { freqHz: 2.4, along: 0, across: 5, rot: 0.06, wave: "sine" }, w.ms(90));
  t += w.ms(520);
  w.snap(c, t - w.ms(260), t - w.ms(260), "hold");
  c.sem.rim = { coverage: s.coverage ?? "full", color };
  w.snapNow(c, t - w.ms(260));
  t = w.arc(tr, t, t + w.ms(560), c.home, 60);
  exit(w, plate, t - w.ms(200));
  return t;
};

const RINSE: Handler<StepOf<"RINSE">> = (s, ctx, t0) => {
  const { w, bySlot } = ctx;
  const c = w.vessel(s.target);
  const rs = refs(s.items, bySlot);
  let t = pourAll(ctx, c, rs, t0);
  // 涮：举起来转一圈（低频、小幅），让酒沾满杯壁
  const tr = c.track.pose;
  const up: Pose = { ...c.home, y: c.home.y - 40, z: 2 };
  t = w.move(tr, t, t + w.ms(300), up);
  w.osc(c.track.osc, t, t + w.ms(900), { freqHz: 1.6, along: 0, across: 7, rot: 0.32, wave: "sine" }, w.ms(160));
  stir(w, c, t, w.ms(900), 0.6);
  t += w.ms(900);
  const tint = c.sem.layers[c.sem.layers.length - 1];
  c.sem.coat = tint ? { color: tint.color, strength: Math.min(0.85, tint.opacity + 0.25) } : null;
  w.snap(c, t - w.ms(500), t, "linear");
  if (s.discard) {
    // 倒掉多余：举着的杯子以手腕为轴往外侧翻到杯口朝下（≈100°），酒顺着杯口流到台面，
    // 只留挂壁。杯底基本不动 —— 是手腕在转，不是整只杯子横扫过台面。往空的那一侧倒
    const room = (dir: number) =>
      Math.min(
        ...[...w.layout.stations.values()].filter((st) => st.id !== c.id && Math.sign(st.x - c.home.x) === dir).map((st) => Math.abs(st.x - c.home.x)),
        dir > 0 ? w.layout.stage.width - c.home.x : c.home.x,
      );
    const away = room(1) >= room(-1) ? 1 : -1;
    const dump: Pose = { ...up, x: up.x + away * 8, y: up.y - 24, rot: away * 1.75 };
    const tTilt = w.move(tr, t, t + w.ms(420), dump, "easeIn");
    const ml = liquidMl(c.sem);
    // 杯子翻到位才出液（翻转途中的液柱会拖出一条折线）
    w.streams.push({
      from: c.id,
      to: "counter",
      startMs: tTilt - w.ms(80),
      endMs: tTilt + w.ms(240),
      color: tint?.color ?? "#d8d2c4",
      width: 2,
      mode: "pour",
      speed: away * 30,
    });
    void ml;
    c.sem.layers = [];
    w.snap(c, tTilt - w.ms(160), tTilt + w.ms(240), "linear");
    // 翻回正立再放下（先在空中转回来，不是倒扣着横移回去）
    t = w.move(tr, tTilt + w.ms(300), tTilt + w.ms(620), up, "easeInOut");
  }
  return w.move(tr, t, t + w.ms(380), c.home);
};

const ADD: Handler<StepOf<"ADD">> = (s, ctx, t0) => {
  const c = vesselOf(ctx, s.target);
  return pourAll(ctx, c, refs(s.items, ctx.bySlot), t0);
};

const TOP_UP: Handler<StepOf<"TOP_UP">> = (s, ctx, t0) => {
  const { w, bySlot } = ctx;
  const c = w.vessel(s.target);
  const rs = refs(s.items, bySlot);
  // 补满量在编译期算（ADR-014）：杯容量 − 已占 − 杯口余量
  const room = c.shape.capacityMl - semOccupied(c.sem) - physics.HEADROOM_ML;
  let t = t0;
  if (room > 0 && rs.length > 0) {
    const each = room / rs.length;
    for (const r of rs) {
      const [next, done] = pourIngredient(ctx, c, r, t, { mlOverride: each });
      t = Math.max(next, done - w.ms(300));
    }
  }
  return t + w.ms(200);
};

const FLOAT: Handler<StepOf<"FLOAT">> = (s, ctx, t0) => {
  const { w, bySlot } = ctx;
  const c = w.vessel(s.target);
  const rs = refs(s.items, bySlot);
  // 吧勺先就位：勺背朝上、勺碗压到贴近液面，柄从杯口伸出
  const spoon = w.tool("float_spoon", "float_spoon", 120 + c.shape.height * c.home.scale * 0.5);
  const bowlY = () => surfaceY(c) - 6;
  const pose = (): Pose => ({ x: c.home.x + 2, y: bowlY(), rot: 0.32, scale: 1, opacity: 1, z: 2 });
  let t = enter(w, spoon, t0, pose(), 360);
  // 量酒器倒在勺背上；勺子随液面上抬
  const before = surfaceY(c);
  const end = pourAll(ctx, c, rs, t, { float: true });
  const after = surfaceY(c);
  w.move(spoon.track.pose, t + w.ms(500), end - w.ms(300), { y: bowlY() }, "linear");
  void before;
  void after;
  t = exit(w, spoon, end - w.ms(200), 320);
  return Math.max(t, end);
};

const ICE: Handler<StepOf<"ICE">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const kind = s.iceType;
  // 冰铲从右侧进来，到杯口上方一倾，冰块一块块落下（错开时间，各自自由落体）
  const scoop = w.tool("scoop", "scoop", 64);
  const rimTop = c.home.y - c.shape.height * c.home.scale;
  const sx = c.home.x + rimRadius(c.shape) * c.home.scale * 0.2;
  let t = enter(w, scoop, t0, { x: sx + 26, y: rimTop - 54, rot: 0, scale: 1, opacity: 1, z: 2 }, 300);
  // 铲口转向下方（rot < 0 时铲口朝左下）：铲口落在杯口正上方
  const tTip = w.move(scoop.track.pose, t, t + w.ms(220), { x: c.home.x + 30, y: rimTop - 30, rot: -1.05 }, "easeIn");

  const existing = c.epoch?.pieces.filter((p) => p.leaveAt === Infinity) ?? [];
  const pile = pileIce(c.shape, kind, s.fill, w.seed(`ice:${s.id}:${c.id}`), existing);
  const releaseMs = w.ms(kind === "crushed" ? 520 : kind === "cracked" ? 440 : 380);
  const rnd = makeRandom(w.seed(`icedrop:${s.id}`));
  // 落下顺序 = 堆积顺序（底下的先落），每块从杯口正上方出发、略带横向散开
  const dropFromV = c.shape.height + 28 / c.home.scale;
  const dropFromU = (sx - c.home.x) / c.home.scale;
  const n = pile.pieces.length;
  const pieces: IcePiece[] = pile.pieces.map((p, i) => ({
    ...p,
    dropAt: tTip + Math.round((releaseMs * i) / Math.max(1, n)) + Math.round(rnd() * w.ms(30)),
    dropFromU: dropFromU + (rnd() * 2 - 1) * 6,
    dropFromV: dropFromV + rnd() * 10,
  }));
  w.setIce(c, tTip, [...existing, ...pieces], pile.topV);
  c.iceSpec = { kind, fill: s.fill };

  // 排水：冰全部落定时液面到位（落冰过程中线性上涨）
  const firstLand = tTip + w.ms(140);
  const lastLand = tTip + releaseMs + w.ms(260);
  w.snap(c, firstLand, firstLand, "hold");
  const occ = physics.ICE_POROSITY[kind];
  const solid = c.shape.capacityMl * Math.max(0, Math.min(1, s.fill)) * (1 - occ) * (kind === "dry_ice" ? 0 : 1);
  c.sem.iceSolidMl += solid;
  c.sem.icePorosity = porosityOf(kind);
  if (physics.ICE_CLOUDING[kind] > 0) for (const l of c.sem.layers) if (l.texture === "clear") l.texture = "cloudy";
  c.sem.temperatureC = Math.min(c.sem.temperatureC, 2);
  w.snap(c, firstLand, lastLand, "linear");
  stir(w, c, firstLand, lastLand - firstLand, liquidMl(c.sem) > 0 ? 0.85 : 0.2);
  if (liquidMl(c.sem) > 1) {
    const surf = surfaceY(c);
    w.effects.push({
      kind: "splash",
      seed: w.seed(`splash:${s.id}`),
      startMs: firstLand,
      endMs: lastLand + w.ms(200),
      rate: kind === "crushed" ? 10 : 16,
      region: { x: c.home.x - rimRadius(c.shape) * c.home.scale * 0.7, y: surf - 2, w: rimRadius(c.shape) * c.home.scale * 1.4, h: 4 },
      drift: { vx: 0, vy: 0 },
      size: { min: 1, max: 2 },
      color: mixedColor(c.sem.layers),
      opacity: 0.9,
    });
  }
  if (kind === "dry_ice") {
    w.scalar(c.track.smoke, firstLand, lastLand + w.ms(400), 0.7, "easeOut");
  }
  t = Math.max(tTip + releaseMs, w.ms(0));
  exit(w, scoop, t + w.ms(60));
  return lastLand + w.ms(120);
};

const MUDDLE: Handler<StepOf<"MUDDLE">> = (s, ctx, t0) => {
  const { w, bySlot, vocab } = ctx;
  const c = w.vessel(s.target);
  const rs = refs(s.items, bySlot);
  // 杯里还没有这些固体（配方没先 ADD 它们）：先丢进去
  let t = t0;
  for (const r of rs) {
    if (!c.sem.solids.some((x) => x.slot === r.slot)) {
      const [n] = dropSolid(ctx, c, r, t);
      t = n;
    }
  }
  const muddler = w.tool("muddler", "muddler", 200);
  const bottomY = c.home.y - 4;
  const tip = (depth: number): Pose => ({ x: c.home.x, y: bottomY - depth, rot: 0, scale: 1, opacity: 1, z: 2 });
  t = enter(w, muddler, t, tip(40), 320);
  // 捣：按下 → 拧半圈 → 抬起，重复几次。每下压都激起一下波纹
  const presses = s.intensity === "firm" ? 4 : 3;
  for (let i = 0; i < presses; i++) {
    t = w.move(muddler.track.pose, t, t + w.ms(170), tip(0), "easeIn");
    stir(w, c, t, w.ms(120), 0.5);
    t = w.move(muddler.track.pose, t, t + w.ms(120), { rot: 0.08 * (i % 2 === 0 ? 1 : -1) }, "linear");
    t = w.move(muddler.track.pose, t, t + w.ms(200), { ...tip(26), rot: 0 }, "easeOut");
  }
  // 捣过的固体：颜色变深、碎一点；firm 出汁
  w.snap(c, t0, t0, "hold");
  for (const sol of c.sem.solids) if (rs.some((r) => r.slot === sol.slot)) sol.bruised = s.intensity === "firm" ? 1 : 0.6;
  if (s.intensity === "firm") {
    for (const r of rs) {
      if (!["piece", "wedge", "slice"].includes(r.unit)) continue;
      const count = "amount" in r ? r.amount : 1;
      const juice = layerOf(r, vocab, w.uids, count * physics.MUDDLE_JUICE_YIELD_ML.firm);
      if (juice) pourIn(c.sem, juice, 0);
    }
  }
  w.snap(c, t0 + w.ms(200), t, "linear");
  return exit(w, muddler, t, 300);
};

/**
 * 摇和（作者点名）：
 *   1. 盖上壶盖（盖子从上方落下、扣紧）；
 *   2. 举到肩高，壶身斜 ~35°（真实的握法：一手托底一手压盖，壶身斜指向肩后）；
 *   3. 沿壶身轴线往复猛摇 ~4Hz，两端急停（snap 波形）—— 冰块撞到壶两头；
 *      壶里冰块乱撞、液体被打成气泡（tumble），壶壁逐渐起霜；
 *   4. 放回台面，揭盖。
 * 旧版是 9Hz 正弦叠在 12fps 定格上，频率混叠成原地抖。
 */
const SHAKE: Handler<StepOf<"SHAKE">> = (s, ctx, t0) => {
  const { w, bySlot, vocab } = ctx;
  const c = w.vessel(s.target);
  const intensity = s.intensity ?? "standard";
  const amp = { gentle: 8, standard: 11, hard: 14 }[intensity];
  const shakeMs = w.ms(physics.realToAnimMs(s.durationSec, 1400) + 300);
  const tr = c.track.pose;

  // 1. 盖盖子
  let t = t0;
  w.scalar(c.track.lid, t, t + w.ms(260), 1, "easeIn");
  t += w.ms(320);
  // 2. 举起、斜握：就在自己站位上方举高，壶身微斜（真实握法：一手托底一手压盖、壶口朝肩后）。
  // 不横挪到舞台中间 —— 那会挡住成品杯与酒架
  // rot > 0 顺时针（壶顶偏右）：站位在左半边的壶向舞台中间倾，不往画面外甩
  const lean = c.home.x < w.layout.stage.width / 2 ? 0.34 : -0.34;
  const raised: Pose = { ...c.home, y: c.home.y - 70, rot: lean, z: 2 };
  t = w.arc(tr, t, t + w.ms(380), raised, 10);
  // 3. 摇：沿壶身轴线往复（snap：两端急停），叠一点前后摆
  const tShake = t;
  w.osc(c.track.osc, tShake, tShake + shakeMs, { freqHz: 3.6, along: amp, across: amp * 0.25, rot: 0.14, wave: "snap" }, w.ms(140));
  w.scalar(c.track.tumble, tShake, tShake + w.ms(160), 1, "easeOut");
  w.scalar(c.track.tumble, tShake + shakeMs - w.ms(140), tShake + shakeMs, 0, "easeIn");
  // 起霜：摇到一半壶壁开始白
  const hasIce = c.sem.iceSolidMl > 0;
  if (!s.dryShake && hasIce) {
    c.sem.temperatureC = physics.TEMP_CHILLED_C - 2;
    w.scalar(c.track.frost, tShake + shakeMs * 0.3, tShake + shakeMs, frostLevel(c.sem), "easeIn");
  }
  // 语义：起泡、稀释、混匀、打散气泡 —— 摇的过程中逐渐完成
  const all = [...bySlot.values()];
  if (s.dryShake || !hasIce) buildFoam(c.sem, all, vocab, physics.FOAM_YIELD.dryShake);
  else {
    buildFoam(c.sem, all, vocab, physics.FOAM_YIELD.wetShake);
    const rate =
      physics.SHAKE_DILUTION[intensity] *
      Math.min(1, (s.durationSec ?? physics.SHAKE_REFERENCE_SEC) / physics.SHAKE_REFERENCE_SEC);
    dilute(c.sem, rate, c.shape.capacityMl);
  }
  mix(c.sem, physics.MIXEDNESS_TARGET.SHAKE, w.uids, { cloudy: true });
  killCarbonation(c.sem);
  w.snap(c, tShake + shakeMs * 0.15, tShake + shakeMs * 0.75, "easeInOut");
  // 摇的时候冰块在罐内乱撞：冰堆重新落定（摇完后冰块的位置跟摇前不一样）
  if (c.epoch && c.iceSpec && c.epoch.pieces.length > 0) {
    const re = pileIce(c.shape, c.iceSpec.kind, c.iceSpec.fill * 0.92, w.seed(`reshake:${s.id}`));
    w.setIce(c, tShake + shakeMs, re.pieces, re.topV);
  }
  t = tShake + shakeMs;
  // 4. 放回、揭盖
  t = w.arc(tr, t, t + w.ms(380), c.home, 8);
  stir(w, c, t - w.ms(60), w.ms(160), 0.45);
  w.scalar(c.track.lid, t + w.ms(80), t + w.ms(320), 0, "easeOut");
  return t + w.ms(340);
};

/** 搅拌：吧勺插到杯底，贴着杯壁画圈（侧视是左右往复，尖端几乎不动、柄尾摆幅大）。 */
const STIR: Handler<StepOf<"STIR">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const spoon = w.tool("barspoon", "barspoon", 280);
  const r0 = rimRadius(c.shape) * c.home.scale;
  const tip: Pose = { x: c.home.x + r0 * 0.35, y: c.home.y - 6, rot: 0.06, scale: 1, opacity: 1, z: 2 };
  let t = enter(w, spoon, t0, { ...tip, y: tip.y - 30 }, 320);
  t = w.move(spoon.track.pose, t, t + w.ms(220), tip, "easeOut");
  const dur = w.ms(physics.realToAnimMs(s.durationSec, 1400) + 200);
  // 吧勺绕杯轴转：侧视投影 = 尖端沿杯底左右往复 ±0.55r，杆身随之摆
  w.osc(spoon.track.osc, t, t + dur, { freqHz: 1.6, along: 0, across: r0 * 0.5, rot: 0.04, wave: "sine" }, w.ms(160));
  w.scalar(c.track.swirl, t, t + w.ms(240), 1, "easeOut");
  w.scalar(c.track.swirl, t + dur - w.ms(260), t + dur + w.ms(200), 0, "easeIn");
  stir(w, c, t, dur, 0.35);
  dilute(
    c.sem,
    physics.STIR_DILUTION * Math.min(1, (s.durationSec ?? physics.STIR_REFERENCE_SEC) / physics.STIR_REFERENCE_SEC),
    c.shape.capacityMl,
  );
  c.sem.temperatureC = Math.min(c.sem.temperatureC, physics.TEMP_CHILLED_C);
  mix(c.sem, physics.MIXEDNESS_TARGET.STIR, w.uids);
  w.snap(c, t + dur * 0.1, t + dur * 0.8, "easeInOut");
  if (c.sem.iceSolidMl > 0) chillTo(w, c, t, dur);
  t += dur;
  t = w.move(spoon.track.pose, t, t + w.ms(200), { y: tip.y - 40 }, "easeIn");
  return exit(w, spoon, t, 260);
};

const SWIZZLE: Handler<StepOf<"SWIZZLE">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const stick = w.tool("swizzle", "swizzle", 260);
  const tip: Pose = { x: c.home.x, y: c.home.y - 10, rot: 0, scale: 1, opacity: 1, z: 2 };
  let t = enter(w, stick, t0, { ...tip, y: tip.y - 30 }, 320);
  t = w.move(stick.track.pose, t, t + w.ms(220), tip, "easeOut");
  const dur = w.ms(physics.realToAnimMs(s.durationSec, 1100) + 300);
  // 掌心对搓自旋 + 上下抽动（渲染器按 phase 画枝杈转动）
  w.osc(stick.track.osc, t, t + dur, { freqHz: 5, along: 7, across: 0, rot: 0, wave: "sine" }, w.ms(120));
  w.scalar(c.track.swirl, t, t + w.ms(200), 1, "easeOut");
  w.scalar(c.track.swirl, t + dur - w.ms(200), t + dur, 0, "easeIn");
  stir(w, c, t, dur, 0.55);
  dilute(c.sem, physics.SWIZZLE_DILUTION, c.shape.capacityMl);
  mix(c.sem, physics.MIXEDNESS_TARGET.SWIZZLE, w.uids, { cloudy: true });
  c.sem.temperatureC = physics.TEMP_SWIZZLE_C;
  w.snap(c, t + dur * 0.1, t + dur * 0.8, "easeInOut");
  w.scalar(c.track.frost, t, t + dur, frostLevel(c.sem), "easeIn");
  t += dur;
  t = w.move(stick.track.pose, t, t + w.ms(200), { y: tip.y - 40 }, "easeIn");
  return exit(w, stick, t, 260);
};

/**
 * ROLL / THROW：在两个容器之间来回倒 `times` 次。
 *   ROLL  —— 两个容器贴着倒（口对口，液柱很短），不起泡；
 *   THROW —— 接的那只放低、倒的那只边倒边举高，液柱拉成一条长线，带进空气。
 * 每一趟都真的转移液体，最后一趟落在 `to`。
 */
function rollOrThrow(s: StepOf<"ROLL"> | StepOf<"THROW">, ctx: Ctx, t0: number): number {
  const { w } = ctx;
  const a = w.vessel(s.from);
  const b = w.vessel(s.to);
  const isThrow = s.action === "THROW";
  const high = isThrow && (s as StepOf<"THROW">).height !== "low";
  const n = Math.max(1, s.times) * 2 - 1; // a→b, b→a, …, 最后落在 b
  // 两只都举起来：接的在下、倒的在上
  const center = (a.home.x + b.home.x) / 2;
  const lowY = w.layout.stage.counterY - 8;
  let t = t0;
  let src = a;
  let dst = b;
  for (let i = 0; i < n; i++) {
    // 接的器具放到中间偏下（THROW 放得更低，液柱更长）
    const recvPose: Pose = { ...dst.home, x: center + (isThrow ? 26 : 18), y: Math.min(dst.home.y, lowY - footShift(dst)), z: 2 };
    t = w.move(dst.track.pose, Math.max(t, lastT(dst.track.pose)), Math.max(t, lastT(dst.track.pose)) + w.ms(260), recvPose);
    const ml = liquidMl(src.sem);
    const color = mixedColor(src.sem.layers);
    const r = pour(w, src, dst, t, {
      ml,
      color,
      viscosity: "low",
      clearance: isThrow ? (high ? 96 : 56) : 10,
      liftDuring: isThrow ? (high ? 40 : 18) : 0,
      durMs: isThrow ? 620 : 520,
      width: isThrow ? 2.4 : 3.6,
      after: i === n - 1 ? "home" : "stay",
      onPour: (land, end) => {
        w.snap(dst, land, land, "hold");
        w.snap(src, land, land, "hold");
        transfer(src.sem, dst.sem, {});
        dilute(dst.sem, (isThrow ? physics.THROW_DILUTION : physics.ROLL_DILUTION) / n, dst.shape.capacityMl);
        mix(dst.sem, isThrow ? physics.MIXEDNESS_TARGET.THROW : physics.MIXEDNESS_TARGET.ROLL, w.uids);
        if (isThrow) dst.sem.foamMl = Math.max(dst.sem.foamMl, 4);
        w.snap(dst, land, end, "linear");
        w.agitate(dst, land, end - land, 0.7);
      },
    });
    t = r.endMs + w.ms(160);
    [src, dst] = [dst, src];
  }
  // 两只都回位（最后接酒的那只 = src，经交换后）
  const e1 = w.move(a.track.pose, Math.max(t, lastT(a.track.pose)), Math.max(t, lastT(a.track.pose)) + w.ms(360), a.home);
  const e2 = w.move(b.track.pose, Math.max(t, lastT(b.track.pose)), Math.max(t, lastT(b.track.pose)) + w.ms(360), b.home);
  return Math.max(e1, e2);
}

function footShift(v: Vessel): number {
  return v.shape.stem ? v.shape.stem.height * v.home.scale : 0;
}

const ROLL: Handler<StepOf<"ROLL">> = (s, ctx, t0) => rollOrThrow(s, ctx, t0);
const THROW: Handler<StepOf<"THROW">> = (s, ctx, t0) => rollOrThrow(s, ctx, t0);

const BLEND: Handler<StepOf<"BLEND">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const dur = w.ms(physics.realToAnimMs(s.durationSec, 1200) + 400);
  let t = t0;
  w.scalar(c.track.lid, t, t + w.ms(240), 1, "easeIn");
  t += w.ms(300);
  // 机身嗡嗡震：小幅高频
  const hi = s.speed !== "low";
  w.osc(c.track.osc, t, t + dur, { freqHz: hi ? 11 : 7, along: 0, across: 1.2, rot: 0.004, wave: "sine" }, w.ms(120));
  w.scalar(c.track.tumble, t, t + w.ms(200), 1, "easeOut");
  w.scalar(c.track.tumble, t + dur - w.ms(200), t + dur, 0, "easeIn");
  // 冰被打碎成冰沙：冰块在前三分之一里消失
  if (c.epoch) {
    for (const p of c.epoch.pieces) if (p.leaveAt === Infinity) p.leaveAt = t + Math.round(dur * 0.35);
  }
  dilute(c.sem, physics.BLEND_DILUTION * Math.min(1, (s.durationSec ?? physics.BLEND_REFERENCE_SEC) / physics.BLEND_REFERENCE_SEC), c.shape.capacityMl);
  // 冰的体积并进液体（冰沙）
  const slush = c.sem.iceSolidMl;
  for (const l of c.sem.layers) {
    l.ml += slush / Math.max(1, c.sem.layers.length);
    l.texture = "creamy";
    l.opacity = Math.min(1, l.opacity + 0.2);
  }
  c.sem.iceSolidMl = 0;
  mix(c.sem, physics.MIXEDNESS_TARGET.BLEND, w.uids);
  c.sem.temperatureC = physics.TEMP_SWIZZLE_C;
  w.snap(c, t + dur * 0.1, t + dur * 0.6, "easeInOut");
  w.setIce(c, t + Math.round(dur * 0.36), [], 0);
  c.iceSpec = null;
  w.scalar(c.track.frost, t, t + dur, frostLevel(c.sem), "easeIn");
  t += dur;
  w.scalar(c.track.lid, t + w.ms(120), t + w.ms(360), 0, "easeOut");
  return t + w.ms(380);
};

/**
 * STRAIN：霍桑滤网卡在壶口（随壶身一起倾斜，是挂在器具上的附件而不是独立漂浮的贴图），
 * 冰被挡在壶里，液体从滤网缝里流出。双重过滤 / 细滤：杯口上方再架一只细滤网，
 * 液柱先落进细滤网、再从网底细细流进杯里。
 */
const STRAIN: Handler<StepOf<"STRAIN">> = (s, ctx, t0) => {
  const { w } = ctx;
  const src = w.vessel(s.from);
  const dst = w.vessel(s.to);
  const fine = s.double === true || s.strainer === "fine";
  const main: ToolKind | null =
    s.strainer === "julep" ? "julep" : s.strainer === "none" ? null : s.strainer === "fine" && !s.double ? null : "hawthorne";
  let t = t0;
  // 主滤网挂到源器具口上
  if (main) {
    const st = w.tool(main, main, rimRadius(src.shape) * src.home.scale * 2.1);
    const rimTop = src.home.y - src.shape.height * src.home.scale;
    t = enter(w, st, t, { x: src.home.x, y: rimTop - 2, rot: 0, scale: 1, opacity: 1, z: 2 }, 300);
    st.track.attach.push({ vessel: src.id, fromMs: t, toMs: Infinity, u: 0, v: src.shape.height + 1, rot: 0 });
  }
  // 细滤网架在杯口上方
  let fineTool: Tool | null = null;
  if (fine) {
    fineTool = w.tool("fine_strainer", "fine_strainer", 54);
    const fy = dst.home.y - dst.shape.height * dst.home.scale - 34;
    t = enter(w, fineTool, t, { x: dst.home.x, y: fy, rot: 0, scale: 1, opacity: 1, z: 2 }, 300);
  }
  const ml = liquidMl(src.sem);
  const color = mixedColor(src.sem.layers);
  const iceIn = src.epoch;
  const fx = dst.home.x;
  const fineY = fineTool ? last(fineTool.track.pose).y : 0;
  const r = pour(w, src, fineTool ? null : dst, t, {
    ml,
    color,
    viscosity: "low",
    clearance: 18,
    width: 3.4,
    ...(fineTool
      ? { to: { id: "fine_strainer", x: fx, y: fineY - 8, rimY: fineY - 14 } }
      : {}),
    onPour: (land, end) => {
      const lag = fineTool ? w.ms(180) : 0;
      w.snap(dst, land + lag, land + lag, "hold");
      transfer(src.sem, dst.sem, { fineStrain: fine });
      w.snap(dst, land + lag, end + lag, "linear");
      w.agitate(dst, land + lag, end - land, 0.5);
      if (fineTool) {
        // 细滤网下：一条细流落进杯里
        w.streams.push({
          from: "fine_strainer",
          to: dst.id,
          startMs: land + lag - w.ms(40),
          endMs: end + lag,
          color,
          width: 1.6,
          mode: "pour",
          speed: 0,
        });
      }
    },
  });
  void iceIn;
  // 冰留在壶里（倒的时候冰压在滤网上，回正后落回壶底 —— 冰堆形状不变）
  t = r.doneMs;
  for (const id of [main, fine ? "fine_strainer" : null]) {
    if (!id) continue;
    const st = w.tools.get(id)!;
    const a = st.track.attach[st.track.attach.length - 1];
    if (a && a.toMs === Infinity) {
      a.toMs = t;
      key(st.track.pose, t, { x: src.home.x, y: src.home.y - src.shape.height * src.home.scale - 2, rot: 0, scale: 1, opacity: 1, z: 2 }, "hold");
    }
    exit(w, st, t + w.ms(40));
  }
  return t + w.ms(200);
};

/** DUMP：连冰带酒整个倒过去（冰块从口沿滚出来、落进目标）。 */
const DUMP: Handler<StepOf<"DUMP">> = (s, ctx, t0) => {
  const { w } = ctx;
  const src = w.vessel(s.from);
  const dst = w.vessel(s.to);
  const ml = liquidMl(src.sem);
  const color = mixedColor(src.sem.layers);
  const r = pour(w, src, dst, t0, {
    ml,
    color,
    viscosity: "medium",
    clearance: 22,
    width: 5,
    onPour: (land, end) => {
      w.snap(dst, land, land, "hold");
      transfer(src.sem, dst.sem, {});
      // 冰跟着过去
      dst.sem.iceSolidMl += src.sem.iceSolidMl;
      dst.sem.icePorosity = src.sem.icePorosity;
      src.sem.iceSolidMl = 0;
      w.snap(dst, land, end, "linear");
      w.snap(src, land, end, "linear");
      w.agitate(dst, land, end - land, 0.8);
      if (src.epoch && src.iceSpec) {
        for (const p of src.epoch.pieces) if (p.leaveAt === Infinity) p.leaveAt = land;
        const spec = src.iceSpec;
        const scale = Math.min(1, (src.shape.capacityMl * spec.fill) / dst.shape.capacityMl);
        const re = pileIce(dst.shape, spec.kind, Math.min(0.95, scale + 0.1), w.seed(`dump:${s.id}`));
        const rnd = makeRandom(w.seed(`dumpdrop:${s.id}`));
        const pieces = re.pieces.map((p, i) => ({
          ...p,
          dropAt: land + Math.round(((end - land) * i) / Math.max(1, re.pieces.length)),
          dropFromU: (rnd() * 2 - 1) * 8,
          dropFromV: dst.shape.height + 30,
        }));
        w.setIce(dst, land, pieces, re.topV);
        dst.iceSpec = { kind: spec.kind, fill: Math.min(0.95, scale + 0.1) };
        w.setIce(src, land, [], 0);
        src.iceSpec = null;
      }
    },
  });
  return r.doneMs;
};

const GARNISH: Handler<StepOf<"GARNISH">> = (s, ctx, t0) => {
  const { w, bySlot } = ctx;
  const c = w.vessel(s.target);
  const gid = s.garnishId ?? (s.items && s.items[0] ? bySlot.get(s.items[0])?.ingredientId : undefined) ?? "unknown";
  const color = colorOf(ctx, gid, "#8fbf5a");
  let t = t0;
  if (s.prep === "expressed") {
    // 挤皮油：一片皮在杯口上方对折一捏，喷出一团油雾
    const peel = w.tool(`peel:${s.id}`, "peel", 24, color);
    const top = c.home.y - c.shape.height * c.home.scale;
    t = enter(w, peel, t, { x: c.home.x + 6, y: top - 40, rot: -0.3, scale: 1, opacity: 1, z: 2 }, 300);
    t = w.move(peel.track.pose, t, t + w.ms(160), { rot: 0.5, y: top - 34 }, "easeIn");
    w.effects.push({
      kind: "mist",
      seed: w.seed(`mist:${s.id}`),
      startMs: t,
      endMs: t + w.ms(700),
      rate: 46,
      region: { x: c.home.x - 18, y: top - 32, w: 36, h: 10 },
      drift: { vx: 0, vy: 26 },
      size: { min: 0.6, max: 1.6 },
      color: "#fff6d8",
      opacity: 0.4,
    });
    t += w.ms(300);
    exit(w, peel, t);
    if (s.discard) return t + w.ms(200);
  }
  w.snap(c, t, t, "hold");
  const prev = c.sem.garnishes.filter((g) => !(g.garnishId === gid && g.position === s.position));
  c.sem.garnishes = [...prev, { garnishId: gid, position: s.position, prep: s.prep ?? "none", color, addedAt: t }];
  w.snapNow(c, t);
  if (s.position === "in_glass" || s.position === "float") stir(w, c, t + w.ms(380), w.ms(200), 0.3);
  return t + w.ms(640);
};

const SPRITZ: Handler<StepOf<"SPRITZ">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const spray = w.tool("spray", "spray", 40);
  const top = c.home.y - c.shape.height * c.home.scale;
  let t = enter(w, spray, t0, { x: c.home.x + 46, y: top - 44, rot: -0.35, scale: 1, opacity: 1, z: 2 }, 300);
  const n = s.sprays ?? 1;
  for (let i = 0; i < n; i++) {
    t = w.move(spray.track.pose, t, t + w.ms(90), { rot: -0.45 }, "easeIn");
    w.effects.push({
      kind: "mist",
      seed: w.seed(`spritz:${s.id}:${i}`),
      startMs: t,
      endMs: t + w.ms(520),
      rate: 60,
      region: { x: c.home.x - 20, y: top - 40, w: 40, h: 12 },
      drift: { vx: -20, vy: 22 },
      size: { min: 0.6, max: 1.4 },
      color: "#fff6d8",
      opacity: 0.38,
    });
    t = w.move(spray.track.pose, t, t + w.ms(160), { rot: -0.35 }, "easeOut");
  }
  return exit(w, spray, t + w.ms(120));
};

const FLAME: Handler<StepOf<"FLAME">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const top = c.home.y - c.shape.height * c.home.scale;
  const dur = w.ms(physics.realToAnimMs(s.durationSec, 1200));
  const lighter = w.tool("lighter", "lighter", 30);
  let t = enter(w, lighter, t0, { x: c.home.x + 34, y: top - 20, rot: -0.2, scale: 1, opacity: 1, z: 2 }, 300);
  if (s.subject === "peel_oil") {
    // 火焰喷皮：皮油穿过火苗，爆出一团火星
    const peel = w.tool(`peel:${s.id}`, "peel", 24, "#e8912a");
    enter(w, peel, t0 + w.ms(80), { x: c.home.x + 58, y: top - 30, rot: -0.3, scale: 1, opacity: 1, z: 2 }, 300);
    t += w.ms(120);
    w.move(peel.track.pose, t, t + w.ms(140), { rot: 0.5 }, "easeIn");
    w.effects.push({
      kind: "sparks",
      seed: w.seed(`sparks:${s.id}`),
      startMs: t + w.ms(140),
      endMs: t + w.ms(140) + Math.min(dur, w.ms(700)),
      rate: 90,
      region: { x: c.home.x + 12, y: top - 30, w: 22, h: 8 },
      drift: { vx: -60, vy: 30 },
      size: { min: 1.5, max: 4 },
      color: "#ffb038",
      opacity: 0.85,
    });
    t += w.ms(140) + Math.min(dur, w.ms(700));
    exit(w, peel, t);
  } else {
    // 点燃液面：打火机凑到液面，火苗在液面上烧一会儿
    const surf = surfaceY(c);
    w.move(lighter.track.pose, t, t + w.ms(200), { x: c.home.x + 16, y: Math.max(top - 8, surf - 12) }, "easeInOut");
    t += w.ms(220);
    w.effects.push({
      kind: "flame",
      seed: w.seed(`flame:${s.id}`),
      startMs: t,
      endMs: t + dur,
      rate: 40,
      region: { x: c.home.x - rimRadius(c.shape) * c.home.scale * 0.6, y: surf - 14, w: rimRadius(c.shape) * c.home.scale * 1.2, h: 14 },
      drift: { vx: 0, vy: -46 },
      size: { min: 1.5, max: 5 },
      color: "#ff8a24",
      opacity: 0.85,
    });
    exit(w, lighter, t + w.ms(120));
    return t + dur;
  }
  return exit(w, lighter, t);
};

const SMOKE: Handler<StepOf<"SMOKE">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const dur = w.ms(physics.realToAnimMs(s.durationSec, 1600));
  const top = c.home.y - c.shape.height * c.home.scale;
  let t = t0;
  let cloche: Tool | null = null;
  if (s.cover) {
    cloche = w.tool("cloche", "cloche", rimRadius(c.shape) * c.home.scale * 2.6 + 10);
    t = enter(w, cloche, t, { x: c.home.x, y: w.layout.stage.counterY + 2, rot: 0, scale: 1, opacity: 1, z: 2 }, 420);
  }
  const gun = w.tool("smoke_gun", "smoke_gun", 60);
  t = enter(w, gun, t, { x: c.home.x + 70, y: top - 30, rot: 0, scale: 1, opacity: 1, z: 2 }, 300);
  w.scalar(c.track.smoke, t, t + dur * 0.6, physics.SMOKE_PEAK_DENSITY, "easeOut");
  w.effects.push({
    kind: "smoke",
    seed: w.seed(`gun:${s.id}`),
    startMs: t,
    endMs: t + dur * 0.6,
    rate: 22,
    region: { x: c.home.x + 10, y: top - 28, w: 20, h: 8 },
    drift: { vx: -30, vy: 12 },
    size: { min: 6, max: 14 },
    color: "#e8eef2",
    opacity: 0.35,
  });
  exit(w, gun, t + dur * 0.6);
  t += dur;
  if (cloche) {
    // 揭罩：烟一下涌出来
    exit(w, cloche, t, 420);
    w.effects.push({
      kind: "smoke",
      seed: w.seed(`reveal:${s.id}`),
      startMs: t,
      endMs: t + w.ms(1200),
      rate: 26,
      region: { x: c.home.x - rimRadius(c.shape) * c.home.scale, y: top - 6, w: rimRadius(c.shape) * c.home.scale * 2, h: 10 },
      drift: { vx: 8, vy: -22 },
      size: { min: 8, max: 18 },
      color: "#e8eef2",
      opacity: 0.35,
    });
    t += w.ms(420);
  }
  return t;
};

const WAIT: Handler<StepOf<"WAIT">> = (s, ctx, t0) => {
  const { w } = ctx;
  const c = w.vessel(s.target);
  const dur = w.ms(physics.realToAnimMs(s.durationSec, 900));
  if (s.reason === "bloom") c.sem.foamMl *= physics.FOAM_BLOOM_FACTOR;
  if (s.reason === "settle") c.sem.mixedness = Math.max(0, c.sem.mixedness - 0.15);
  w.snap(c, t0, t0 + dur, "easeInOut");
  const sm = last(c.track.smoke);
  if (sm > 0) {
    const halfLives = ((s.durationSec ?? 10) * 1000) / physics.SMOKE_HALFLIFE_MS;
    w.scalar(c.track.smoke, t0, t0 + dur, sm * Math.pow(0.5, halfLives), "easeOut");
  }
  return t0 + dur;
};

const ACTIONS: Record<string, Handler<never>> = {
  CHILL,
  RIM,
  RINSE,
  ADD,
  ICE,
  MUDDLE,
  SHAKE,
  STIR,
  SWIZZLE,
  ROLL,
  THROW,
  BLEND,
  STRAIN,
  DUMP,
  TOP_UP,
  FLOAT,
  GARNISH,
  SPRITZ,
  FLAME,
  SMOKE,
  WAIT,
} as Record<string, Handler<never>>;

// 编译期检查：未用到的导入（编排里留作扩展点）
void poseForLip;
void uprightLevel;
void rimY;
void NO_OSC;
void BLENDER_BASE_H;
export type { IceType };
