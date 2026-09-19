/**
 * 原型内置的结构化配方编辑器（调试装置）。
 *
 * 与 web 端编辑器共用 @shaker/recipe-ir 的 editor-schema 字段表（ACTION_META /
 * UNIT_GROUPS / ROLE_OPTIONS …），用原生 DOM 渲染 —— 原型不引框架。
 *
 * 重渲染策略：字段级变更只改 draft 并上抛（不打断输入焦点）；
 * 结构级操作（增/删/移/换动作）才整体重渲染。
 */
import {
  ACTION_META,
  CONTAINER_OPTIONS,
  ICE_TYPE_OPTIONS,
  METHODS,
  ROLE_OPTIONS,
  UNIT_GROUPS,
  type FieldDef,
  type IngredientRef,
  type RecipeIR,
  type Step,
} from "@shaker/recipe-ir";

export interface EditorVocab {
  /** 可选原料（词表），id + 中文名。 */
  ingredients: readonly { id: string; nameZh: string; category: string }[];
  /** 可选杯型（glassware 内容词表，不含 __ 工作器具）。 */
  glassware: readonly { id: string; nameZh: string; capacityMl: number }[];
}

export interface EditorHost {
  /** 任何字段变更后调用（draft 的深拷贝）。 */
  onChange(ir: RecipeIR): void;
}

const METHOD_ZH: Record<string, string> = {
  shaken: "摇和", stirred: "搅拌", built: "直调", blended: "搅打",
  thrown: "抛倒", swizzled: "搅棒", rolled: "滚倒", layered: "分层",
};

let draft: RecipeIR;
let vocabRef: EditorVocab;
let hostRef: EditorHost;
let rootRef: HTMLElement;

/** 入口：挂载/换配方时整体重渲染。 */
export function renderEditor(
  root: HTMLElement,
  ir: RecipeIR,
  vocab: EditorVocab,
  host: EditorHost,
): void {
  draft = JSON.parse(JSON.stringify(ir)) as RecipeIR;
  vocabRef = vocab;
  hostRef = host;
  rootRef = root;
  paint();
}

function commit(): void {
  hostRef.onChange(JSON.parse(JSON.stringify(draft)) as RecipeIR);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function selectOf(
  options: readonly { value: string; label: string }[],
  value: string,
  onPick: (v: string) => void,
  groups?: Map<string, { value: string; label: string }[]>,
): HTMLSelectElement {
  const sel = el("select", "ed-in");
  if (groups) {
    for (const [g, opts] of groups) {
      const og = el("optgroup");
      og.label = g;
      for (const o of opts) og.appendChild(new Option(o.label, o.value));
      sel.appendChild(og);
    }
  } else {
    for (const o of options) sel.appendChild(new Option(o.label, o.value));
  }
  sel.value = value;
  if (sel.value !== value && options.length > 0) {
    // 当前值不在选项里（自造 id 等）：原样补一个选项保住数据
    sel.appendChild(new Option(value, value));
    sel.value = value;
  }
  sel.onchange = () => onPick(sel.value);
  return sel;
}

/* ────────────────────────── 基础信息 ────────────────────────── */

function paintBasics(box: HTMLElement): void {
  const row = el("div", "ed-row");
  row.appendChild(el("span", "ed-k", "杯型"));
  row.appendChild(
    selectOf(
      vocabRef.glassware.map((g) => ({ value: g.id, label: `${g.nameZh}（${g.capacityMl}ml）` })),
      draft.glass,
      (v) => {
        draft.glass = v;
        commit();
      },
    ),
  );
  row.appendChild(el("span", "ed-k", "手法"));
  row.appendChild(
    selectOf(
      METHODS.map((m) => ({ value: m, label: METHOD_ZH[m] ?? m })),
      draft.method ?? "built",
      (v) => {
        draft.method = v as RecipeIR["method"];
        commit();
      },
    ),
  );
  row.appendChild(el("span", "ed-k", "份数"));
  const servings = el("input", "ed-in ed-num") as HTMLInputElement;
  servings.type = "number";
  servings.min = "1";
  servings.max = "50";
  servings.value = String(draft.servings ?? 1);
  servings.onchange = () => {
    draft.servings = Math.max(1, Math.round(Number(servings.value) || 1));
    commit();
  };
  row.appendChild(servings);
  box.appendChild(row);
}

/* ────────────────────────── 原料 ────────────────────────── */

function ingredientOptions(): Map<string, { value: string; label: string }[]> {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const ing of vocabRef.ingredients) {
    const list = groups.get(ing.category) ?? [];
    list.push({ value: ing.id, label: ing.nameZh });
    groups.set(ing.category, list);
  }
  return groups;
}

