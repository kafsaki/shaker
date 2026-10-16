/**
 * 编译器 + 取样器的不变量测试（ADR-031）。
 *
 * 三类：
 *   ① 纪律：编译确定性、seek 幂等、正反向扫描一致、粒子是 t 的纯函数；
 *   ② 物理：液面、分层、排水、冰堆、液柱轨迹、倾斜液面守恒；
 *   ③ 作者点名的三处出戏的回归：液柱越往下越竖直、冰块堆积不整齐、摇和有往复。
 * 「能编译通过」不算验证 —— 要跑出来看数。
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { ASSET_TEST_FIXTURES, FIXTURES, VOCAB, type Fixture } from "@shaker/fixtures";
import { compileVessel } from "@shaker/recipe-ir";
import { ALL_VESSEL_DEFS } from "@shaker/visual-assets";
import { compile } from "./compile.ts";
import { capacityAtTilt, shapeFromVessel, tiltedLevel, uprightLevel, volumeBelow } from "./geometry.ts";
import { pileIce } from "./ice.ts";
import { particlesAt, sample, stepAt } from "./sample.ts";
import { applyEase } from "./track.ts";
import type { Effect, Scene, Timeline, VesselView } from "./types.ts";

const ALL: Fixture[] = [...FIXTURES, ...ASSET_TEST_FIXTURES];
const compiled: { f: Fixture; tl: Timeline }[] = ALL.map((f) => ({ f, tl: compile(f.ir, VOCAB) }));
const byTitle = (t: string) => compiled.find((c) => c.f.title === t)!;
const glassAt = (tl: Timeline, t: number): VesselView => sample(tl, t).scene.vessels.find((v) => v.id === "glass")!;
const shapes = Object.fromEntries(ALL_VESSEL_DEFS.map((d) => [d.id, shapeFromVessel(compileVessel(d), "glass")]));
/** 工作器具在舞台上被画小了：用编译后时间轴里的剖面（与动画里一致的比例尺）。 */
const shapeWithStageHeight = (id: string) => {
  const tl = compiled.find((c) => Object.values(c.tl.shapes).some((s) => s.id === id))!.tl;
  return Object.values(tl.shapes).find((s) => s.id === id)!;
};

/* ══════════════════════════ 结构 ══════════════════════════ */

test("全部夹具都能编译，步骤与 IR 一一对应、首尾相接", () => {
  for (const { f, tl } of compiled) {
    const ids = tl.steps.filter((s) => s.stepId !== "__final").map((s) => s.stepId);
    assert.deepEqual(ids, f.ir.steps.map((s) => s.id), f.title);
    let expected = 0;
    for (const s of tl.steps) {
      assert.equal(s.startMs, expected, `${f.title}/${s.stepId} 起点不连续`);
      assert.ok(s.durationMs > 0, `${f.title}/${s.stepId} 时长为 0`);
      expected += s.durationMs;
    }
    assert.equal(tl.totalMs, expected);
    assert.equal(tl.steps.at(-1)!.stepId, "__final");
    assert.equal(tl.finalSceneMs, tl.totalMs);
  }
});

test("自转移（DUMP 的 from === to）不卡死，液体留在原容器", () => {
  const ir = {
    schemaVersion: 1,
    glass: "coupe",
    method: "built",
    ingredients: [{ slot: "i1", ingredientId: "rum-white", amount: 45, unit: "ml", role: "base" }],
    steps: [
      { id: "s1", action: "ADD", target: "glass", items: ["i1"] },
      { id: "s2", action: "DUMP", from: "glass", to: "glass" },
    ],
  };
  const tl = compile(ir as never, VOCAB);
  assert.ok(glassAt(tl, tl.totalMs).layers.length > 0);
});

