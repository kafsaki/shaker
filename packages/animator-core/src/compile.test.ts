/**
 * 编译器的不变量测试。
 *
 * 这里验证的是规范 §9 的两条纪律能不能站住，以及五个真实配方编译出来是否合理。
 * 「能编译通过」不算验证 —— 要跑出来看数。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { FIXTURES, ASSET_TEST_FIXTURES, VOCAB, type Fixture } from "@shaker/seed";
import { heightForVolume } from "@shaker/recipe-ir";
import { compile } from "./compile.ts";
import { particlesAt, sample, stepAt, applyEase } from "./sample.ts";
import type { Effect, Timeline } from "./types.ts";

/** 真实夹具 + asset_test 资源覆盖夹具一起过编译不变量。 */
const ALL_FIXTURES: Fixture[] = [...FIXTURES, ...ASSET_TEST_FIXTURES];

// 显式标注打断推断链：不标的话 tsc 会把下游 JSON.stringify 的结果判成循环引用（TS7022）
const compiled: { f: Fixture; tl: Timeline }[] = ALL_FIXTURES.map((f) => ({
  f,
  tl: compile(f.ir, VOCAB),
}));

/* ══════════════════════════ 结构不变量 ══════════════════════════ */

test("全部配方夹具都能编译", () => {
  assert.equal(compiled.length, ALL_FIXTURES.length);
  for (const { f, tl } of compiled) {
    assert.ok(tl.totalMs > 0, `${f.title} 时长为 0`);
  }
});

test("自转移（DUMP 的 from === to）不无限循环，液体留在原容器", () => {
  // 回归：编辑器允许把 from/to 选成同一容器。修复前 transfer 边遍历
  // from.layers 边往 to.layers push（同一数组），浏览器直接 OOM 卡死。
  const ir = {
    schemaVersion: 1,
    glass: "coupe",
    method: "built",
    ingredients: [
      { slot: "i1", ingredientId: "rum-white", amount: 45, unit: "ml", role: "base" },
    ],
    steps: [
      { id: "s1", action: "ADD", target: "glass", items: ["i1"] },
      { id: "s2", action: "DUMP", from: "glass", to: "glass" },
    ],
  };
  const tl = compile(ir as never, VOCAB);
  assert.ok(tl.totalMs > 0);
  const end = sample(tl, tl.totalMs);
  const glass = end.scene.containers.find((c) => c.id === "glass");
  assert.ok((glass?.layers.length ?? 0) > 0, "自转移不应清空液体");
});

test("每步至少两个关键帧，且 tMs 单调不减", () => {
  for (const { f, tl } of compiled) {
    for (const s of tl.steps) {
      assert.ok(s.keyframes.length >= 2, `${f.title} / ${s.stepId} 只有 ${s.keyframes.length} 帧`);
      for (let i = 1; i < s.keyframes.length; i++) {
        assert.ok(
          s.keyframes[i]!.tMs >= s.keyframes[i - 1]!.tMs,
          `${f.title} / ${s.stepId} 的关键帧时间倒退`,
        );
      }
      // 首尾帧必须贴合步骤边界
      assert.equal(s.keyframes[0]!.tMs, 0);
      assert.equal(s.keyframes[s.keyframes.length - 1]!.tMs, s.durationMs);
    }
  }
});

test("步骤首尾相接，无空隙无重叠", () => {
  for (const { f, tl } of compiled) {
    let expected = 0;
    for (const s of tl.steps) {
      assert.equal(s.startMs, expected, `${f.title} / ${s.stepId} 起点不连续`);
      expected += s.durationMs;
    }
    assert.equal(tl.totalMs, expected, `${f.title} 总时长与步骤之和不符`);
  }
});

test("时间轴末尾有成品定格段，供截封面图", () => {
  for (const { f, tl } of compiled) {
    const last = tl.steps[tl.steps.length - 1]!;
    assert.equal(last.stepId, "__final", `${f.title} 缺少定格段`);
    assert.ok(tl.finalSceneMs < tl.totalMs);
    assert.equal(tl.finalSceneMs, last.startMs);
  }
});

