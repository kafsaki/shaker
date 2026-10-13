/**
 * IR → Timeline 编译器（ADR-031）。
 *
 * **这是纯函数**（规范 §9.2）：无 IO、无随机、无 Date.now()、不 import 任何渲染 API。
 * 同一份输入在浏览器、Node、WebView 里必须产出逐字节相同的 Timeline。
 *
 * 结构：
 *   layout()      舞台：器具剖面、台面站位、酒架瓶位
 *   World         实体轨道 + 编排原语（world.ts）
 *   ACTIONS[a]    每个动作一个编排函数（actions.ts），从时间游标出发写轨道，返回结束时刻
 *   __final       成品定格段：全部器具回位、道具离场，静止 900ms 供截封面
 */
import { type IngredientRef, type RecipeIR } from "@shaker/recipe-ir/core";
import { runStep } from "./actions.ts";
import { stepLabel } from "./labels.ts";
import { AGITATION_TAU_MS, lifeOf } from "./sample.ts";
import { DEFAULT_STAGE, layout } from "./stage.ts";
import { layerOf } from "./state.ts";
import { lastT } from "./track.ts";
import type { CompileOptions, Pose, ResolvedVocab, Timeline, TimelineStep } from "./types.ts";
import { World } from "./world.ts";

export { WORK_VESSEL_IDS, WORK_VESSELS } from "./stage.ts";

/** 成品定格段时长（毫秒，未缩放）。 */
const HOLD_MS = 900;
/** 步骤之间的呼吸（毫秒，未缩放）：上一步的器具回位与下一步的起手可以略微重叠。 */
const STEP_GAP_MS = 60;

export function compile(ir: RecipeIR, vocab: ResolvedVocab, opts: CompileOptions = {}): Timeline {
  const size = opts.stage ?? DEFAULT_STAGE;
  const speed = opts.speedScale && opts.speedScale > 0 ? opts.speedScale : 1;
  const lay = layout(ir, vocab, size);
  const w = new World(lay, speed);
  const bySlot = new Map<string, IngredientRef>(ir.ingredients.map((r) => [r.slot, r]));

  // ── 实体：台面上的器具、酒架上的瓶子 ──
  for (const [id, st] of lay.stations) {
    const shape = lay.shapes[id]!;
    const home: Pose = { x: st.x, y: st.y, rot: 0, scale: st.scale, opacity: 1, z: 1 };
    w.addVessel(id, id === "jigger" ? "jigger" : "container", shape, home);
    if (shape.id === "__blender") {
      w.addTool("blender_base", "blender_base", 0, { ...home, y: lay.stage.counterY, z: 1 });
    }
  }
  for (const [id, slot] of lay.bottles) {
    const shape = lay.shapes[slot.shapeId]!;
    const home: Pose = { x: slot.x, y: slot.y, rot: 0, scale: lay.shelfScale, opacity: 1, z: 0 };
    const b = w.addVessel(id, "bottle", shape, home, slot.look);
    // 瓶里装七成：倒酒时液面与倾角才有真实的关系（满瓶一倾就出，半瓶要倒很平）
    const ref = ir.ingredients.find((r) => r.ingredientId === slot.ingredientId)!;
    const layer = layerOf(ref, vocab, w.uids, shape.capacityMl * 0.72);
    if (layer) b.sem.layers.push(layer);
    w.snapNow(b, 0);
  }

  // ── 步骤 ──
  const steps: TimelineStep[] = [];
  let cursor = w.ms(240); // 开场先停一拍：先看清吧台
  for (const step of ir.steps) {
    const start = cursor;
    const end = Math.max(start + w.ms(200), runStep(step, { w, ir, vocab, bySlot }, start));
    steps.push({
      stepId: step.id,
      action: step.action,
      startMs: start === w.ms(240) && steps.length === 0 ? 0 : start,
      durationMs: 0,
      label: stepLabel(step, bySlot, vocab),
    });
    cursor = end + w.ms(STEP_GAP_MS);
  }
  // 步骤首尾相接：每步的时长 = 下一步起点 − 本步起点
  for (let i = 0; i < steps.length; i++) {
    const next = i + 1 < steps.length ? steps[i + 1]!.startMs : cursor;
    steps[i]!.durationMs = next - steps[i]!.startMs;
  }

  // ── 成品定格：所有实体都已回位（编排保证）、粒子都已散尽，再静止一段 ──
  let settle = cursor;
  for (const v of w.vessels.values()) settle = Math.max(settle, lastT(v.track.pose));
  for (const t of w.tools.values()) settle = Math.max(settle, lastT(t.track.pose));
  // 烟雾可以飘进定格段（上桌后烟还该冒一会儿），火星、喷雾必须在封面前散尽
  for (const e of w.effects) if (e.kind !== "smoke") settle = Math.max(settle, e.endMs + lifeOf(e.kind) - w.ms(HOLD_MS) * 0.6);
  // 液面波纹在封面帧前平息（< 0.01）
  for (const v of w.vessels.values()) {
    for (const im of v.track.agitation) {
      settle = Math.max(settle, im.t + im.dur + AGITATION_TAU_MS * Math.log(Math.max(1, im.peak / 0.01)) - w.ms(HOLD_MS));
    }
  }
  const holdStart = Math.max(cursor, settle);
  if (steps.length > 0) steps[steps.length - 1]!.durationMs = holdStart - steps[steps.length - 1]!.startMs;
  const holdMs = w.ms(HOLD_MS);
  steps.push({
    stepId: "__final",
    action: "SERVE",
    startMs: holdStart,
    durationMs: holdMs,
    label: { zh: "完成", en: "Serve" },
  });
  const totalMs = holdStart + holdMs;

  return {
    totalMs,
    finalSceneMs: totalMs,
    steps,
    stage: lay.stage,
    shapes: Object.fromEntries(Object.entries(lay.shapes).map(([k, s]) => [k, s])),
    vessels: [...w.vessels.values()].map((v) => v.track),
    tools: [...w.tools.values()].map((t) => t.track),
    streams: w.streams,
    effects: w.effects,
  };
}