test("定格段绝对静止：器具都在原位、没有工具、没有液柱，扰动归零", () => {
  for (const { f, tl } of compiled) {
    const fin = tl.steps.at(-1)!;
    const a = sample(tl, fin.startMs).scene;
    const b = sample(tl, tl.totalMs).scene;
    assert.equal(b.streams.length, 0, `${f.title} 封面帧还有液柱`);
    assert.equal(b.tools.filter((t) => t.kind !== "blender_base").length, 0, `${f.title} 封面帧还有工具：${b.tools.map((t) => t.kind)}`);
    for (const v of b.vessels) {
      const v0 = a.vessels.find((x) => x.id === v.id)!;
      assert.ok(Math.abs(v.x - v0.x) < 0.01 && Math.abs(v.y - v0.y) < 0.01 && Math.abs(v.rot) < 1e-3, `${f.title} 的 ${v.id} 定格段还在动`);
      assert.ok(v.agitation < 0.02 && v.tumble < 0.01, `${f.title} 的 ${v.id} 定格段液面还在晃`);
    }
    assert.ok(!b.effects.some((e) => e.kind === "sparks" || e.kind === "mist"), `${f.title} 封面帧还有火星/喷雾`);
  }
});

test("静置器具的最低点都在台面线上", () => {
  for (const { f, tl } of compiled) {
    const scene = sample(tl, tl.totalMs).scene;
    for (const v of scene.vessels) {
      if (v.kind === "bottle" || v.shapeId === "__blender") continue;
      const s = scene.shapes[v.id] ?? scene.shapes[v.shapeId]!;
      const drop = s.stem ? s.stem.height + 4 : 4;
      assert.ok(Math.abs(v.y + drop * v.scale - tl.stage.counterY) < 0.01, `${f.title} 的 ${v.id} 没放在台面上`);
    }
  }
});

test("酒架在杯口之上：架上的瓶子不和台面器具重叠", () => {
  for (const { f, tl } of compiled) {
    const scene = sample(tl, 0).scene;
    const tops = scene.vessels.filter((v) => v.kind !== "bottle").map((v) => v.y - v.height * v.scale);
    for (const b of scene.vessels.filter((v) => v.kind === "bottle")) {
      assert.ok(b.y < Math.min(...tops) - 20, `${f.title} 的 ${b.id} 压在杯口上`);
    }
  }
});

/* ══════════════════════════ 纪律 ══════════════════════════ */

test("同一份输入编译两次逐字节相同（compile 纯函数）", () => {
  for (const f of ALL) assert.equal(JSON.stringify(compile(f.ir, VOCAB)), JSON.stringify(compile(f.ir, VOCAB)), f.title);
});

test("speedScale 只改时长，不改成品", () => {
  const f = FIXTURES[0]!;
  const slow = compile(f.ir, VOCAB, { speedScale: 0.5 });
  const fast = compile(f.ir, VOCAB, { speedScale: 2 });
  assert.ok(slow.totalMs > fast.totalMs * 3.5);
  const top = (tl: Timeline) => JSON.stringify(glassAt(tl, tl.totalMs).layers.map((l) => [l.color, Math.round(l.topY)]));
  assert.equal(top(slow), top(fast));
});

test("任意时刻取样不抛异常、不出 NaN，落在正确的步骤", () => {
  for (const { f, tl } of compiled) {
    for (let i = 0; i <= 160; i++) {
      const t = (tl.totalMs * i) / 160;
      const r = sample(tl, t);
      assert.ok(r.step.startMs <= t + 1e-6 && t <= r.step.startMs + r.step.durationMs + 1e-6);
      for (const v of r.scene.vessels) {
        assert.ok([v.x, v.y, v.rot, ...v.layers.map((l) => l.topY), ...v.ice.flatMap((p) => [p.x, p.y])].every(Number.isFinite), `${f.title}@${t} NaN`);
      }
      for (const s of r.scene.streams) assert.ok(s.points.every((p) => Number.isFinite(p.x + p.y + p.w)));
    }
  }
  assert.doesNotThrow(() => sample(compiled[0]!.tl, -5000));
  assert.equal(stepAt(compiled[0]!.tl, 1e9).index, compiled[0]!.tl.steps.length - 1);
});

test("seek 幂等，正向扫过再反向扫回每一帧都一致", () => {
  const { tl } = byTitle("Mojito");
  const at = (t: number) => JSON.stringify(sample(tl, t).scene);
  const ts = Array.from({ length: 40 }, (_, i) => (tl.totalMs * i) / 39);
  const fwd = ts.map(at);
  const back = [...ts].reverse().map(at).reverse();
  assert.deepEqual(fwd, back);
});

