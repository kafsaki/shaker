/**
 * 业务规则校验（规范 §10）。
 *
 * 这是 schema 之上的第二层。zod/JSON Schema 管结构，这里管语义：
 * 引用完整性、容器状态合法性、物理合理性。
 *
 * 两层分工的原因：JSON Schema 表达不了「STRAIN 的源容器此前必须有内容」这种
 * 跨字段跨数组的约束，而这些恰好是作者和 v2 的模型最容易搞错的地方。
 *
 * error 阻止发布；warn 只提示。v2 的 AI 修复环把 warn 一并回灌给模型（ADR-008）。
 */
import type { ContainerId, IceType, Texture, Viscosity } from "./vocab.ts";
import type { RecipeIR, Step } from "./ir.ts";
import { slotsReferenced } from "./ir.ts";
import { iceOccupancy } from "./glass.ts";
import { refToMl, requiresIntegerAmount, requiresAmount, unitKind } from "./units.ts";
import { SHAKE_DILUTION, SHAKE_REFERENCE_SEC } from "./physics.ts";

/* ────────────────────────── 词表接口 ────────────────────────── */

export interface IngredientMeta {
  id: string;
  category: string;
  abv?: number;
  density?: number;
  viz: {
    color: string;
    opacity?: number;
    carbonated?: boolean;
    viscosity?: Viscosity;
    texture?: Texture;
    foaming?: number;
  };
}

export interface GlassMeta {
  id: string;
  capacityMl: number;
}

/**
 * 校验所需的词表视图。做成接口而非具体类型，这样编辑器可以喂内存缓存，
 * 后端可以喂 DB 查询结果，测试可以喂假数据。
 */
export interface VocabLookup {
  ingredient(id: string): IngredientMeta | undefined;
  glass(id: string): GlassMeta | undefined;
}

/* ────────────────────────── 诊断 ────────────────────────── */

export type Severity = "error" | "warn";