function paintIngredients(box: HTMLElement): void {
  const head = el("div", "ed-sec");
  head.appendChild(el("span", "ed-sec-t", `原料（${draft.ingredients.length}）`));
  const add = el("button", "ed-btn", "+ 加原料");
  add.onclick = () => {
    let n = draft.ingredients.length + 1;
    let slot = `i${n}`;
    const taken = new Set(draft.ingredients.map((i) => i.slot));
    while (taken.has(slot)) slot = `i${++n}`;
    draft.ingredients.push({ slot, ingredientId: "", role: "base", unit: "ml", amount: 30 });
    commit();
    paint();
  };
  head.appendChild(add);
  box.appendChild(head);

  const groups = ingredientOptions();
  draft.ingredients.forEach((ing, i) => {
    const row = el("div", "ed-card");
    const line1 = el("div", "ed-row");
    line1.appendChild(el("code", "ed-slot", ing.slot));
    line1.appendChild(
      selectOf([], ing.ingredientId, (v) => {
        ing.ingredientId = v;
        commit();
      }, groups),
    );
    const del = el("button", "ed-btn ed-danger", "✕");
    del.title = "删除原料";
    del.onclick = () => {
      draft.ingredients.splice(i, 1);
      // 清掉步骤里对它的引用，避免悬空 slot
      for (const s of draft.steps) {
        const rec = s as unknown as Record<string, unknown>;
        if (Array.isArray(rec.items)) {
          rec.items = (rec.items as string[]).filter((x) => x !== ing.slot);
        }
      }
      commit();
      paint();
    };
    line1.appendChild(del);
    row.appendChild(line1);

    const line2 = el("div", "ed-row");
    line2.appendChild(
      selectOf(ROLE_OPTIONS, ing.role ?? "base", (v) => {
        ing.role = v as IngredientRef["role"];
        commit();
      }),
    );
    const unitKind = (u: string) => UNIT_GROUPS.find((g) => g.value === u)?.kind;
    line2.appendChild(
      selectOf(
        [],
        ing.unit,
        (v) => {
          const kind = unitKind(v);
          const next = ing as unknown as Record<string, unknown>;
          next.unit = v;
          if (kind === "none") delete next.amount;
          else if (next.amount === undefined) next.amount = kind === "count" ? 1 : 30;
          commit();
          paint(); // 单位切换影响用量输入框显隐，需要重渲染
        },
        groupUnits(),
      ),
    );
    if (unitKind(ing.unit) !== "none") {
      const amt = el("input", "ed-in ed-num") as HTMLInputElement;
      amt.type = "number";
      amt.min = unitKind(ing.unit) === "count" ? "1" : "0.1";
      amt.step = unitKind(ing.unit) === "count" ? "1" : "any";
      amt.value = String("amount" in ing ? ing.amount : "");
      amt.onchange = () => {
        (ing as unknown as Record<string, unknown>).amount = Number(amt.value);
        commit();
      };
      line2.appendChild(amt);
      line2.appendChild(el("span", "ed-k", ing.unit));
    }
    row.appendChild(line2);
    box.appendChild(row);
  });
}