test("缓动在端点精确", () => {
  for (const e of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
    assert.equal(applyEase(0, e), 0);
    assert.equal(applyEase(1, e), 1);
  }
});

test("粒子只依赖 (effect, t)，有上限，开始前没有", () => {
  const e: Effect = { kind: "smoke", seed: 7, startMs: 500, endMs: 2000, rate: 20, region: { x: 0, y: 0, w: 10, h: 10 }, drift: { vx: 0, vy: 10 }, size: { min: 1, max: 2 }, color: "#eee", opacity: 1 };
  assert.equal(particlesAt(e, 499).length, 0);
  assert.equal(JSON.stringify(particlesAt(e, 1200)), JSON.stringify(particlesAt(e, 1200)));
  assert.ok(particlesAt({ ...e, rate: 1e5, endMs: 1e5 }, 5e4).length <= 220);
});

/* ══════════════════════════ 物理 ══════════════════════════ */

test("每个配方最终都有液体在成品杯里，液面不溢出杯口", () => {
  for (const { f, tl } of compiled) {
    const g = glassAt(tl, tl.totalMs);
    assert.ok(g.layers.length > 0, `${f.title} 杯里没有液体`);
    const rimY = g.y - g.height * g.scale;
    const bottomY = g.y;
    const top = g.layers.at(-1)!.topY;
    assert.ok(top < bottomY - 4, `${f.title} 液面太低`);
    assert.ok(top >= rimY - 0.5, `${f.title} 液面溢出：top=${top.toFixed(1)} rim=${rimY.toFixed(1)}`);
  }
});

test("液层自下而上：上层的液面不低于下层", () => {
  for (const { f, tl } of compiled) {
    for (let i = 0; i <= 60; i++) {
      for (const v of sample(tl, (tl.totalMs * i) / 60).scene.vessels) {
        for (let k = 1; k < v.layers.length; k++) assert.ok(v.layers[k]!.topY <= v.layers[k - 1]!.topY + 1e-6, `${f.title}/${v.id} 液层颠倒`);
      }
    }
  }
});

test("Tequila Sunrise：石榴糖浆沉底；Highball / Daiquiri 混成单层", () => {
  const sun = glassAt(byTitle("Tequila Sunrise").tl, byTitle("Tequila Sunrise").tl.totalMs);
  assert.ok(sun.layers.length >= 2);
  assert.ok(sun.layers[0]!.sourceSlots.includes("i3"));
  for (const t of ["Highball", "Daiquiri"]) assert.equal(glassAt(byTitle(t).tl, byTitle(t).tl.totalMs).layers.length, 1, t);
});

test("Daiquiri：STRAIN 不把冰带进杯里；Negroni 搅拌后起霜、冰还在杯里", () => {
  const d = byTitle("Daiquiri").tl;
  assert.equal(glassAt(d, d.totalMs).ice.length, 0);
  const n = byTitle("Negroni").tl;
  const g = glassAt(n, n.totalMs);
  assert.ok(g.ice.length > 0 && g.frost > 0.1);
});

test("Whiskey Sour：干摇起泡，泡沫在液面之上；dash 苦精只改颜色不改液面", () => {
  const { tl } = byTitle("Whiskey Sour");
  const g = glassAt(tl, tl.totalMs);
  assert.ok(g.foam && g.foam.topY < g.layers.at(-1)!.topY);
  const add = tl.steps.at(-2)!;
  const before = glassAt(tl, add.startMs);
  const after = glassAt(tl, tl.totalMs);
  assert.ok(Math.abs(before.layers.at(-1)!.topY - after.layers.at(-1)!.topY) < 0.5);
  assert.notEqual(before.layers.at(-1)!.color, after.layers.at(-1)!.color);
});

test("Mojito：碎冰 + 补满，液面接近杯口", () => {
  const { tl } = byTitle("Mojito");
  const g = glassAt(tl, tl.totalMs);
  const rimY = g.y - g.height * g.scale;
  assert.ok(g.layers.at(-1)!.topY < rimY + g.height * g.scale * 0.15);
  assert.ok(g.ice.length > 40 && g.ice.every((p) => p.kind === "crushed"));
});