export interface Diagnostic {
  severity: Severity;
  /** 机器可读的规则码，便于前端做定向提示与 i18n。 */
  code: string;
  message: string;
  /** 出问题的位置，用于编辑器高亮。 */
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

function err(code: string, message: string, path?: string): Diagnostic {
  return { severity: "error", code, message, path };
}

function warn(code: string, message: string, path?: string): Diagnostic {
  return { severity: "warn", code, message, path };
}

/* ────────────────────────── 容器模拟 ────────────────────────── */

interface SimContainer {
  liquidMl: number;
  iceMl: number;
  iceTypes: IceType[];
  touched: boolean;
}

function emptyContainer(): SimContainer {
  return { liquidMl: 0, iceMl: 0, iceTypes: [], touched: false };
}

function hasContent(c: SimContainer | undefined): boolean {
  return !!c && (c.liquidMl > 0 || c.iceMl > 0);
}

/* ────────────────────────── 主入口 ────────────────────────── */

export function validateRecipeIR(ir: RecipeIR, vocab?: VocabLookup): ValidationResult {
  const diags: Diagnostic[] = [];

  /* ── slot / step id 唯一性 ── */
  const slotSet = new Set<string>();
  for (const [i, ref] of ir.ingredients.entries()) {
    if (slotSet.has(ref.slot)) {
      diags.push(err("slot.duplicate", `原料 slot "${ref.slot}" 重复`, `ingredients[${i}].slot`));
    }
    slotSet.add(ref.slot);
  }

  const stepIds = new Set<string>();
  for (const [i, s] of ir.steps.entries()) {
    if (stepIds.has(s.id)) {
      diags.push(err("step.duplicate_id", `步骤 id "${s.id}" 重复`, `steps[${i}].id`));
    }
    stepIds.add(s.id);
  }

  /* ── unit / amount 组合（给人看的消息；机器校验在 schema 层） ── */
  for (const [i, ref] of ir.ingredients.entries()) {
    const path = `ingredients[${i}]`;
    const amount = "amount" in ref ? ref.amount : undefined;
    if (requiresAmount(ref.unit) && amount === undefined) {
      diags.push(err("unit.amount_required", `单位 "${ref.unit}" 必须填写用量`, path));
    }
    if (!requiresAmount(ref.unit) && amount !== undefined) {
      diags.push(
        err("unit.amount_forbidden", `单位 "${ref.unit}" 不能带用量（实际量由系统计算或本身无量）`, path),
      );
    }
    if (amount !== undefined && requiresIntegerAmount(ref.unit) && !Number.isInteger(amount)) {
      diags.push(err("unit.amount_not_integer", `单位 "${ref.unit}" 的用量必须是整数`, path));
    }
  }

  /* ── 引用完整性 ── */
  const referencedSlots = new Set<string>();
  for (const [i, s] of ir.steps.entries()) {
    for (const slot of slotsReferenced(s)) {
      referencedSlots.add(slot);
      if (!slotSet.has(slot)) {
        diags.push(err("ref.unknown_slot", `步骤 "${s.id}" 引用了不存在的原料 slot "${slot}"`, `steps[${i}]`));
      }
    }
  }
  for (const [i, ref] of ir.ingredients.entries()) {
    if (!referencedSlots.has(ref.slot)) {
      diags.push(
        err("ref.orphan_ingredient", `原料 "${ref.slot}" 没有被任何步骤使用（疑似笔误）`, `ingredients[${i}]`),
      );
    }
  }

  const bySlot = new Map(ir.ingredients.map((r) => [r.slot, r]));

  /* ── 特定动作的 slot 单位要求 ── */
  for (const [i, s] of ir.steps.entries()) {
    if (s.action === "TOP_UP") {
      for (const slot of s.items) {
        const ref = bySlot.get(slot);
        if (ref && ref.unit !== "top_up") {
          diags.push(
            err("topup.wrong_unit", `TOP_UP 引用的原料 "${slot}" 单位必须是 top_up，当前是 ${ref.unit}`, `steps[${i}]`),
          );
        }
      }
    }
    if (s.action === "RIM") {
      const ref = bySlot.get(s.material);
      if (ref && ref.unit !== "rim") {
        diags.push(
          err("rim.wrong_unit", `RIM 的材料 "${s.material}" 单位必须是 rim，当前是 ${ref.unit}`, `steps[${i}]`),
        );
      }
    }
    if (s.action === "GARNISH") {
      const hasId = s.garnishId !== undefined;
      const hasItems = s.items !== undefined && s.items.length > 0;
      if (hasId === hasItems) {
        diags.push(
          err("garnish.ambiguous", "GARNISH 必须且只能提供 garnishId 或 items 之一", `steps[${i}]`),
        );
      }
    }
  }

  /* ── 词表存在性 ── */
  if (vocab) {
    if (!vocab.glass(ir.glass)) {
      diags.push(err("vocab.unknown_glass", `杯型 "${ir.glass}" 不在词表中`, "glass"));
    }
    for (const [i, ref] of ir.ingredients.entries()) {
      if (!vocab.ingredient(ref.ingredientId)) {
        diags.push(
          err("vocab.unknown_ingredient", `原料 "${ref.ingredientId}" 不在词表中`, `ingredients[${i}].ingredientId`),
        );
      }
    }
    for (const [i, s] of ir.steps.entries()) {
      if (s.action === "GARNISH" && s.garnishId && !vocab.ingredient(s.garnishId)) {
        diags.push(
          err("vocab.unknown_garnish", `装饰物 "${s.garnishId}" 不在词表中`, `steps[${i}].garnishId`),
        );
      }
    }
  }

  /* ── 容器状态模拟 ── */
  const containers = new Map<ContainerId, SimContainer>();
  const touch = (id: ContainerId): SimContainer => {
    let c = containers.get(id);
    if (!c) {
      c = emptyContainer();
      containers.set(id, c);
    }
    c.touched = true;
    return c;
  };

  const capacityOf = (id: ContainerId): number => {
    if (id === "glass") return vocab?.glass(ir.glass)?.capacityMl ?? WORK_CAPACITY.glass;
    return WORK_CAPACITY[id];
  };

  let addedDirectlyToGlass = false;
  let strainedIntoGlass = false;

  for (const [i, s] of ir.steps.entries()) {
    const path = `steps[${i}]`;

    if ("from" in s) {
      const src = containers.get(s.from);
      if (!hasContent(src)) {
        diags.push(
          err("container.empty_source", `步骤 "${s.id}"（${s.action}）的源容器 ${s.from} 此时是空的`, path),
        );
      }
    }

    switch (s.action) {
      case "ADD":
      case "FLOAT":
      case "RINSE": {
        const c = touch(s.target);
        for (const slot of s.items) {
          const ref = bySlot.get(slot);
          if (!ref) continue;
          if (unitKind(ref.unit) === "volume" || unitKind(ref.unit) === "spoon") {
            c.liquidMl += refToMl(ref) ?? 0;
          }
        }
        if (s.action === "RINSE" && s.discard) {
          // 涮杯倒掉多余，只留挂壁
          c.liquidMl = 0;
        }
        if (s.action === "ADD" && s.target === "glass") addedDirectlyToGlass = true;
        break;
      }
      case "ICE": {
        const c = touch(s.target);
        const occ = iceOccupancy(capacityOf(s.target), s.iceType, s.fill);
        c.iceMl += occ.solidMl;
        c.iceTypes.push(s.iceType);
        break;
      }
      case "TOP_UP": {
        const c = touch(s.target);
        // 补满量在编译期算，这里只标记已满
        c.liquidMl = Math.max(c.liquidMl, capacityOf(s.target) - c.iceMl);
        break;
      }
      case "STRAIN": {
        const src = containers.get(s.from) ?? emptyContainer();
        const dst = touch(s.to);
        dst.liquidMl += src.liquidMl;
        src.liquidMl = 0;
        // 冰留在源容器
        if (s.to === "glass") strainedIntoGlass = true;
        break;
      }
      case "DUMP": {
        const src = containers.get(s.from) ?? emptyContainer();
        const dst = touch(s.to);
        dst.liquidMl += src.liquidMl;
        dst.iceMl += src.iceMl;
        dst.iceTypes.push(...src.iceTypes);
        src.liquidMl = 0;
        src.iceMl = 0;
        src.iceTypes = [];
        if (s.to === "glass") strainedIntoGlass = true;
        break;
      }
      case "ROLL":
      case "THROW": {
        const src = containers.get(s.from) ?? emptyContainer();
        const dst = touch(s.to);
        dst.liquidMl += src.liquidMl;
        src.liquidMl = 0;
        if (s.to === "glass") strainedIntoGlass = true;
        break;
      }
      case "SWIZZLE": {
        const c = touch(s.target);
        if (!c.iceTypes.includes("crushed")) {
          diags.push(warn("swizzle.no_crushed_ice", `SWIZZLE 通常要求容器内有碎冰（crushed）`, path));
        }
        break;
      }
      default:
        touch("target" in s ? s.target : "glass");
        break;
    }
  }

  /* ── 必须以内容进入成品杯结束 ── */
  const glass = containers.get("glass");
  if (!hasContent(glass)) {
    diags.push(
      err("flow.nothing_in_glass", "步骤序列结束时成品杯是空的 —— 酒没有被倒进杯子里", "steps"),
    );
  }
  if (addedDirectlyToGlass && strainedIntoGlass) {
    diags.push(
      warn("flow.double_target_glass", "既直接往成品杯加料、又从别的容器滤入成品杯（疑似笔误）", "steps"),
    );
  }

  /* ── 容量 ── */
  if (glass && vocab) {
    const cap = capacityOf("glass");
    const occ = glass.iceMl;
    if (glass.liquidMl + occ > cap * 1.02) {
      diags.push(
        warn(
          "capacity.overflow",
          `总量约 ${Math.round(glass.liquidMl + occ)}ml，超过 ${ir.glass} 的 ${cap}ml 容量`,
          "steps",
        ),
      );
    }
  }

  /* ── 蛋清配方通常需要干摇 ── */
  const hasTextureRole = ir.ingredients.some((r) => r.role === "texture");
  if (hasTextureRole) {
    const shakes = ir.steps.filter((s): s is Extract<Step, { action: "SHAKE" }> => s.action === "SHAKE");
    if (shakes.length > 0 && !shakes.some((s) => s.dryShake)) {
      diags.push(
        warn("foam.no_dry_shake", "含蛋清/泡沫剂的配方通常需要一段干摇（SHAKE + dryShake）来起泡", "steps"),
      );
    }
  }

  /* ── FLOAT 的密度合理性 ── */
  if (vocab) {
    for (const [i, s] of ir.steps.entries()) {
      if (s.action !== "FLOAT") continue;
      for (const slot of s.items) {
        const ref = bySlot.get(slot);
        const d = ref && vocab.ingredient(ref.ingredientId)?.density;
        if (d !== undefined && d > 1.06) {
          diags.push(
            warn(
              "float.dense_ingredient",
              `"${ref!.ingredientId}" 密度 ${d} 偏高，浮层可能自己沉下去 —— 确认是否真要 FLOAT`,
              `steps[${i}]`,
            ),
          );
        }
      }
    }
  }

  /* ── ABV 合理性 ── */
  if (vocab) {
    const abv = estimateAbv(ir, vocab);
    if (abv !== null) {
      if (abv > 40) {
        diags.push(warn("abv.too_high", `估算酒精度约 ${abv.toFixed(1)}%，偏高，确认用量是否填错`, "ingredients"));
      } else if (abv > 0 && abv < 3) {
        diags.push(warn("abv.too_low", `估算酒精度约 ${abv.toFixed(1)}%，偏低，确认用量是否填错`, "ingredients"));
      }
    }
  }

  const errors = diags.filter((d) => d.severity === "error");
  const warnings = diags.filter((d) => d.severity === "warn");
  return { ok: errors.length === 0, errors, warnings };
}

/** 工作容器的容量（毫升）。成品杯的容量来自词表。 */
const WORK_CAPACITY: Record<ContainerId, number> = {
  shaker: 530,
  mixing_glass: 600,
  blender: 1200,
  glass: 240,
  secondary: 400,
};

/* ────────────────────────── ABV 估算 ────────────────────────── */

/**
 * abv_est = Σ(amountMl × abv) / (totalLiquidMl + dilutionMl)
 *
 * **不算冰融水会显著高估**：Daiquiri 硬摇稀释约 25%，不算的话 ABV 虚高四分之一。
 */
export function estimateAbv(ir: RecipeIR, vocab: VocabLookup): number | null {
  let alcoholMl = 0;
  let liquidMl = 0;
  let known = false;

  for (const ref of ir.ingredients) {
    const ml = refToMl(ref);
    if (ml === null) continue;
    const kind = unitKind(ref.unit);
    if (kind === "volume" || kind === "spoon") liquidMl += ml;
    const abv = vocab.ingredient(ref.ingredientId)?.abv;
    if (abv !== undefined && abv > 0 && (kind === "volume" || kind === "spoon")) {
      alcoholMl += ml * (abv / 100);
      known = true;
    }
  }

  if (!known || liquidMl <= 0) return null;

  let dilutionMl = 0;
  for (const s of ir.steps) {
    if (s.action === "SHAKE" && !s.dryShake) {
      const rate = SHAKE_DILUTION[s.intensity ?? "standard"];
      dilutionMl += liquidMl * rate * Math.min(1, (s.durationSec ?? SHAKE_REFERENCE_SEC) / SHAKE_REFERENCE_SEC);
    }
  }

  return (alcoholMl / (liquidMl + dilutionMl)) * 100;
}
