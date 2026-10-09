<script setup lang="ts">
/**
 * 配方筛选条：家族 / 手法 / 杯型 / 标签 / 原创·权威 / 酒精度·容量区间 / 难度星级，
 * 可选排序。搜索结果页与「探索」页共用；每一项与后端 filterConds 一一对应
 * （标签走配方自身的 recipe_tags，不是按原料反推）。
 */
import { SlidersHorizontal, X } from "lucide-vue-next";
import { FAMILY_ZH, METHOD_ZH } from "@/lib/labels";
import {
  ABV_MAX,
  VOLUME_MAX,
  defaultFilter,
  isFilterActive,
  type RecipeFilterState,
} from "@/lib/recipe-filter";
import StarRating from "@/components/StarRating.vue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

const props = withDefaults(defineProps<{ showSort?: boolean }>(), { showSort: false });

const filter = defineModel<RecipeFilterState>({ required: true });

const SORTS = [
  { key: "relevance", label: "相关度" },
  { key: "hot", label: "最热" },
  { key: "new", label: "最新" },
] as const;

const ORIGINS = [
  { key: "all", label: "全部来源" },
  { key: "original", label: "原创" },
  { key: "canonical", label: "权威" },
] as const;

const vocab = useVocabStore();

onMounted(() => {
  void vocab.ensure().catch(() => {});
});

function patch(p: Partial<RecipeFilterState>): void {
  filter.value = { ...filter.value, ...p };
}

const hasFilters = computed(() => isFilterActive(filter.value, props.showSort));

/** 滑块值（双滑块区间）↔ 扁平状态字段。 */
const abvRange = computed({
  get: () => [filter.value.abvMin, filter.value.abvMax],
  set: (v: number[]) => patch({ abvMin: v[0] ?? 0, abvMax: v[1] ?? ABV_MAX }),
});
const volumeRange = computed({
  get: () => [filter.value.volumeMin, filter.value.volumeMax],
  set: (v: number[]) => patch({ volumeMin: v[0] ?? 0, volumeMax: v[1] ?? VOLUME_MAX }),
});

const abvLabel = computed(() =>
  filter.value.abvMin === 0 && filter.value.abvMax >= ABV_MAX
    ? "不限"
    : `${filter.value.abvMin}~${filter.value.abvMax >= ABV_MAX ? "" : filter.value.abvMax}%`,
);
const volumeLabel = computed(() =>
  filter.value.volumeMin === 0 && filter.value.volumeMax >= VOLUME_MAX
    ? "不限"
    : `${filter.value.volumeMin}~${filter.value.volumeMax >= VOLUME_MAX ? "" : filter.value.volumeMax}ml`,
);

function clearFilters(): void {
  const keepSort = filter.value.sort;
  filter.value = { ...defaultFilter(), sort: props.showSort ? "relevance" : keepSort };
}

function toggleTag(id: string): void {
  patch({ tag: filter.value.tag === id ? "" : id });
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-sm border-2 border-border bg-card p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="flex items-center gap-1 text-xs text-muted-foreground">
        <SlidersHorizontal class="size-3.5" /> 筛选
      </span>
      <Select
        v-if="showSort"
        :model-value="filter.sort"
        @update:model-value="(v) => patch({ sort: v as RecipeFilterState['sort'] })"
      >
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</SelectItem>
        </SelectContent>
      </Select>
      <Select :model-value="filter.family" @update:model-value="(v) => patch({ family: String(v) })">
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue placeholder="家族" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部家族</SelectItem>
          <SelectItem v-for="(zh, f) in FAMILY_ZH" :key="f" :value="f">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
      <Select :model-value="filter.method" @update:model-value="(v) => patch({ method: String(v) })">
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue placeholder="手法" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部手法</SelectItem>
          <SelectItem v-for="(zh, m) in METHOD_ZH" :key="m" :value="m">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
      <Select :model-value="filter.glass" @update:model-value="(v) => patch({ glass: String(v) })">
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue placeholder="杯型" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部杯型</SelectItem>
          <SelectItem v-for="g in vocab.glassware" :key="g.id" :value="g.id">
            {{ g.nameZh }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        :model-value="filter.origin || 'all'"
        @update:model-value="(v) => patch({ origin: v === 'all' ? '' : (String(v) as RecipeFilterState['origin']) })"
      >
        <SelectTrigger class="h-8 w-28 text-xs"><SelectValue placeholder="来源" /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="o in ORIGINS" :key="o.key" :value="o.key">{{ o.label }}</SelectItem>
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
          filter.tag === t.id
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
        "
        @click="toggleTag(t.id)"
      >
        {{ t.nameZh }}
      </button>
    </div>

    <!-- 数值维度：区间条形 + 星级 -->
    <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div class="flex min-w-56 flex-1 items-center gap-2">
        <span class="w-14 shrink-0 text-xs text-muted-foreground">酒精度</span>
        <Slider v-model="abvRange" :min="0" :max="ABV_MAX" :step="1" class="flex-1" />
        <span class="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {{ abvLabel }}
        </span>
      </div>
      <div class="flex min-w-56 flex-1 items-center gap-2">
        <span class="w-14 shrink-0 text-xs text-muted-foreground">容量</span>
        <Slider v-model="volumeRange" :min="0" :max="VOLUME_MAX" :step="10" class="flex-1" />
        <span class="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {{ volumeLabel }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">难度</span>
        <StarRating
          :model-value="filter.difficultyMax"
          @update:model-value="(v) => patch({ difficultyMax: v })"
        />
      </div>
    </div>
  </div>
</template>