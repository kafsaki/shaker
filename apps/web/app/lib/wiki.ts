/**
 * 百科修订（ADR-027）的纯函数：身份文案、版本间逐字段对比、配方原料行对比。
 * 历史页与编辑部共用；不碰网络与 store。
 */
import type { components } from "@shaker/api-client";
import type { RecipeIR } from "@shaker/recipe-ir";
import { FAMILY_ZH, METHOD_ZH } from "@/lib/labels";

type IngredientSnapshot = components["schemas"]["IngredientSnapshotBody"];
type RevisionMeta = components["schemas"]["RevisionMetaBody"];

export const ROLE_ZH: Record<string, string> = {
  user: "酒客",
  editor: "编辑",
  admin: "管理员",
};

// 纯数字格式：时间常用 font-logo 渲染，8px 像素字没有中文字形
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface FieldDiff {
  label: string;
  before: string;
  after: string;
  /** 长文本（说明）用块状对比，短文本用一行「旧 → 新」。 */
  long?: boolean;
}

function push(out: FieldDiff[], label: string, before: string, after: string, long = false): void {
  if (before !== after) out.push({ label, before, after, long });
}

/** 原料词条两个快照之间的差异；prev 为空表示这是第一版，全部字段视为新增。 */
export function ingredientDiff(prev: IngredientSnapshot | null, cur: IngredientSnapshot): FieldDiff[] {
  const out: FieldDiff[] = [];
  push(out, "中文名", prev?.nameZh ?? "", cur.nameZh);
  push(out, "英文名", prev?.nameEn ?? "", cur.nameEn);
  push(out, "别名", (prev?.aliases ?? []).join("、"), (cur.aliases ?? []).join("、"));
  push(out, "中文说明", prev?.descriptionZh ?? "", cur.descriptionZh ?? "", true);
  push(out, "英文说明", prev?.descriptionEn ?? "", cur.descriptionEn ?? "", true);
  return out;
}

function tasteText(t: RevisionMeta["tasteProfile"] | undefined | null): string {
  if (!t) return "";
  return `甜${t.sweet} 酸${t.sour} 苦${t.bitter} 烈${t.strength}`;
}

/**
 * 配方修订之间的元数据差异。早期版本（ADR-027 之前）没有 meta 快照，
 * 这时只能比标题——返回值里不会有 meta 字段的行。
 */
export function recipeMetaDiff(
  prev: { title: string; meta: RevisionMeta | null } | null,
  cur: { title: string; meta: RevisionMeta | null },
): FieldDiff[] {
  const out: FieldDiff[] = [];
  push(out, "名称", prev?.title ?? "", cur.title);
  const a = prev?.meta ?? null;
  const b = cur.meta;
  if (!b || (prev && !a)) return out;
  push(out, "副标题", a?.subtitle ?? "", b.subtitle ?? "");
  push(out, "家族", FAMILY_ZH[a?.family ?? ""] ?? a?.family ?? "", FAMILY_ZH[b.family ?? ""] ?? b.family ?? "");
  push(out, "难度", a?.difficulty ? `★${a.difficulty}` : "", b.difficulty ? `★${b.difficulty}` : "");
  push(out, "风味", tasteText(a?.tasteProfile), tasteText(b.tasteProfile));
  push(out, "标签", (a?.tags ?? []).join("、"), (b.tags ?? []).join("、"));
  push(out, "介绍", a?.descriptionMd ?? "", b.descriptionMd ?? "", true);
  return out;
}

/** 一行原料：「金酒 30ml」。名字查不到就退回 ID。 */
export function ingredientLine(ref: RecipeIR["ingredients"][number], nameOf: (id: string) => string | undefined): string {
  const name = nameOf(ref.ingredientId) ?? ref.ingredientId;
  const amount = "amount" in ref ? ` ${ref.amount}${ref.unit}` : ` (${ref.unit})`;
  return `${name}${amount}${ref.optional ? "（可选）" : ""}`;
}

export interface IRDiff {
  added: string[];
  removed: string[];
  meta: FieldDiff[];
  stepsChanged: boolean;
}

/** 两版 IR 的摘要差异：原料行增删、杯型/手法/份数、步骤是否改动。 */
export function irDiff(
  prev: RecipeIR | null,
  cur: RecipeIR,
  nameOf: (id: string) => string | undefined,
  glassName: (id: string) => string | undefined,
): IRDiff {
  const before = (prev?.ingredients ?? []).map((r) => ingredientLine(r, nameOf));
  const after = cur.ingredients.map((r) => ingredientLine(r, nameOf));
  const meta: FieldDiff[] = [];
  push(meta, "杯型", prev ? (glassName(prev.glass) ?? prev.glass) : "", glassName(cur.glass) ?? cur.glass);
  push(meta, "手法", prev ? (METHOD_ZH[prev.method] ?? prev.method) : "", METHOD_ZH[cur.method] ?? cur.method);
  push(meta, "份数", prev ? String(prev.servings) : "", String(cur.servings));
  return {
    added: after.filter((l) => !before.includes(l)),
    removed: before.filter((l) => !after.includes(l)),
    meta,
    stepsChanged: JSON.stringify(prev?.steps ?? []) !== JSON.stringify(cur.steps),
  };
}
