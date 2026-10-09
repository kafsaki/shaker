<script setup lang="ts">
/**
 * 配方筛选条：家族 / 手法 / 杯型 / 标签，可选排序。
 * 搜索结果页与「探索」页共用；筛选项与后端 filterConds 一一对应
 * （标签走配方自身的 recipe_tags，非按原料反推）。
 */
import { SlidersHorizontal, X } from "lucide-vue-next";
import { FAMILY_ZH, METHOD_ZH } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const props = withDefaults(defineProps<{ showSort?: boolean }>(), { showSort: false });

// reka-ui 的 SelectItem 不接受空字符串 value（空串保留给「清除选择」），统一用 all 哨兵
const family = defineModel<string>("family", { required: true });
const method = defineModel<string>("method", { required: true });
const glass = defineModel<string>("glass", { required: true });
const tag = defineModel<string>("tag", { required: true });
const sort = defineModel<"relevance" | "hot" | "new">("sort", { default: "relevance" });

const SORTS = [
  { key: "relevance", label: "相关度" },
  { key: "hot", label: "最热" },
  { key: "new", label: "最新" },
] as const;

const vocab = useVocabStore();

onMounted(() => {
  void vocab.ensure().catch(() => {});
});

const hasFilters = computed(
  () =>
    family.value !== "all" ||
    method.value !== "all" ||
    glass.value !== "all" ||
    tag.value !== "" ||
    (props.showSort && sort.value !== "relevance"),
);

function clearFilters(): void {
  family.value = "all";
  method.value = "all";
  glass.value = "all";
  tag.value = "";
  if (props.showSort) sort.value = "relevance";
}

function toggleTag(id: string): void {
  tag.value = tag.value === id ? "" : id;
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-sm border-2 border-border bg-card p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="flex items-center gap-1 text-xs text-muted-foreground">
        <SlidersHorizontal class="size-3.5" /> 筛选
      </span>
      <Select v-if="showSort" v-model="sort">
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="family">
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue placeholder="家族" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部家族</SelectItem>
          <SelectItem v-for="(zh, f) in FAMILY_ZH" :key="f" :value="f">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="method">
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue placeholder="手法" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部手法</SelectItem>
          <SelectItem v-for="(zh, m) in METHOD_ZH" :key="m" :value="m">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="glass">
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue placeholder="杯型" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部杯型</SelectItem>
          <SelectItem v-for="g in vocab.glassware" :key="g.id" :value="g.id">
            {{ g.nameZh }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Button
        v-if="hasFilters"
        variant="ghost"
        size="sm"
        class="h-8 gap-1 text-xs"
        @click="clearFilters()"
      >
        <X class="size-3.5" /> 清除
      </Button>
    </div>

    <div v-if="vocab.tags.length" class="flex flex-wrap gap-1.5">
      <button
        v-for="t in vocab.tags"
        :key="t.id"
        type="button"
        class="rounded-sm border px-2 py-1 text-xs transition-colors"
        :class="
          tag === t.id
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
        "
        @click="toggleTag(t.id)"
      >
        {{ t.nameZh }}
      </button>
    </div>
  </div>
</template>