function groupUnits(): Map<string, { value: string; label: string }[]> {
  const zh: Record<string, string> = {
    volume: "体积", spoon: "勺量", quasi: "准体积", count: "计数", none: "无量",
  };
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const u of UNIT_GROUPS) {
    const g = zh[u.kind] ?? u.kind;
    const list = groups.get(g) ?? [];
    list.push({ value: u.value, label: u.label });
    groups.set(g, list);
  }
  return groups;
}

/* ────────────────────────── 步骤 ────────────────────────── */

function stepSkeleton(action: string, id: string): Step {
  // 与 web StepCard.setAction 同规则：保留 id，其余字段重置为该动作的空骨架
  const skeleton: Record<string, unknown> = { action, id };
  for (const f of ACTION_META[action]?.fields ?? []) {
    if (f.kind === "container") {
      if (f.key === "from") skeleton.from = "shaker";
      else if (f.key === "to") skeleton.to = "glass";
      else skeleton.target = "glass";
    } else if (f.kind === "slots") {
      skeleton.items = [];
    } else if (f.kind === "slot") {
      skeleton.material = draft.ingredients[0]?.slot ?? "i1";
    } else if (f.kind === "ice_type") {
      skeleton.iceType = "cube";
    } else if (f.kind === "fill") {
      skeleton.fill = 0.5;
    } else if (f.kind === "number" && f.required) {
      skeleton[f.key] = f.min ?? 1;
    } else if (f.kind === "duration" && f.required) {
      skeleton.durationSec = 10;
    }
  }
  return skeleton as Step;
}

function paintSteps(box: HTMLElement): void {
  const head = el("div", "ed-sec");
  head.appendChild(el("span", "ed-sec-t", `步骤（${draft.steps.length}）`));
  const add = el("button", "ed-btn", "+ 加步骤");
  add.onclick = () => {
    let n = draft.steps.length + 1;
    let id = `s${n}`;
    const taken = new Set(draft.steps.map((s) => s.id));
    while (taken.has(id)) id = `s${++n}`;
    draft.steps.push(stepSkeleton("ADD", id));
    commit();
    paint();
  };
  head.appendChild(add);
  box.appendChild(head);

  const actionGroups = new Map<string, { value: string; label: string }[]>();
  for (const [a, m] of Object.entries(ACTION_META)) {
    const list = actionGroups.get(m.group) ?? [];
    list.push({ value: a, label: `${m.label}（${a}）` });
    actionGroups.set(m.group, list);
  }

  draft.steps.forEach((step, i) => {
    const card = el("div", "ed-card");
    const rec = step as unknown as Record<string, unknown>;

    const line1 = el("div", "ed-row");
    line1.appendChild(el("code", "ed-slot", `#${i + 1} ${step.id}`));
    line1.appendChild(
      selectOf([], step.action, (v) => {
        draft.steps[i] = stepSkeleton(v, step.id);
        commit();
        paint();
      }, actionGroups),
    );
    const up = el("button", "ed-btn", "↑");
    up.disabled = i === 0;
    up.onclick = () => {
      [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i]!, draft.steps[i - 1]!];
      commit();
      paint();
    };
    const down = el("button", "ed-btn", "↓");
    down.disabled = i === draft.steps.length - 1;
    down.onclick = () => {
      [draft.steps[i], draft.steps[i + 1]] = [draft.steps[i + 1]!, draft.steps[i]!];
      commit();
      paint();
    };
    const del = el("button", "ed-btn ed-danger", "✕");
    del.title = "删除步骤";
    del.onclick = () => {
      draft.steps.splice(i, 1);
      commit();
      paint();
    };
    line1.append(up, down, del);
    card.appendChild(line1);

    const meta = ACTION_META[step.action];
    if (meta) {
      const fields = el("div", "ed-fields");
      for (const f of meta.fields) fields.appendChild(paintField(rec, f));
      card.appendChild(fields);
    }
    box.appendChild(card);
  });
}