test("倾斜液面守恒：任意倾角下，求出的水平面以下体积等于液量", () => {
  const s = shapes["rocks"]!;
  for (const rot of [0, 0.4, 0.9, 1.3]) {
    const f = { x: 200, y: 400, rot, scale: 1 };
    for (const ml of [20, 60, 120]) {
      const Y = tiltedLevel(s, f, ml);
      const v = volumeBelow(s, f, Y);
      // 倒不下（超过当前倾角容量）时液面钳在口沿，体积 = 此刻容量；1.5ml 是切片积分的数值误差
      const cap = Math.min(ml, capacityAtTilt(s, f));
      assert.ok(Math.abs(v - cap) < 1.5, `rot=${rot} ml=${ml} → ${v.toFixed(1)}（应为 ${cap.toFixed(1)}）`);
    }
  }
  assert.ok(Math.abs(volumeBelow(s, { x: 0, y: 0, rot: 0, scale: 1 }, -uprightLevel(s, 100)) - 100) < 2);
});

test("倒酒时源器具真的倾斜：酒瓶整个倒过来、靠瓶颈控流", () => {
  const { tl } = byTitle("Highball");
  const add = tl.steps.find((s) => s.action === "ADD")!;
  let maxTilt = 0;
  for (let i = 0; i <= 80; i++) {
    const sc = sample(tl, add.startMs + (add.durationMs * i) / 80).scene;
    for (const b of sc.vessels) if (b.kind === "bottle") maxTilt = Math.max(maxTilt, Math.abs(b.rot));
  }
  assert.ok(maxTilt > 1.6, `酒瓶最大倾角只有 ${maxTilt.toFixed(2)}`);
});

/* ══════════════════════════ 作者点名的三处回归 ══════════════════════════ */

/** 液柱里每一段相对上一段的水平位移 / 竖直位移。 */
function slopes(sc: Scene): number[][] {
  return sc.streams
    .filter((s) => s.mode === "pour" && s.points.length > 6)
    .map((s) => {
      const out: number[] = [];
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1]!;
        const b = s.points[i]!;
        const dy = b.y - a.y;
        if (dy > 1) out.push(Math.abs(b.x - a.x) / dy);
      }
      return out;
    });
}

test("回归：倒注液柱越往下越竖直（抛体运动），不是越往下越往外飘", () => {
  let checked = 0;
  for (const { f, tl } of compiled) {
    for (const st of tl.streams) {
      if (st.mode !== "pour") continue;
      const mid = (st.startMs + st.endMs) / 2;
      for (const sl of slopes(sample(tl, mid).scene)) {
        if (sl.length < 6) continue;
        checked++;
        const head = sl.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const tail = sl.slice(-3).reduce((a, b) => a + b, 0) / 3;
        assert.ok(tail <= head + 0.02, `${f.title} 液柱下段比上段更斜：上 ${head.toFixed(3)} 下 ${tail.toFixed(3)}`);
      }
    }
  }
  assert.ok(checked >= 5, `检查到的液柱太少：${checked}`);
});

test("回归：液柱落点在目标杯口以内（不会偏到杯外）", () => {
  for (const { f, tl } of compiled) {
    for (const st of tl.streams) {
      if (st.mode !== "pour" || st.to === "counter") continue;
      const t = (st.startMs * 0.3 + st.endMs * 0.7);
      const sc = sample(tl, t).scene;
      const dst = sc.vessels.find((v) => v.id === st.to);
      if (!dst) continue;
      const view = sc.streams.find((s) => s.impact && Math.abs(s.impact.x - dst.x) < 200);
      if (!view?.impact) continue;
      const shape = sc.shapes[dst.id] ?? sc.shapes[dst.shapeId]!;
      const r = shape.radii.at(-1)! * dst.scale;
      assert.ok(Math.abs(view.impact.x - dst.x) < r, `${f.title}: ${st.from}→${st.to} 落点偏出杯口 ${Math.abs(view.impact.x - dst.x).toFixed(1)} > ${r.toFixed(1)}`);
    }
  }
});