test("静置容器的最低点都落在台面线上（碗底 y + 柱脚/底座落差 = 464）", () => {
  // 台面线 = stage.height − 14×4 = 464（渲染器 drawBackdrop 的 counterY）
  const COUNTER_Y = 464;
  for (const { f, tl } of compiled) {
    const last = tl.steps[tl.steps.length - 1]!;
    const scene = last.keyframes[last.keyframes.length - 1]!.scene;
    for (const c of scene.containers) {
      const vessel = VOCAB.vessel(c.vesselId);
      assert.ok(vessel, `${f.title} 的容器 ${c.vesselId} 不在词表`);
      const h = vessel.scale * 20; // UNITS_PER_CM
      const drop = vessel.def.shape.stem ? vessel.def.shape.stem.height * h + 4 : 4;
      assert.ok(
        Math.abs(c.y + drop - COUNTER_Y) < 0.01,
        `${f.title} 的 ${c.vesselId} 最低点不在台面上：y=${c.y} + drop=${drop} ≠ ${COUNTER_Y}`,
      );
    }
  }
});

test("IR 的每个步骤都在 Timeline 里有对应项", () => {
  for (const { f, tl } of compiled) {
    const irIds = f.ir.steps.map((s) => s.id);
    const tlIds = tl.steps.filter((s) => s.stepId !== "__final").map((s) => s.stepId);
    assert.deepEqual(tlIds, irIds, `${f.title} 的步骤对应关系错了`);
  }
});

test("物理扰动：落冰带水花（绝对时间），冲击扰动高，后续步骤衰减", () => {
  const { tl } = compiled.find((c) => c.f.title === "Negroni")!;
  const iceStep = tl.steps.find((s) => s.action === "ICE")!;

  // 水花效果存在，且已换算成时间轴绝对时间（渲染器按 fxMs 取样）
  const splash = iceStep.keyframes
    .flatMap((k) => k.scene.effects)
    .find((e) => e.kind === "splash") as Effect | undefined;
  assert.ok(splash, "ICE 步骤应有水花效果");
  assert.ok(splash!.startMs >= iceStep.startMs, "水花 startMs 应是绝对时间");
  assert.ok(splash!.endMs > splash!.startMs);

  // 落冰冲击帧扰动 0.95，收尾帧回落到 0.5
  const frames = iceStep.keyframes;
  const agitOf = (i: number): number | undefined =>
    frames[i]!.scene.containers.find((c) => c.id === "glass")?.agitation;
  assert.ok((agitOf(frames.length - 2) ?? 0) > 0.9, "冲击帧扰动应接近 1");
  assert.ok((agitOf(frames.length - 1) ?? 1) < 0.6, "收尾帧扰动应回落");

  // STIR 期间扰动 ~0.55；下一步（GARNISH）衰减到 ≤ 0.2
  const stirStep = tl.steps.find((s) => s.action === "STIR")!;
  const stirAgit = stirStep.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!.agitation;
  assert.ok(stirAgit > 0.3, `STIR 扰动应 >0.3，实际 ${stirAgit}`);
  const stirIdx = tl.steps.indexOf(stirStep);
  const after = tl.steps[stirIdx + 1]!;
  if (after.stepId !== "__final") {
    const afterAgit = after.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!.agitation;
    assert.ok(afterAgit <= stirAgit * 0.4 + 0.01, `下一步扰动应大幅衰减，实际 ${afterAgit}`);
  }
});

/* ══════════════════════════ compile 是纯函数 ══════════════════════════ */

test("同一份输入编译两次得到逐字节相同的结果 —— 规范 §9.2 的核心承诺", () => {
  for (const f of ALL_FIXTURES) {
    const a = JSON.stringify(compile(f.ir, VOCAB));
    const b = JSON.stringify(compile(f.ir, VOCAB));
    assert.equal(a, b, `${f.title} 的编译结果不确定（有随机或时间依赖）`);
  }
});

test("speedScale 只缩放时长，不改变场景内容", () => {
  const f = FIXTURES[0]!;
  const slow = compile(f.ir, VOCAB, { speedScale: 0.5 });
  const fast = compile(f.ir, VOCAB, { speedScale: 2 });
  assert.ok(slow.totalMs > fast.totalMs * 3, "0.5× 应比 2× 长约 4 倍");
  assert.equal(slow.steps.length, fast.steps.length);
  // 末帧的液层应完全一致（速度不影响成品）
  const lastLayers = (tl: Timeline) => {
    const s = tl.steps[tl.steps.length - 1]!;
    const g = s.keyframes[0]!.scene.containers.find((c) => c.id === "glass");
    return JSON.stringify(g?.layers);
  };
  assert.equal(lastLayers(slow), lastLayers(fast));
});

/* ══════════════════════════ seek 正确性 ══════════════════════════ */

