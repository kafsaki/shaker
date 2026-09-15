<script setup lang="ts">
/** 编辑器原料行：词表选择 + 角色 + 单位（discriminated union 约束）+ 用量。 */
import { Trash2 } from "lucide-vue-next";
import type { IngredientRef } from "@shaker/recipe-ir";
import { UNIT_GROUPS, ROLE_OPTIONS } from "@/lib/editor-schema";
import IngredientPicker from "./IngredientPicker.vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const props = defineProps<{ modelValue: IngredientRef }>();
const emit = defineEmits<{
  "update:modelValue": [value: IngredientRef];
  remove: [];
}>();

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
</script>

<template>
  <div class="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_120px]">
    <div class="flex flex-col gap-2">
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <IngredientPicker
            :model-value="modelValue.ingredientId"
            @update:model-value="patch({ ingredientId: $event ?? '' })"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="mt-0.5 size-8 shrink-0 text-destructive"
          title="删除原料"
          @click="emit('remove')"
        >
          <Trash2 class="size-4" />
        </Button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <code class="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
          {{ modelValue.slot }}
        </code>

        <Select :model-value="roleValue" @update:model-value="patch({ role: String($event) })">
          <SelectTrigger class="h-8 w-28 text-xs">
            <SelectValue placeholder="角色" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value">
              {{ r.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select :model-value="modelValue.unit" @update:model-value="setUnit(String($event))">
          <SelectTrigger class="h-8 w-24 text-xs">
            <SelectValue placeholder="单位" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>体积</SelectLabel>
              <SelectItem v-for="u in UNIT_GROUPS.filter((g) => g.kind === 'volume')" :key="u.value" :value="u.value">
                {{ u.label }}
              </SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>勺量</SelectLabel>
              <SelectItem v-for="u in UNIT_GROUPS.filter((g) => g.kind === 'spoon')" :key="u.value" :value="u.value">
                {{ u.label }}
              </SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>准体积</SelectLabel>
              <SelectItem v-for="u in UNIT_GROUPS.filter((g) => g.kind === 'quasi')" :key="u.value" :value="u.value">
                {{ u.label }}
              </SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>计数</SelectLabel>
              <SelectItem v-for="u in UNIT_GROUPS.filter((g) => g.kind === 'count')" :key="u.value" :value="u.value">
                {{ u.label }}
              </SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>无量</SelectLabel>
              <SelectItem v-for="u in UNIT_GROUPS.filter((g) => g.kind === 'none')" :key="u.value" :value="u.value">
                {{ u.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div v-if="currentKind !== 'none'" class="flex items-center gap-1.5">
          <Label class="sr-only" for="amt">用量</Label>
          <Input
            id="amt"
            type="number"
            class="h-8 w-20 text-xs tabular-nums"
            :min="currentKind === 'count' ? 1 : 0.1"
            :step="currentKind === 'count' ? 1 : 'any'"
            :model-value="('amount' in modelValue ? modelValue.amount : 1) ?? ''"
            @update:model-value="patch({ amount: Number($event) })"
          />
          <span class="text-xs text-muted-foreground">{{ modelValue.unit }}</span>
        </div>

        <label class="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            :model-value="modelValue.optional ?? false"
            @update:model-value="patch({ optional: $event === true })"
          />
          可选
        </label>
      </div>
    </div>
  </div>
</template>