test("回归：冰块不是整齐的一竖条 —— 横向铺开、高度参差、朝向各异", () => {
  for (const [id, kind, fill] of [
    ["collins", "crushed", 0.85],
    ["rocks", "cube", 0.8],
    ["__shaker", "cube", 0.8],
    ["__mixing_glass", "cube", 0.7],
    ["rocks", "cracked", 0.6],
  ] as const) {
    const s = id.startsWith("__") ? shapeWithStageHeight(id) : shapes[id]!;
    const { pieces } = pileIce(s, kind, fill, 42);
    const us = pieces.map((p) => p.u);
    const spread = Math.max(...us) - Math.min(...us);
    const r0 = s.radii[0]!;
    assert.ok(spread > r0 * 0.9, `${id}/${kind} 横向只铺开 ${spread.toFixed(1)}（杯底半径 ${r0.toFixed(1)}）`);
    // 同一高度带里有多块（不是一块摞一块）
    const rows = new Map<number, number>();
    for (const p of pieces) rows.set(Math.round(p.v / p.h), (rows.get(Math.round(p.v / p.h)) ?? 0) + 1);
    assert.ok(Math.max(...rows.values()) >= 2, `${id}/${kind} 每一层只有一块`);
    const rots = new Set(pieces.map((p) => Math.round(p.rot * 10)));
    assert.ok(rots.size >= Math.min(4, pieces.length), `${id}/${kind} 朝向太整齐`);
    // 冰块不穿出杯壁
    for (const p of pieces) assert.ok(Math.abs(p.u) <= s.radii.at(-1)! + 1, `${id}/${kind} 冰块穿出杯壁`);
  }
});

test("回归：冰块一块块落下（错开时间、自由落体），不是整堆一起出现", () => {
  const { tl } = byTitle("Negroni");
  const ice = tl.steps.find((s) => s.action === "ICE")!;
  const glass = tl.vessels.find((v) => v.id === "glass")!;
  const drops = glass.ice.flatMap((e) => e.pieces.map((p) => p.dropAt)).filter((t) => Number.isFinite(t));
  assert.ok(drops.length >= 1);
  const { tl: m } = byTitle("Mojito");
  const mg = m.vessels.find((v) => v.id === "glass")!;
  const md = mg.ice.flatMap((e) => e.pieces.map((p) => p.dropAt)).filter(Number.isFinite);
  assert.ok(Math.max(...md) - Math.min(...md) > 200, "碎冰应该在一段时间里陆续落下");
  // 下落途中的冰在杯口之上
  const early = sample(m, Math.min(...md) + 40).scene.vessels.find((v) => v.id === "glass")!;
  const rimY = early.y - early.height * early.scale;
  assert.ok(early.ice.some((p) => p.y < rimY), "刚落下的冰应该还在杯口上方");
  void ice;
});

test("回归：摇和是举起来沿壶身往复摇，不是原地抖", () => {
  const { tl } = byTitle("Daiquiri");
  const sh = tl.steps.find((s) => s.action === "SHAKE")!;
  const ys: number[] = [];
  const along: number[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = sh.startMs + (sh.durationMs * i) / 120;
    const v = sample(tl, t).scene.vessels.find((x) => x.id === "shaker")!;
    ys.push(v.y);
    along.push(v.x * Math.sin(v.rot) - v.y * Math.cos(v.rot));
  }
  const home = sample(tl, sh.startMs).scene.vessels.find((x) => x.id === "shaker")!.y;
  assert.ok(Math.min(...ys) < home - 50, "摇的时候应该把壶举起来");
  // 往复：沿轴位移的极差 ≥ 2 倍振幅附近，且来回次数 ≥ 6
  let flips = 0;
  for (let i = 2; i < along.length; i++) {
    const a = along[i - 1]! - along[i - 2]!;
    const b = along[i]! - along[i - 1]!;
    if (a * b < 0 && Math.abs(b) > 0.5) flips++;
  }
  assert.ok(Math.max(...along) - Math.min(...along) > 14, "往复幅度太小");
  assert.ok(flips >= 6, `往复次数太少：${flips}`);
  // 摇的时候盖着盖子、冰在罐里翻滚；摇完揭盖
  const mid = sample(tl, sh.startMs + sh.durationMs * 0.5).scene.vessels.find((x) => x.id === "shaker")!;
  assert.ok(mid.lid > 0.99 && mid.tumble > 0.5);
  const after = sample(tl, sh.startMs + sh.durationMs).scene.vessels.find((x) => x.id === "shaker")!;
  assert.ok(after.lid < 0.5);
});