test("在任意时刻取样都不抛异常，且落在正确的步骤里", () => {
  for (const { f, tl } of compiled) {
    for (let i = 0; i <= 200; i++) {
      const t = (tl.totalMs * i) / 200;
      const r = sample(tl, t);
      assert.ok(r.step.startMs <= t + 0.001, `${f.title} @${t.toFixed(0)}ms 步骤定位错误`);
      assert.ok(t <= r.step.startMs + r.step.durationMs + 0.001);
      assert.ok(r.stepProgress >= 0 && r.stepProgress <= 1);
    }
  }
});

test("越界时刻被夹紧，不抛异常", () => {
  const tl = compiled[0]!.tl;
  assert.doesNotThrow(() => sample(tl, -5000));
  assert.doesNotThrow(() => sample(tl, tl.totalMs + 5000));
  assert.equal(stepAt(tl, -1).index, 0);
  assert.equal(stepAt(tl, tl.totalMs + 1).index, tl.steps.length - 1);
});

test("seek 是幂等的 —— 同一时刻取样两次结果相同（拖时间轴来回不会漂移）", () => {
  const tl = compiled[3]!.tl; // Mojito，有碎冰和气泡
  for (const t of [0, 500, 1234, 2500, tl.totalMs * 0.77]) {
    const a = JSON.stringify(sample(tl, t).scene);
    const b = JSON.stringify(sample(tl, t).scene);
    assert.equal(a, b, `@${t}ms 两次取样不一致`);
  }
});

test("正向扫过再反向扫回，每个时刻的场景都一致", () => {
  const tl = compiled[0]!.tl;
  const forward: string[] = [];
  for (let i = 0; i <= 50; i++) forward.push(JSON.stringify(sample(tl, (tl.totalMs * i) / 50).scene));
  const backward: string[] = [];
  for (let i = 50; i >= 0; i--) backward.unshift(JSON.stringify(sample(tl, (tl.totalMs * i) / 50).scene));
  assert.deepEqual(forward, backward, "反向 seek 出现了状态残留");
});

test("缓动函数在端点精确", () => {
  for (const e of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
    assert.equal(applyEase(0, e), 0, e);
    assert.equal(applyEase(1, e), 1, e);
  }
  assert.equal(applyEase(-3, "linear"), 0);
  assert.equal(applyEase(9, "linear"), 1);
});

/* ══════════════════════════ 粒子是 t 的纯函数 ══════════════════════════ */

test("粒子只依赖 (effect, t) —— 同一时刻反复算得到相同位置", () => {
  const tl = compiled[3]!.tl; // Mojito 有气泡
  // 显式标注：assert.ok 的断言收窄要求被断言的变量有确定类型
  const withBubbles: Effect | undefined = tl.steps
    .flatMap((s) => s.keyframes)
    .flatMap((k) => k.scene.effects)
    .find((e) => e.kind === "bubbles");
  // 用普通控制流收窄而不是 assert.ok —— 断言函数的收窄在后续闭包里不稳定
  if (!withBubbles) throw new Error("Mojito 应该产生气泡效果（苏打水 carbonated）");

  for (const t of [0, 120, 700, 1500]) {
    // 标注 : string 是必要的 —— node:assert/strict 的 equal 带 `asserts actual is T` 签名，
    // 两个都不标注时 tsc 会判成互相依赖（TS7022）
    const first: string = JSON.stringify(particlesAt(withBubbles, t));
    const second: string = JSON.stringify(particlesAt(withBubbles, t));
    assert.equal(first, second, `@${t}ms 粒子位置不确定`);
  }
});

test("粒子数量有上限，不会因 rate 过大爆掉", () => {
  const e = {
    kind: "bubbles" as const,
    seed: 1,
    startMs: 0,
    endMs: 100000,
    rate: 100000,
    region: { x: 0, y: 0, w: 10, h: 10 },
    drift: { vx: 0, vy: -10 },
    size: { min: 1, max: 2 },
    color: "#fff",
    opacity: 1,
  };
  assert.ok(particlesAt(e, 50000).length <= 220);
});

test("效果开始前没有粒子", () => {
  const e = {
    kind: "smoke" as const,
    seed: 7,
    startMs: 500,
    endMs: 2000,
    rate: 20,
    region: { x: 0, y: 0, w: 10, h: 10 },
    drift: { vx: 0, vy: 10 },
    size: { min: 1, max: 2 },
    color: "#eee",
    opacity: 1,
  };
  assert.equal(particlesAt(e, 0).length, 0);
  assert.equal(particlesAt(e, 499).length, 0);
  assert.ok(particlesAt(e, 1200).length > 0);
});