function paintField(rec: Record<string, unknown>, f: FieldDef): HTMLElement {
  const wrap = el("div", "ed-field" + (f.kind === "slots" ? " ed-field-wide" : ""));
  const val = rec[f.key];

  if (f.kind === "boolean") {
    const lab = el("label", "ed-chk");
    const chk = el("input") as HTMLInputElement;
    chk.type = "checkbox";
    chk.checked = Boolean(val);
    chk.onchange = () => {
      rec[f.key] = chk.checked;
      commit();
    };
    lab.append(chk, document.createTextNode(f.label));
    wrap.appendChild(lab);
    return wrap;
  }

  wrap.appendChild(el("span", "ed-k", f.label + (f.required ? "" : "（可选）")));

  if (f.kind === "container" || f.kind === "container_from" || f.kind === "container_to") {
    wrap.appendChild(
      selectOf(CONTAINER_OPTIONS, String(val ?? "glass"), (v) => {
        rec[f.key] = v;
        commit();
      }),
    );
  } else if (f.kind === "slots") {
    const chips = el("div", "ed-chips");
    const cur = (val as string[]) ?? [];
    if (draft.ingredients.length === 0) {
      chips.appendChild(el("span", "ed-k", "先在上方添加原料"));
    }
    for (const ing of draft.ingredients) {
      const name = vocabRef.ingredients.find((x) => x.id === ing.ingredientId)?.nameZh;
      const lab = el("label", "ed-chip");
      const chk = el("input") as HTMLInputElement;
      chk.type = "checkbox";
      chk.checked = cur.includes(ing.slot);
      chk.onchange = () => {
        rec[f.key] = chk.checked
          ? [...cur, ing.slot]
          : ((val as string[]) ?? []).filter((s) => s !== ing.slot);
        commit();
      };
      lab.append(chk, document.createTextNode(name ? `${name} (${ing.slot})` : ing.slot));
      chips.appendChild(lab);
    }
    wrap.appendChild(chips);
  } else if (f.kind === "slot") {
    const opts = draft.ingredients.map((ing) => ({ value: ing.slot, label: ing.slot }));
    wrap.appendChild(
      selectOf(opts, String(val ?? opts[0]?.value ?? ""), (v) => {
        rec[f.key] = v;
        commit();
      }),
    );
  } else if (f.kind === "ice_type") {
    wrap.appendChild(
      selectOf(ICE_TYPE_OPTIONS, String(val ?? "cube"), (v) => {
        rec[f.key] = v;
        commit();
      }),
    );
  } else if (f.kind === "fill") {
    const pct = el("span", "ed-k", `${Math.round((Number(val) || 0) * 100)}%`);
    const range = el("input", "ed-range") as HTMLInputElement;
    range.type = "range";
    range.min = "0";
    range.max = "1";
    range.step = "0.05";
    range.value = String(Number(val) || 0);
    range.oninput = () => {
      rec[f.key] = Number(range.value);
      pct.textContent = `${Math.round(Number(range.value) * 100)}%`;
      commit();
    };
    wrap.append(range, pct);
  } else if (f.kind === "number" || f.kind === "duration") {
    const num = el("input", "ed-in ed-num") as HTMLInputElement;
    num.type = "number";
    if (f.min !== undefined) num.min = String(f.min);
    if (f.max !== undefined) num.max = String(f.max);
    num.step = f.integer ? "1" : "any";
    num.value = val === undefined ? "" : String(val);
    num.onchange = () => {
      rec[f.key] = num.value === "" ? undefined : Number(num.value);
      commit();
    };
    wrap.appendChild(num);
  } else {
    // enum
    const opts = [...(f.required ? [] : [{ value: "_unset", label: "未设置" }]), ...(f.options ?? [])];
    wrap.appendChild(
      selectOf(opts, val === undefined || val === null ? "_unset" : String(val), (v) => {
        rec[f.key] = v === "_unset" ? undefined : v;
        commit();
      }),
    );
  }
  return wrap;
}

/* ────────────────────────── 整体 ────────────────────────── */

function paint(): void {
  rootRef.innerHTML = "";
  paintBasics(rootRef);
  paintIngredients(rootRef);
  paintSteps(rootRef);
}