test("THROW / ROLL 按 times 来回倒：两只容器轮流装过液体，最后一趟落在 to", () => {
  const { tl } = byTitle("asset_test4");
  const roll = tl.steps.find((s) => s.action === "ROLL")!; // glass → secondary，times = 2（三趟）
  let glassEmptied = 0;
  let secFilled = 0;
  let glassRefilled = false;
  for (let i = 0; i <= 120; i++) {
    const sc = sample(tl, roll.startMs + (roll.durationMs * i) / 120).scene;
    const g = sc.vessels.find((v) => v.id === "glass")!;
    const sec = sc.vessels.find((v) => v.id === "secondary")!;
    const gl = g.layers.length > 0 ? g.y - g.layers.at(-1)!.topY : 0;
    const sl = sec.layers.length > 0 ? sec.y - sec.layers.at(-1)!.topY : 0;
    if (gl < 2 && sl > 10) {
      if (secFilled === 0) secFilled = i;
      glassEmptied++;
    }
    if (secFilled > 0 && gl > 10 && sl < 2) glassRefilled = true;
  }
  assert.ok(secFilled > 0, "第一趟应倒进第二容器");
  assert.ok(glassRefilled, "第二趟应倒回成品杯");
  const end = sample(tl, roll.startMs + roll.durationMs).scene;
  assert.equal(end.vessels.find((v) => v.id === "glass")!.layers.length, 0, "三趟之后液体应在 to（第二容器）");
  assert.ok(glassAt(tl, tl.totalMs).layers.length > 0, "下一步 ROLL 倒回成品杯");
  void glassEmptied;
});

/* ══════════════════════════ 全部经典配方（seed.json） ══════════════════════════ */

test("seed.json 的全部经典配方：编译、逐帧取样无 NaN，液柱都落进目标，封面帧干净", () => {
  const seed = JSON.parse(
    readFileSync(new URL("../../../apps/api/internal/seed/data/seed.json", import.meta.url), "utf8"),
  ) as {
    ingredients: { id: string }[];
    glassware: { id: string; nameZh: string; nameEn: string; capacityMl: number; shape: never }[];
    classicRecipes: { titleEn?: string; slug?: string; ir: never }[];
  };
  const ing = new Map(seed.ingredients.map((i) => [i.id, i]));
  const glass = new Map(seed.glassware.map((g) => [g.id, compileVessel(g)]));
  const vocab = { ingredient: (id: string) => ing.get(id) as never, vessel: (id: string) => glass.get(id) };
  assert.ok(seed.classicRecipes.length > 40);
  for (const r of seed.classicRecipes) {
    const name = r.titleEn ?? r.slug ?? "?";
    const tl = compile(r.ir, vocab);
    for (let i = 0; i <= 120; i++) {
      const sc = sample(tl, (tl.totalMs * i) / 120).scene;
      for (const v of sc.vessels) assert.ok([v.x, v.y, v.rot, ...v.layers.map((l) => l.topY)].every(Number.isFinite), `${name} NaN`);
      for (const s of sc.streams) {
        if (!s.impact || s.to === "counter") continue;
        const dst = sc.vessels.find((v) => v.id === s.to);
        if (!dst) continue;
        const shape = sc.shapes[dst.id] ?? sc.shapes[dst.shapeId]!;
        assert.ok(Math.abs(dst.x - s.impact.x) <= shape.radii.at(-1)! * dst.scale, `${name}: ${s.from}→${s.to} 液柱落到杯外`);
      }
    }
    const end = sample(tl, tl.totalMs).scene;
    assert.equal(end.streams.length, 0, `${name} 封面帧还有液柱`);
    assert.ok(!end.tools.some((t) => t.kind !== "blender_base"), `${name} 封面帧还有工具`);
    for (const v of end.vessels) {
      const shape = end.shapes[v.id] ?? end.shapes[v.shapeId]!;
      for (const g of v.garnishes) {
        if (g.position !== "side") continue;
        const counterY = v.y + (shape.stem ? shape.stem.height * v.scale : 0);
        assert.ok(Math.abs(g.y - counterY) < 1.5, `${name}: side 装饰 ${g.garnishId} 悬在碗底，没落到台面`);
      }
    }
  }
});