/* ══════════════════════════ 物理合理性 ══════════════════════════ */

test("每个配方最终都有液体在成品杯里", () => {
  for (const { f, tl } of compiled) {
    const last = tl.steps[tl.steps.length - 1]!;
    const glass = last.keyframes[0]!.scene.containers.find((c) => c.id === "glass");
    assert.ok(glass, `${f.title} 成品杯不在场景里`);
    assert.ok(glass.layers.length > 0, `${f.title} 成品杯里没有液层`);
    const top = glass.layers[glass.layers.length - 1]!;
    assert.ok(top.toH > 0.05, `${f.title} 液面太低（${top.toH.toFixed(3)}），疑似体积算错`);
    assert.ok(top.toH <= 1.001, `${f.title} 液面溢出杯口（${top.toH.toFixed(3)}）`);
  }
});

test("液层自下而上、首尾相接、不重叠", () => {
  for (const { f, tl } of compiled) {
    for (const s of tl.steps) {
      for (const kf of s.keyframes) {
        for (const c of kf.scene.containers) {
          for (let i = 0; i < c.layers.length; i++) {
            const l = c.layers[i]!;
            assert.ok(l.fromH <= l.toH + 1e-9, `${f.title} 液层上下界颠倒`);
            if (i > 0) {
              assert.ok(
                Math.abs(l.fromH - c.layers[i - 1]!.toH) < 1e-6,
                `${f.title} 液层之间有空隙`,
              );
            }
          }
        }
      }
    }
  }
});

test("Tequila Sunrise：石榴糖浆密度最大，自然沉到最底层（不需要 FLOAT）", () => {
  const { tl } = compiled.find((c) => c.f.title === "Tequila Sunrise")!;
  const last = tl.steps[tl.steps.length - 1]!;
  const glass = last.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!;
  assert.ok(glass.layers.length >= 2, `应该分层，实际 ${glass.layers.length} 层`);
  const bottom = glass.layers[0]!;
  assert.ok(
    bottom.sourceSlots.includes("i3"),
    `最底层应含石榴糖浆(i3)，实际 ${JSON.stringify(bottom.sourceSlots)}`,
  );
});

test("Highball：搅拌后苏打与威士忌合并成单层（mixedness ≥ 0.8 合层）", () => {
  const { tl } = compiled.find((c) => c.f.title === "Highball")!;
  const last = tl.steps[tl.steps.length - 1]!;
  const glass = last.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!;
  assert.equal(glass.layers.length, 1, `搅匀后应该只有一层，实际 ${glass.layers.length} 层`);
});

test("Daiquiri：硬摇后完全混匀成单层，且液体从摇壶转移到了杯里", () => {
  const { tl } = compiled.find((c) => c.f.title === "Daiquiri")!;
  const last = tl.steps[tl.steps.length - 1]!;
  const scene = last.keyframes[0]!.scene;
  const glass = scene.containers.find((c) => c.id === "glass")!;
  assert.equal(glass.layers.length, 1, "摇匀后应该只有一层");
  // 摇壶已经淡出
  const shaker = scene.containers.find((c) => c.id === "shaker");
  assert.ok(!shaker || shaker.opacity < 0.01, "滤出后摇壶应该不在场景里了");
  // 冰留在摇壶，没跟着进杯子
  assert.equal(glass.ice.length, 0, "STRAIN 不该把冰带进成品杯");
});

test("Negroni：DUMP/STRAIN 都没用，冰一直在杯中", () => {
  const { tl } = compiled.find((c) => c.f.title === "Negroni")!;
  const last = tl.steps[tl.steps.length - 1]!;
  const glass = last.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!;
  assert.ok(glass.ice.length > 0, "杯中直调，冰应该在杯里");
  assert.ok(glass.frost > 0.1, `搅拌后应结霜，实际 ${glass.frost.toFixed(2)}`);
});

test("Mojito：top_up 把杯子补到接近满，且实际量由编译期算出", () => {
  const { tl } = compiled.find((c) => c.f.title === "Mojito")!;
  const last = tl.steps[tl.steps.length - 1]!;
  const glass = last.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!;
  const top = glass.layers[glass.layers.length - 1]!;
  // 碎冰 fill=0.85、porosity=0.28 → 可容液体约容量的 39%；补满后液面应该很高
  assert.ok(top.toH > 0.6, `补满后液面应该很高，实际 ${top.toH.toFixed(3)}`);
  assert.ok(glass.ice.length > 10, "碎冰应该有很多块");
  assert.ok(glass.ice.every((i) => i.kind === "crushed"));
});

