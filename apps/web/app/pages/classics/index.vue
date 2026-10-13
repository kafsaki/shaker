<script setup lang="ts">
/**
 * 经典图鉴：IBA 分档 / 家族筛选 + 页内搜索。
 * 每杯经典按列表顺序编号（No.001…），像翻一本收集册；编号只是展示序，不是数据字段。
 */
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { FAMILY_ZH } from "@/lib/labels";
import { dexNo } from "@/lib/game";

type Page = components["schemas"]["RecipeListOutputBody"];

useHead({ title: "经典图鉴 · Shaker" });

const api = useApi();
// reka-ui 禁止 SelectItem 用空字符串 value（空串是"清除选择"的保留值），用 all 哨兵
type IbaFilter = "all" | "none" | "unforgettable" | "contemporary" | "new_era";
const iba = ref<IbaFilter>("all");
const family = ref("all");

const IBA_ITEMS: { value: IbaFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "unforgettable", label: "IBA 传世经典" },
  { value: "contemporary", label: "当代" },
  { value: "new_era", label: "新纪元" },
  { value: "none", label: "非 IBA" },
];
const familyOpts = [
  { value: "all", label: "全部家族" },
  ...Object.entries(FAMILY_ZH).map(([value, label]) => ({ value, label })),
];
// PxSegmented 的 v-model 是 string，这里收窄回分档类型
const ibaModel = computed({
  get: () => iba.value,
  set: (v: string) => (iba.value = v as IbaFilter),
});

// 页内搜索：防抖后作为查询条件（与原料库一致，不进地址栏）
const q = ref("");
const debouncedQ = ref("");
let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});

const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: computed(() => ["classics", iba.value, family.value, debouncedQ.value] as const),
    queryFn: async ({ pageParam }): Promise<Page> => {
      const { data, error } = await api.GET("/api/v1/classics", {
        params: {
          query: {
            ibaCategory: iba.value !== "all" ? iba.value : undefined,
            family: family.value !== "all" ? family.value : undefined,
            q: debouncedQ.value || undefined,
            cursor: pageParam || undefined,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

const items = computed(() => data.value?.pages.flatMap((p) => p.items ?? []) ?? []);
/** 收录计数：还有下一页时只能说「至少 N 杯」。 */
const collected = computed(() => `${items.value.length}${hasNextPage.value ? "+" : ""}`);
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- 图鉴封面：标题 + 收录计数 -->
    <header class="cover px-stripes">
      <div class="flex min-w-0 items-center gap-4">
        <span class="emblem" aria-hidden="true"><PxIcon name="book" :scale="4" /></span>
        <div class="min-w-0">
          <p class="font-logo text-[8px] tracking-[0.3em] text-gold">CLASSIC CODEX</p>
          <h1 class="text-2xl text-fg text-shadow-px">经典图鉴</h1>
          <p class="text-dim">IBA 官方经典与老派名作，每一杯都能在吧台上看它被调出来。</p>
        </div>
      </div>
      <div class="counter" :aria-label="`已收录 ${collected} 杯`">
        <span class="text-faint">已收录</span>
        <span class="font-logo text-[16px] text-gold">{{ isLoading ? "---" : collected }}</span>
        <span class="text-faint">杯</span>
      </div>
    </header>

    <!-- 检索条：分档 / 家族 / 名称 -->
    <div class="flex flex-col gap-3">
      <PxSegmented v-model="ibaModel" :items="IBA_ITEMS" class="max-w-full self-start" />
      <div class="flex flex-wrap items-center gap-2">
        <PxSelect v-model="family" :options="familyOpts" class="w-40" />
        <PxInput v-model="q" icon="search" placeholder="搜经典配方名…" class="w-full max-w-sm flex-1" />
      </div>
    </div>

    <div v-if="isLoading" class="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
      <div v-for="i in 8" :key="i" class="flex flex-col gap-2">
        <PxSkeleton class="h-5 w-16" />
        <PxSkeleton class="aspect-[3/4]" />
      </div>
    </div>

    <PxEmpty v-else-if="isError && items.length === 0" icon="warn" tone="red" :title="apiErrorMessage(error)" />

    <PxEmpty
      v-else-if="items.length === 0"
      icon="book"
      :title="debouncedQ ? '没有匹配的经典，试试换个关键词' : '没有匹配的经典'"
    />

    <template v-else>
      <ol class="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        <li v-for="(r, i) in items" :key="r.id" class="entry">
          <p class="dex" aria-hidden="true">
            <span class="no">{{ dexNo(i + 1) }}</span>
            <span class="rule" />
            <PxIcon v-if="r.ibaCategory" name="crown" :scale="1" class="text-gold" />
          </p>
          <RecipeCard :recipe="r" :to="`/classics/${r.classicKey}`" />
        </li>
      </ol>
      <InfiniteLoader
        :has-next-page="hasNextPage"
        :is-fetching-next-page="isFetchingNextPage"
        :error="isError"
        @load="fetchNextPage()"
      />
    </template>
  </div>
</template>

<style scoped>
.cover {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  margin: calc(var(--p) * 2);
  background-color: var(--panel);
  /* 封皮压纹：金色斜纹压得很淡，硬边 */
  --stripe: color-mix(in srgb, var(--gold) 7%, transparent);
  box-shadow:
    0 0 0 var(--p) var(--gold),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    calc(var(--p) * 4) calc(var(--p) * 4) 0 calc(var(--p) * 2) var(--shadow);
}
.emblem {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  color: var(--gold);
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
  --px-icon-2: var(--amber-lo);
  --px-icon-2-alpha: 1;
}
.counter {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 14px;
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}

.entry { display: flex; flex-direction: column; min-width: 0; }
.dex {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 calc(var(--p) * 2) 2px;
}
.no {
  padding: 3px 6px;
  background: var(--ink);
  color: var(--gold);
  font-family: var(--font-logo);
  font-size: 8px;
  line-height: 1;
  letter-spacing: 0.1em;
}
.rule { flex: 1; height: var(--p); background: var(--line); }
.entry:hover .no { background: var(--gold); color: var(--on-accent); }
.entry:hover .rule { background: var(--gold); }
</style>
