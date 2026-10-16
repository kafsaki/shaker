<script setup lang="ts">
/** 编辑器「工序卡」：按 editor-schema 的字段描述表通用渲染 21 种动作。 */
import type { Step } from "@shaker/recipe-ir";
import {
  ACTION_META,
  CONTAINER_OPTIONS,
  ICE_TYPE_OPTIONS,
  type FieldDef,
} from "@shaker/recipe-ir";

const props = defineProps<{
  modelValue: Step;
  index: number;
  slots: { slot: string; label: string; color?: string }[];
  /** 是否最后一步（只用于禁用「下移」；越界时父组件 moveStep 本身也会忽略） */
  last?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: Step];
  remove: [];
  move: [dir: number];
}>();

const { play } = useSfx();

const meta = computed(
  () =>
    ACTION_META[props.modelValue.action] ?? { label: "?", group: "?", fields: [] },
);

/** 条件字段（when）：只在依赖字段等于指定值时显示（如签姿只在 position = skewer 时出现）。 */
const visibleFields = computed(() =>
  meta.value.fields.filter((f) => !f.when || fieldVal(f.when.key) === f.when.equals),
);

function patch(p: Record<string, unknown>): void {
  emit("update:modelValue", { ...props.modelValue, ...p } as Step);
}

/** 切换动作：保留 id，其余字段重置为该动作的空骨架。 */
function setAction(action: string): void {
  const skeleton: Record<string, unknown> = { action, id: props.modelValue.id };
  for (const f of ACTION_META[action]?.fields ?? []) {
    if (f.kind === "container") {
      if (f.key === "from") skeleton.from = "shaker";
      else if (f.key === "to") skeleton.to = "glass";
      else skeleton.target = "glass";
    } else if (f.kind === "slots") {
      skeleton.items = [];
    } else if (f.kind === "slot") {
      skeleton.material = props.slots[0]?.slot ?? "i1";
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
  emit("update:modelValue", skeleton as Step);
}

function fieldVal(key: string): unknown {
  return (props.modelValue as Record<string, unknown>)[key];
}

function opts(f: FieldDef): { value: string; label: string }[] {
  if (f.kind === "ice_type") return ICE_TYPE_OPTIONS;
  if (f.kind === "container") return CONTAINER_OPTIONS;
  return f.options ?? [];
}

/** 枚举下拉：非必填项前面插「未设置」哨兵（reka 不允许空串 value）。 */
function enumOpts(f: FieldDef): { value: string; label: string }[] {
  return f.required ? opts(f) : [{ value: "_unset", label: "未设置" }, ...opts(f)];
}

function hasItem(key: string, slot: string): boolean {
  return ((fieldVal(key) as string[] | undefined) ?? []).includes(slot);
}

function toggleItem(key: string, slot: string, on: boolean): void {
  const cur = ((props.modelValue as Record<string, unknown>)[key] as string[]) ?? [];
  const next = on ? [...cur, slot] : cur.filter((s) => s !== slot);
  patch({ [key]: next });
  play("click");
}

const actionGroups = computed(() => {
  const byGroup = new Map<string, string[]>();
  for (const [a, m] of Object.entries(ACTION_META)) {
    const list = byGroup.get(m.group) ?? [];
    list.push(a);
    byGroup.set(m.group, list);
  }
  return [...byGroup.entries()];
});

const actionOptions = computed(() =>
  actionGroups.value.flatMap(([group, actions]) =>
    actions.map((a) => ({ value: a, label: `${ACTION_META[a]?.label}（${a}）`, group })),
  ),
);

const slotOptions = computed(() => props.slots.map((s) => ({ value: s.slot, label: s.label })));
</script>

<template>
  <article class="card">
    <div class="num" aria-hidden="true">
      <span class="font-logo text-[8px] text-faint">STEP</span>
      <span class="font-logo text-[16px] leading-none">{{ String(index + 1).padStart(2, "0") }}</span>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="act" :title="`第 ${index + 1} 步动作`">
          <PxSelect
            :model-value="modelValue.action"
            :options="actionOptions"
            size="sm"
            @update:model-value="setAction(String($event))"
          />
        </div>
        <span class="font-logo text-[8px] text-faint" title="步骤 id">{{ modelValue.id }}</span>

        <div class="ml-auto flex items-center gap-1">
          <PxButton square size="sm" icon="chevron-up" title="上移" :disabled="index === 0" @click="emit('move', -1)" />
          <PxButton square size="sm" icon="chevron-down" title="下移" :disabled="last" @click="emit('move', 1)" />
          <PxButton square size="sm" variant="danger" icon="trash" title="删除步骤" sfx="cancel" @click="emit('remove')" />
        </div>
      </div>

      <div v-if="visibleFields.length" class="fields">
        <template v-for="f in visibleFields" :key="f.key">
          <!-- 单容器 -->
          <div v-if="f.kind === 'container'" class="field">
            <span class="lbl">{{ f.label }}</span>
            <PxSelect
              :model-value="String(fieldVal(f.key) ?? 'glass')"
              :options="CONTAINER_OPTIONS"
              size="sm"
              @update:model-value="patch({ [f.key]: $event })"
            />
          </div>

          <!-- 多选 slot：材料 chip，选中凸起 -->
          <div v-else-if="f.kind === 'slots'" class="field wide">
            <span class="lbl">{{ f.label }}</span>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="s in slots"
                :key="s.slot"
                type="button"
                class="mat"
                :class="{ on: hasItem(f.key, s.slot) }"
                :aria-pressed="hasItem(f.key, s.slot)"
                @click="toggleItem(f.key, s.slot, !hasItem(f.key, s.slot))"
              >
                <span class="dot" :style="{ background: s.color ?? 'var(--faint)' }" />
                {{ s.label }}
              </button>
              <span v-if="slots.length === 0" class="text-faint">先在上方添加原料</span>
            </div>
          </div>

          <!-- 单选 slot -->
          <div v-else-if="f.kind === 'slot'" class="field">
            <span class="lbl">{{ f.label }}</span>
            <PxSelect
              :model-value="String(fieldVal(f.key) ?? slots[0]?.slot ?? '')"
              :options="slotOptions"
              size="sm"
              placeholder="先添加原料"
              @update:model-value="patch({ [f.key]: $event })"
            />
          </div>

          <!-- 冰型 -->
          <div v-else-if="f.kind === 'ice_type'" class="field">
            <span class="lbl">{{ f.label }}</span>
            <PxSelect
              :model-value="String(fieldVal(f.key) ?? 'cube')"
              :options="ICE_TYPE_OPTIONS"
              size="sm"
              @update:model-value="patch({ iceType: $event })"
            />
          </div>

          <!-- 冰量 0..1 -->
          <div v-else-if="f.kind === 'fill'" class="field">
            <span class="lbl">
              {{ f.label }}
              <span class="ml-1 font-logo text-[8px] text-amber">{{ Math.round((Number(fieldVal(f.key)) || 0) * 100) }}%</span>
            </span>
            <PxSlider
              :model-value="[Number(fieldVal(f.key)) || 0]"
              :min="0"
              :max="1"
              :step="0.05"
              :label="f.label"
              class="mx-1"
              @update:model-value="(v) => patch({ fill: Number(v?.[0] ?? 0) })"
            />
          </div>

          <!-- 布尔 -->
          <div v-else-if="f.kind === 'boolean'" class="field justify-end">
            <PxCheckbox
              class="h-6"
              :model-value="Boolean(fieldVal(f.key))"
              @update:model-value="patch({ [f.key]: $event === true })"
            >
              {{ f.label }}
            </PxCheckbox>
          </div>

          <!-- 数字 / 时长 -->
          <div v-else-if="f.kind === 'number' || f.kind === 'duration'" class="field">
            <span class="lbl">{{ f.label }}{{ f.required ? "" : "（可选）" }}</span>
            <PxInput
              type="number"
              size="sm"
              :min="f.min"
              :max="f.max"
              :step="f.integer ? 1 : 'any'"
              :model-value="fieldVal(f.key) === undefined ? '' : String(fieldVal(f.key))"
              @update:model-value="
                $event === ''
                  ? patch({ [f.key]: undefined })
                  : patch({ [f.key]: Number($event) })
              "
            />
          </div>

          <!-- 枚举 -->
          <div v-else class="field">
            <span class="lbl">{{ f.label }}{{ f.required ? "" : "（可选）" }}</span>
            <PxSelect
              :model-value="fieldVal(f.key) === undefined || fieldVal(f.key) === null ? '_unset' : String(fieldVal(f.key))"
              :options="enumOpts(f)"
              size="sm"
              @update:model-value="
                $event === '_unset' ? patch({ [f.key]: undefined }) : patch({ [f.key]: $event })
              "
            />
          </div>
        </template>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.card:hover { box-shadow: 0 0 0 var(--p) var(--amber-lo), inset var(--p) var(--p) 0 0 var(--lo); }
.num {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  margin: var(--p);
  background: var(--amber);
  color: var(--on-accent);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 rgb(0 0 0 / 0.25);
}
.num .text-faint { color: color-mix(in srgb, var(--on-accent) 60%, transparent); }
.fields {
  display: grid;
  gap: 10px 14px;
  padding-top: 10px;
  border-top: var(--p) dashed var(--line);
}
@media (min-width: 640px) {
  .fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field.wide { grid-column: span 2; }
}
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
/* PxSelect 不透传 class（reka SelectRoot 吞掉 attrs），宽度由外层定、触发器撑满 */
.act { width: 176px; }
.field :deep(.px-sel-trigger),
.act :deep(.px-sel-trigger) { width: calc(100% - var(--p) * 2); }
.lbl { color: var(--faint); }
.mat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  margin: var(--p);
  padding: 0 8px;
  background: var(--deep);
  color: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--line), inset var(--p) var(--p) 0 0 var(--lo);
}
.mat:hover { color: var(--fg); box-shadow: 0 0 0 var(--p) var(--amber), inset var(--p) var(--p) 0 0 var(--lo); }
.mat.on {
  transform: translateY(calc(var(--p) * -1));
  background: var(--panel-hi);
  color: var(--amber);
  box-shadow:
    0 0 0 var(--p) var(--amber),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    var(--p) calc(var(--p) * 2) 0 var(--p) var(--shadow);
}
.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  box-shadow: 0 0 0 var(--p) var(--ink);
}
@media (max-width: 479px) {
  .num { width: 36px; height: 36px; }
}
</style>