test("Whiskey Sour：干摇产生泡沫冠，且泡沫在液面之上", () => {
  const { tl } = compiled.find((c) => c.f.title === "Whiskey Sour")!;
  const last = tl.steps[tl.steps.length - 1]!;
  const glass = last.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!;
  assert.ok(glass.foam, "含蛋清 + 干摇应该有泡沫冠");
  const top = glass.layers[glass.layers.length - 1]!;
  assert.ok(
    glass.foam.fromH >= top.toH - 1e-6,
    `泡沫应在液面之上：foam.fromH=${glass.foam.fromH.toFixed(3)} vs liquid.toH=${top.toH.toFixed(3)}`,
  );
  assert.ok(glass.foam.toH > glass.foam.fromH, "泡沫层应该有厚度");
});

test("Whiskey Sour：3 dash 苦精改变了颜色但没增加液面", () => {
  const { f, tl } = compiled.find((c) => c.f.title === "Whiskey Sour")!;
  // 最后一步是往杯里加苦精
  const beforeBitters = tl.steps[tl.steps.length - 3]!;
  const afterBitters = tl.steps[tl.steps.length - 2]!;
  const g0 = beforeBitters.keyframes[0]!.scene.containers.find((c) => c.id === "glass")!;
  const g1 = afterBitters.keyframes[afterBitters.keyframes.length - 1]!.scene.containers.find(
    (c) => c.id === "glass",
  )!;
  const h0 = g0.layers[g0.layers.length - 1]!.toH;
  const h1 = g1.layers[g1.layers.length - 1]!.toH;
  assert.ok(Math.abs(h1 - h0) < 1e-6, `dash 不该改变液面：${h0.toFixed(4)} → ${h1.toFixed(4)}`);
  assert.notEqual(
    g0.layers[g0.layers.length - 1]!.color,
    g1.layers[g1.layers.length - 1]!.color,
    "3 dash 苦精应该看得出颜色变化",
  );
  void f;
});

test("非线性液面：同一杯里体积相同的两层，上面那层更薄", () => {
  // 用碟形杯验证：coupe 上宽下窄
  const vessel = VOCAB.vessel("coupe")!;
  const h60 = heightForVolume(vessel, 60);
  const h120 = heightForVolume(vessel, 120);
  const lower = h60 - 0;
  const upper = h120 - h60;
  assert.ok(upper < lower, `上层(${upper.toFixed(3)}) 应比下层(${lower.toFixed(3)}) 薄`);
});

/* ══════════════════════════ 文案 ══════════════════════════ */

test("每步都有中英双语文案，且非空", () => {
  for (const { f, tl } of compiled) {
    for (const s of tl.steps) {
      assert.ok(s.label.zh.length > 0, `${f.title} / ${s.stepId} 缺中文文案`);
      assert.ok(s.label.en.length > 0, `${f.title} / ${s.stepId} 缺英文文案`);
    }
  }
});

test("文案里出现的是原料名而不是 slot ID", () => {
  const { tl } = compiled.find((c) => c.f.title === "Daiquiri")!;
  const addStep = tl.steps.find((s) => s.stepId === "s2")!;
  assert.match(addStep.label.zh, /白朗姆/);
  assert.match(addStep.label.en, /White Rum/);
  assert.doesNotMatch(addStep.label.zh, /\bi1\b/);
});

test("时长映射：真实时长越长，动画时长越长，但增长是压缩的", () => {
  const short = compile(
    {
      ...FIXTURES[0]!.ir,
      steps: FIXTURES[0]!.ir.steps.map((s) =>
        s.action === "SHAKE" ? { ...s, durationSec: 3 } : s,
      ),
    },
    VOCAB,
  );
  const long = compile(
    {
      ...FIXTURES[0]!.ir,
      steps: FIXTURES[0]!.ir.steps.map((s) =>
        s.action === "SHAKE" ? { ...s, durationSec: 60 } : s,
      ),
    },
    VOCAB,
  );
  const shakeMs = (tl: Timeline) => tl.steps.find((s) => s.action === "SHAKE")!.durationMs;
  assert.ok(shakeMs(long) > shakeMs(short), "60 秒的摇应该比 3 秒的动画长");
  // 20 倍真实时长不该变成 20 倍动画时长
  assert.ok(shakeMs(long) < shakeMs(short) * 4, "动画时长增长应被对数压缩");
});
