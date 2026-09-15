<script setup lang="ts">
/** 编辑器步骤卡：按 editor-schema 的字段描述表通用渲染 21 种动作。 */
import { ChevronDown, ChevronUp, Trash2 } from "lucide-vue-next";
import type { Step } from "@shaker/recipe-ir";
import {
  ACTION_META,
  CONTAINER_OPTIONS,
  ICE_TYPE_OPTIONS,
  type FieldDef,
} from "@/lib/editor-schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const props = defineProps<{
  modelValue: Step;
  index: number;
  slots: { slot: string; label: string }[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: Step];
  remove: [];
  move: [dir: number];
}>();

const meta = computed(
  () =>
    ACTION_META[props.modelValue.action] ?? { label: "?", group: "?", fields: [] },
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

function toggleItem(key: string, slot: string, on: boolean): void {
  const cur = ((props.modelValue as Record<string, unknown>)[key] as string[]) ?? [];
  const next = on ? [...cur, slot] : cur.filter((s) => s !== slot);
  patch({ [key]: next });
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
</script>

<template>
  <div class="rounded-xl border border-border bg-card p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="font-mono text-xs text-muted-foreground">#{{ index + 1 }}</span>
      <code class="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
        {{ modelValue.id }}
      </code>

      <Select :model-value="modelValue.action" @update:model-value="setAction(String($event))">
        <SelectTrigger class="h-8 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <div v-for="[group, actions] in actionGroups" :key="group">
            <div class="px-2 py-1 text-xs font-medium text-muted-foreground">{{ group }}</div>
            <SelectItem v-for="a in actions" :key="a" :value="a">
              {{ ACTION_META[a]?.label }}（{{ a }}）
            </SelectItem>
          </div>
        </SelectContent>
      </Select>

      <div class="ml-auto flex items-center gap-0.5">
        <Button variant="ghost" size="icon" class="size-7" title="上移" :disabled="index === 0" @click="emit('move', -1)">
          <ChevronUp class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7" title="下移" @click="emit('move', 1)">
          <ChevronDown class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7 text-destructive" title="删除步骤" @click="emit('remove')">
          <Trash2 class="size-4" />
        </Button>
      </div>
    </div>

    <Separator class="my-3" />

    <div class="grid gap-3 sm:grid-cols-2">
      <template v-for="f in meta.fields" :key="f.key">
        <!-- 单容器 -->
        <div v-if="f.kind === 'container'" class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">{{ f.label }}</span>
          <Select
            :model-value="String(fieldVal(f.key) ?? 'glass')"
            @update:model-value="patch({ [f.key]: $event })"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in CONTAINER_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 多选 slot -->
        <div v-else-if="f.kind === 'slots'" class="flex flex-col gap-1 sm:col-span-2">
          <span class="text-xs text-muted-foreground">{{ f.label }}</span>
          <div class="flex flex-wrap gap-1.5">
            <label
              v-for="s in slots"
              :key="s.slot"
              class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors"
              :class="
                (fieldVal(f.key) as string[])?.includes(s.slot)
                  ? 'border-primary/50 bg-primary/10'
                  : 'hover:bg-accent'
              "
            >
              <Checkbox
                :model-value="(fieldVal(f.key) as string[])?.includes(s.slot) ?? false"
                @update:model-value="toggleItem(f.key, s.slot, $event === true)"
              />
              {{ s.label }}
            </label>
            <span v-if="slots.length === 0" class="text-xs text-muted-foreground">
              先在上方添加原料
            </span>
          </div>
        </div>

        <!-- 单选 slot -->
        <div v-else-if="f.kind === 'slot'" class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">{{ f.label }}</span>
          <Select
            :model-value="String(fieldVal(f.key) ?? slots[0]?.slot ?? '')"
            @update:model-value="patch({ [f.key]: $event })"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="s in slots" :key="s.slot" :value="s.slot">
                {{ s.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 冰型 -->
        <div v-else-if="f.kind === 'ice_type'" class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">{{ f.label }}</span>
          <Select
            :model-value="String(fieldVal(f.key) ?? 'cube')"
            @update:model-value="patch({ iceType: $event })"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in ICE_TYPE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 冰量 0..1 -->
        <div v-else-if="f.kind === 'fill'" class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">
            {{ f.label }}：{{ Math.round((Number(fieldVal(f.key)) || 0) * 100) }}%
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
            :value="Number(fieldVal(f.key)) || 0"
            @input="patch({ fill: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <!-- 布尔 -->
        <div v-else-if="f.kind === 'boolean'" class="flex items-center gap-2 self-end pb-1">
          <Checkbox
            :id="`${modelValue.id}-${f.key}`"
            :model-value="Boolean(fieldVal(f.key))"
            @update:model-value="patch({ [f.key]: $event === true })"
          />
          <label :for="`${modelValue.id}-${f.key}`" class="text-xs">{{ f.label }}</label>
        </div>

        <!-- 数字 / 时长 -->
        <div v-else-if="f.kind === 'number' || f.kind === 'duration'" class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">
            {{ f.label }}{{ f.required ? "" : "（可选）" }}
          </span>
          <Input
            type="number"
            class="h-8 text-xs tabular-nums"
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
        <div v-else class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">
            {{ f.label }}{{ f.required ? "" : "（可选）" }}
          </span>
          <Select
            :model-value="fieldVal(f.key) === undefined || fieldVal(f.key) === null ? '_unset' : String(fieldVal(f.key))"
            @update:model-value="
              $event === '_unset' ? patch({ [f.key]: undefined }) : patch({ [f.key]: $event })
            "
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="!f.required" value="_unset">未设置</SelectItem>
              <SelectItem v-for="o in opts(f)" :key="o.value" :value="o.value">
                {{ o.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </template>
    </div>
  </div>
</template>
