<script setup lang="ts">
/**
 * 配方筛选器（游戏里的「条件检索」面板）：家族 / 手法 / 杯型 / 来源 / 排序下拉，
 * 标签多选 + 组合方式，酒精度·容量区间，难度星级。搜索结果页与「酒馆」页共用；
 * 每一项与后端 filterConds 一一对应（标签走配方自身的 recipe_tags，不是按原料反推）。
 */
import { FAMILY_ZH, METHOD_ZH } from "@/lib/labels";
import {
  ABV_MAX,
  VOLUME_MAX,
  defaultFilter,
  isFilterActive,
  type RecipeFilterState,
} from "@/lib/recipe-filter";

const props = withDefaults(defineProps<{ showSort?: boolean }>(), { showSort: false });
const filter = defineModel<RecipeFilterState>({ required: true });
const vocab = useVocabStore();
const { play } = useSfx();

onMounted(() => {
  void vocab.ensure().catch(() => {});
});

function patch(p: Partial<RecipeFilterState>): void {
  filter.value = { ...filter.value, ...p };
}

const hasFilters = computed(() => isFilterActive(filter.value, props.showSort));

const SORTS = [
  { value: "relevance", label: "相关度" },
  { value: "hot", label: "最热" },
  { value: "new", label: "最新" },
];
const familyOpts = computed(() => [
  { value: "all", label: "全部家族" },
  ...Object.entries(FAMILY_ZH).map(([value, label]) => ({ value, label })),
]);
const methodOpts = computed(() => [
  { value: "all", label: "全部手法" },
  ...Object.entries(METHOD_ZH).map(([value, label]) => ({ value, label })),
]);
const glassOpts = computed(() => [
  { value: "all", label: "全部杯型" },
  ...vocab.glassware.map((g) => ({ value: g.id, label: g.nameZh })),
]);
const ORIGINS = [
  { value: "all", label: "全部来源" },
  { value: "original", label: "原创" },
  { value: "canonical", label: "权威" },
];

/** 双滑块区间 ↔ 扁平状态字段。 */
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
  play("cancel");
}

function toggleTag(id: string): void {
  play("click");
  const tags = filter.value.tags.includes(id)
    ? filter.value.tags.filter((t) => t !== id)
    : [...filter.value.tags, id];
  patch({ tags });
}
</script>

<template>
  <PxPanel title="条件检索" icon="filter" tone="cyan">
    <template #actions>
      <PxButton v-if="hasFilters" size="sm" variant="ghost" icon="x" :sfx="false" @click="clearFilters()">清除</PxButton>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <PxSelect
          v-if="showSort"
          :model-value="filter.sort"
          :options="SORTS"
          size="sm"
          class="w-28"
          @update:model-value="(v) => patch({ sort: v as RecipeFilterState['sort'] })"
        />
        <PxSelect :model-value="filter.family" :options="familyOpts" size="sm" class="w-32" @update:model-value="(v) => patch({ family: String(v) })" />
        <PxSelect :model-value="filter.method" :options="methodOpts" size="sm" class="w-28" @update:model-value="(v) => patch({ method: String(v) })" />
        <PxSelect :model-value="filter.glass" :options="glassOpts" size="sm" class="w-32" @update:model-value="(v) => patch({ glass: String(v) })" />
        <PxSelect
          :model-value="filter.origin || 'all'"
          :options="ORIGINS"
          size="sm"
          class="w-28"
          @update:model-value="(v) => patch({ origin: v === 'all' ? '' : (String(v) as RecipeFilterState['origin']) })"
        />
      </div>

      <div v-if="vocab.tags.length" class="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span class="mr-2 text-faint">标签</span>
        <button
          v-for="t in vocab.tags"
          :key="t.id"
          type="button"
          class="chip"
          :class="{ on: filter.tags.includes(t.id) }"
          :aria-pressed="filter.tags.includes(t.id)"
          @click="toggleTag(t.id)"
        >
          {{ t.nameZh }}
        </button>
        <!-- 组合方式：选到第 2 个标签才影响结果，所以此时才出现 -->
        <span v-if="filter.tags.length > 1" class="ml-3 flex items-center gap-2 text-faint">
          组合
          <PxSegmented
            :model-value="filter.tagMode"
            size="sm"
            :items="[{ value: 'or', label: '任一' }, { value: 'and', label: '全部' }]"
            @update:model-value="(v) => patch({ tagMode: v as RecipeFilterState['tagMode'] })"
          />
        </span>
      </div>

      <div class="grid gap-x-8 gap-y-3 md:grid-cols-[1fr_1fr_auto]">
        <div class="flex items-center gap-3">
          <span class="w-12 shrink-0 text-faint">酒精度</span>
          <PxSlider v-model="abvRange" :min="0" :max="ABV_MAX" :step="1" label="酒精度" class="flex-1" />
          <span class="w-16 shrink-0 text-right font-logo text-[8px] text-amber">{{ abvLabel }}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-12 shrink-0 text-faint">容量</span>
          <PxSlider v-model="volumeRange" :min="0" :max="VOLUME_MAX" :step="10" label="容量" class="flex-1" />
          <span class="w-16 shrink-0 text-right font-logo text-[8px] text-amber">{{ volumeLabel }}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-faint">难度 ≤</span>
          <PxStars
            :model-value="filter.difficultyMax"
            label="难度不高于"
            @update:model-value="(v) => patch({ difficultyMax: v })"
          />
        </div>
      </div>
    </div>
  </PxPanel>
</template>

<style scoped>
.chip {
  height: 22px;
  margin: 2px;
  padding: 0 7px;
  background: var(--panel-lo);
  color: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--line);
}
.chip:hover { color: var(--fg); box-shadow: 0 0 0 var(--p) var(--amber); }
.chip.on {
  background: var(--amber);
  color: var(--on-accent);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35);
}
</style>
