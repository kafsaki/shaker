<script setup lang="ts">
/**
 * 编辑器原料行（一个「材料格」）：小瓶按原料色上色 + 词表选择 + slot 代号 +
 * 角色 + 单位（discriminated union 约束）+ 用量 + 可选。
 */
import type { IngredientRef } from "@shaker/recipe-ir";
import { UNIT_GROUPS, ROLE_OPTIONS } from "@shaker/recipe-ir";
import IngredientPicker from "./IngredientPicker.vue";

const props = defineProps<{ modelValue: IngredientRef }>();
const emit = defineEmits<{
  "update:modelValue": [value: IngredientRef];
  remove: [];
}>();

const vocab = useVocabStore();

function patch(p: Record<string, unknown>): void {
  emit("update:modelValue", {
    ...props.modelValue,
    ...p,
  } as IngredientRef);
}

function setUnit(unit: string): void {
  const kind = UNIT_GROUPS.find((g) => g.value === unit)?.kind;
  const next: Record<string, unknown> = { ...props.modelValue, unit };
  if (kind === "none") {
    delete next.amount;
  } else if (next.amount === undefined) {
    next.amount = kind === "count" ? 1 : 30;
  } else if (kind === "count") {
    next.amount = Math.max(1, Math.round(Number(next.amount)));
  }
  patch(next);
}

const currentKind = computed(
  () => UNIT_GROUPS.find((g) => g.value === props.modelValue.unit)?.kind,
);

const roleValue = computed(() => props.modelValue.role ?? "base");

const KIND_ZH: Record<string, string> = {
  volume: "体积",
  spoon: "勺量",
  quasi: "准体积",
  count: "计数",
  none: "无量",
};
// UNIT_GROUPS 已按 kind 连续排列，PxSelect 按相邻 group 插标题
const unitOptions = UNIT_GROUPS.map((u) => ({
  value: u.value,
  label: u.label,
  group: KIND_ZH[u.kind] ?? u.kind,
}));
const roleOptions = ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label }));

/** 小瓶液色：取词表 viz.color，未选原料时是空瓶。 */
const liquid = computed(() => {
  const meta = vocab.ingMap.get(props.modelValue.ingredientId);
  return (meta?.viz as { color?: string } | undefined)?.color ?? "transparent";
});
</script>

<template>
  <div class="cell">
    <span
      class="vial"
      :class="{ blank: !modelValue.ingredientId }"
      :style="{ '--px-icon-2': liquid, '--px-icon-2-alpha': 1 }"
    >
      <PxIcon name="bottle" :scale="3" />
    </span>

    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <IngredientPicker
            :model-value="modelValue.ingredientId"
            @update:model-value="patch({ ingredientId: $event ?? '' })"
          />
        </div>
        <span class="slot font-logo" title="原料代号（步骤里引用它）">{{ modelValue.slot }}</span>
        <PxButton
          square
          size="sm"
          variant="ghost"
          icon="trash"
          title="删除原料"
          class="del"
          sfx="cancel"
          @click="emit('remove')"
        />
      </div>

      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div class="sel w-28" title="角色">
          <PxSelect
            :model-value="roleValue"
            :options="roleOptions"
            size="sm"
            placeholder="角色"
            @update:model-value="patch({ role: String($event) })"
          />
        </div>
        <div class="sel w-24" title="单位">
          <PxSelect
            :model-value="modelValue.unit"
            :options="unitOptions"
            size="sm"
            placeholder="单位"
            @update:model-value="setUnit(String($event))"
          />
        </div>

        <div v-if="currentKind !== 'none'" class="amt flex items-center gap-1">
          <PxInput
            type="number"
            size="sm"
            class="w-16"
            aria-label="用量"
            :min="currentKind === 'count' ? 1 : 0.1"
            :step="currentKind === 'count' ? 1 : 'any'"
            :model-value="('amount' in modelValue ? modelValue.amount : 1) ?? ''"
            @update:model-value="patch({ amount: Number($event) })"
          />
          <span class="text-faint">{{ modelValue.unit }}</span>
        </div>

        <PxCheckbox
          class="ml-auto text-dim"
          :model-value="modelValue.optional ?? false"
          @update:model-value="patch({ optional: $event === true })"
        >
          可选
        </PxCheckbox>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cell {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.cell:hover { box-shadow: 0 0 0 var(--p) var(--amber-lo), inset var(--p) var(--p) 0 0 var(--lo); }
.vial {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  margin-top: var(--p);
  background: var(--deep);
  color: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.vial.blank { color: var(--faint); }
.slot {
  flex-shrink: 0;
  padding: 3px 5px;
  font-size: 8px;
  color: var(--cyan);
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.del:hover { color: var(--red); }
/* PxSelect 不透传 class（reka SelectRoot 吞掉 attrs），宽度由外层 div 定、触发器撑满 */
.sel :deep(.px-sel-trigger) { width: calc(100% - var(--p) * 2); }
/* 用量读数用招牌字体（PxInput 的 class 会透传到 <input> 上，压不过它的 font: inherit，只能穿透写） */
.amt :deep(input) { font-family: var(--font-logo); font-size: 8px; color: var(--amber); }
@media (max-width: 479px) {
  .vial { width: 32px; height: 32px; }
}
</style>
