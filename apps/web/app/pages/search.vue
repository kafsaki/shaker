<script setup lang="ts">
/**
 * 搜索终端：大号检索框 + 「配方 / 原料 / 酒单 / 用户」页签。
 * 各 Tab 独立游标分页（useInfiniteQuery），且只在激活时请求。
 * 配方 Tab 额外提供标签、家族、手法、杯型与排序筛选。
 * 结果按类型换皮：配方 = 收藏卡，酒单 = 卡册行，用户 = 角色卡，原料 = 物品格。
 */
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { CATEGORY_ZH } from "@/lib/labels";
import { CATEGORY_ICON, compact, levelOf, rankOf } from "@/lib/game";
import type { PixelIconName } from "@/lib/pixel-icons";
import {
  filterFromQuery,
  filterKey,
  filterToParams,
  filterToQuery,
  isFilterActive,
  type RecipeFilterState,
} from "@/lib/recipe-filter";

type SearchOut = components["schemas"]["SearchOutputBody"];

const TABS = [
  { key: "recipe", label: "配方", icon: "martini" },
  { key: "ingredient", label: "原料", icon: "bottle" },
  { key: "menu", label: "酒单", icon: "list" },
  { key: "user", label: "用户", icon: "user" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TAB_ITEMS = TABS.map((t) => ({ value: t.key, label: t.label, icon: t.icon as PixelIconName }));

const route = useRoute();
const router = useRouter();
const api = useApi();
const vocab = useVocabStore();

const q = ref((route.query.q as string) ?? "");
const tab = ref<TabKey>(normalizeTab(route.query.type as string));
const submitted = ref((route.query.q as string) ?? "");

/** 筛选状态（家族/手法/杯型/标签/来源/区间/难度/排序），与「探索」页共用一套定义。 */
const filter = ref<RecipeFilterState>(filterFromQuery(route.query));

/** 是否有生效的筛选（决定空关键词是否出结果、空态文案）。 */
const hasFilters = computed(() => isFilterActive(filter.value, true));

// 空关键词也可搜索（返回全部），带着筛选直链进来同样直接出结果；
// 只有完全裸访问 /search 才停留在「先输关键词」的空态。
const searched = ref(Boolean(submitted.value) || hasFilters.value);

function normalizeTab(v: string | undefined): TabKey {
  return TABS.some((t) => t.key === v) ? (v as TabKey) : "recipe";
}

/** 把当前状态写回地址栏，保证刷新/分享后结果可复现。 */
function syncQuery(): void {
  router.replace({
    query: {
      ...(submitted.value ? { q: submitted.value } : {}),
      ...(tab.value !== "recipe" ? { type: tab.value } : {}),
      ...filterToQuery(filter.value),
    },
  });
}

// 空关键词 = 只按筛选条件查全量（如 ?tag=after-dinner）；导航栏那个搜索框仍要求非空
function submit(): void {
  submitted.value = q.value.trim();
  searched.value = true;
  syncQuery();
}

/** 空态里的示例关键词：点一下直接搜。 */
function tryKeyword(k: string): void {
  q.value = k;
  submit();
}

function switchTab(next: TabKey): void {
  if (next === tab.value) return;
  tab.value = next;
  syncQuery();
}

/** 窄屏页签横向滚动：把选中页签滚进视野。 */
/** 只横向滚动页签条（scrollIntoView 会连带滚动整页）。 */
function revealTab(strip: HTMLElement | null): void {
  const on = strip?.querySelector<HTMLElement>(".seg.on");
  if (!strip || !on) return;
  const l = on.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
  if (l < strip.scrollLeft || l + on.offsetWidth > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = Math.max(0, l - 8);
  }
}
const tabsEl = ref<HTMLElement | null>(null);
watch(
  [tab, tabsEl],
  () => nextTick(() => revealTab(tabsEl.value)),
  { immediate: true },
);

// 筛选变化即时重查并写回地址栏（下拉/标签/滑块点了就走）；
// 未搜索状态下点筛选也直接出结果（等价于空关键词搜索）
watch(
  filter,
  () => {
    if (hasFilters.value) searched.value = true;
    if (searched.value) syncQuery();
  },
  { deep: true },
);

/** 各 Tab 独立的无限查询骨架：仅激活的 Tab 发请求。 */
const recipeQuery = useInfiniteQuery({
  queryKey: computed(
    () =>
      ["search", "recipe", submitted.value, filterKey(filter.value, true)] as const,
  ),
  queryFn: async ({ pageParam }): Promise<NonNullable<SearchOut["recipes"]>> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          q: submitted.value || undefined,
          type: "recipe",
          cursor: pageParam || undefined,
          limit: 24,
          sort: filter.value.sort,
          ...filterToParams(filter.value),
        },
      },
    });
    if (error) throw error;
    if (!data.recipes) throw new Error("搜索结果为空");
    return data.recipes;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: computed(() => searched.value && tab.value === "recipe"),
});

const menuQuery = useInfiniteQuery({
  queryKey: computed(() => ["search", "menu", submitted.value] as const),
  queryFn: async ({ pageParam }): Promise<NonNullable<SearchOut["menus"]>> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          q: submitted.value || undefined,
          type: "menu",
          cursor: pageParam || undefined,
          limit: 24,
        },
      },
    });
    if (error) throw error;
    if (!data.menus) throw new Error("搜索结果为空");
    return data.menus;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: computed(() => searched.value && tab.value === "menu"),
});

const userQuery = useInfiniteQuery({
  queryKey: computed(() => ["search", "user", submitted.value] as const),
  queryFn: async ({ pageParam }): Promise<NonNullable<SearchOut["users"]>> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          q: submitted.value || undefined,
          type: "user",
          cursor: pageParam || undefined,
          limit: 24,
        },
      },
    });
    if (error) throw error;
    if (!data.users) throw new Error("搜索结果为空");
    return data.users;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: computed(() => searched.value && tab.value === "user"),
});

const ingredientQuery = useInfiniteQuery({
  queryKey: computed(() => ["search", "ingredient", submitted.value] as const),
  queryFn: async ({ pageParam }): Promise<NonNullable<SearchOut["ingredients"]>> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          q: submitted.value || undefined,
          type: "ingredient",
          cursor: pageParam || undefined,
          limit: 24,
        },
      },
    });
    if (error) throw error;
    if (!data.ingredients) throw new Error("搜索结果为空");
    return data.ingredients;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: computed(() => searched.value && tab.value === "ingredient"),
});

const recipes = computed(
  () => recipeQuery.data.value?.pages.flatMap((p) => p.items ?? []) ?? [],
);
const menus = computed(
  () => menuQuery.data.value?.pages.flatMap((p) => p.items ?? []) ?? [],
);
const users = computed(
  () => userQuery.data.value?.pages.flatMap((p) => p.items ?? []) ?? [],
);
const ingredients = computed(
  () => ingredientQuery.data.value?.pages.flatMap((p) => p.items ?? []) ?? [],
);

/** 当前 Tab 的查询结果，供模板统一取 loading / 分页状态。 */
const activeQuery = computed(() => {
  if (tab.value === "recipe") return recipeQuery;
  if (tab.value === "menu") return menuQuery;
  if (tab.value === "user") return userQuery;
  return ingredientQuery;
});
const isLoading = computed(() => activeQuery.value.isLoading.value);
const isFetching = computed(() => activeQuery.value.isFetching.value);
const hasNextPage = computed(() => activeQuery.value.hasNextPage.value);
const isFetchingNextPage = computed(() => activeQuery.value.isFetchingNextPage.value);
const isError = computed(() => activeQuery.value.isError.value);
const isEmpty = computed(() => {
  if (tab.value === "recipe") return recipes.value.length === 0;
  if (tab.value === "menu") return menus.value.length === 0;
  if (tab.value === "user") return users.value.length === 0;
  return ingredients.value.length === 0;
});
/** 命中总数（服务端给了才显示，首页即带）。 */
const total = computed(() => activeQuery.value.data.value?.pages[0]?.total);

/** 当前 Tab 的中文名与图标（空态文案复用）。 */
const tabLabel = computed(() => TABS.find((t) => t.key === tab.value)?.label ?? "");
const tabIcon = computed<PixelIconName>(() => TABS.find((t) => t.key === tab.value)?.icon ?? "search");

function loadMore(): void {
  void activeQuery.value.fetchNextPage();
}

/* 原料物品格的副色取自词表里的 viz.color（搜索结果本身不带 viz） */
onMounted(() => {
  void vocab.ensure().catch(() => {});
});
function ingColor(id: string): string {
  const viz = vocab.ingMap.get(id)?.viz as { color?: string } | undefined;
  return viz?.color ?? "var(--dim)";
}

useHead(() => ({
  title: submitted.value ? `${submitted.value} · 搜索 · Shaker` : "搜索 · Shaker",
}));
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-5">
    <!-- 检索终端 -->
    <PxPanel title="搜索终端" icon="search" tone="cyan">
      <template #actions>
        <span class="font-logo text-[8px] tracking-[0.2em] text-faint max-sm:!hidden">SEARCH.EXE</span>
      </template>
      <form class="flex items-center gap-2" @submit.prevent="submit()">
        <!-- PxInput 的 class 会透传到内部 <input>，伸缩交给外层 div -->
        <div class="min-w-0 flex-1">
          <PxInput
            v-model="q"
            size="lg"
            icon="search"
            placeholder="搜配方 / 酒单 / 用户 / 原料…"
            :autofocus="!submitted"
          />
        </div>
        <PxButton type="submit" size="lg" variant="primary" icon="search" :loading="isFetching" sfx="confirm">
          <span class="max-sm:hidden">搜索</span>
        </PxButton>
      </form>
    </PxPanel>

    <!-- 页签 -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <!-- 窄屏页签不换行，横向滑动（换行会把选中页签与内容区断开） -->
      <div ref="tabsEl" class="tabs-scroll min-w-0 flex-1">
        <PxSegmented
          :model-value="tab"
          variant="tabs"
          :items="TAB_ITEMS"
          class="!flex-nowrap min-w-full"
          @update:model-value="(v) => switchTab(v as TabKey)"
        />
      </div>
      <p v-if="searched && total !== undefined && !isLoading" class="font-logo text-[8px] tracking-[0.15em] text-dim">
        HIT <span class="text-amber">{{ total }}</span>
      </p>
    </div>

    <!-- 配方筛选（与「酒馆」页共用同一组件） -->
    <RecipeFilterBar v-if="tab === 'recipe'" v-model="filter" show-sort />

    <!-- 结果 -->
    <div v-if="isLoading">
      <div v-if="tab === 'recipe'" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <PxSkeleton v-for="i in 8" :key="i" class="aspect-[3/4]" />
      </div>
      <div v-else class="flex flex-col gap-3">
        <PxSkeleton v-for="i in 3" :key="i" class="h-24" />
      </div>
    </div>

    <div v-else-if="searched" class="flex flex-col gap-4">
      <PxEmpty v-if="isError && isEmpty" icon="warn" tone="red" :title="apiErrorMessage(activeQuery.error.value)" />

      <PxEmpty
        v-else-if="isEmpty"
        :icon="tabIcon"
        :title="`没有找到相关${tabLabel}${tab === 'recipe' && hasFilters ? '，试试清除筛选' : ''}`"
      />

      <!-- 配方：收藏卡 -->
      <div v-else-if="tab === 'recipe'" class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
        <RecipeCard v-for="r in recipes" :key="r.id" :recipe="r" />
      </div>

      <!-- 酒单：卡册行 -->
      <div v-else-if="tab === 'menu'" class="flex flex-col gap-4">
        <MenuRow v-for="m in menus" :key="m.id" :menu="m" />
      </div>

      <!-- 用户：角色卡 -->
      <div v-else-if="tab === 'user'" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink v-for="u in users" :key="u.id" :to="`/u/${u.handle}`" class="hero">
          <PxAvatar :src="u.avatarUrl" :seed="u.handle" :size="48" />
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1">
              <span class="cur" aria-hidden="true">▶</span>
              <span class="truncate text-fg">{{ u.displayName }}</span>
              <PxBadge v-if="u.isOfficial" tone="gold" icon="crown">官方</PxBadge>
            </p>
            <p class="truncate text-faint">@{{ u.handle }}</p>
            <p class="mt-1 flex items-center gap-2 text-faint">
              <span class="text-dim">{{ rankOf(u.recipeCount) }}</span>
              <span class="font-logo text-[8px] text-amber">LV.{{ levelOf({ recipe: u.recipeCount, follower: u.followerCount }) }}</span>
            </p>
          </div>
          <div class="stats">
            <span><b class="font-logo text-[8px] text-amber">{{ compact(u.recipeCount) }}</b>配方</span>
            <span><b class="font-logo text-[8px] text-pink">{{ compact(u.followerCount) }}</b>粉丝</span>
          </div>
        </NuxtLink>
      </div>

      <!-- 原料：物品格 -->
      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <NuxtLink v-for="g in ingredients" :key="g.id" :to="`/ingredients/${g.id}`" class="item">
          <span class="slot" :style="`--px-icon-2: ${ingColor(g.id)}; --px-icon-2-alpha: 1`">
            <PxIcon :name="CATEGORY_ICON[g.category] ?? 'question'" :scale="3" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-fg">{{ g.nameZh }}</span>
            <span class="block truncate text-faint">{{ g.nameEn }}</span>
            <span class="mt-1 flex flex-wrap items-center gap-1">
              <PxBadge>{{ CATEGORY_ZH[g.category] ?? g.category }}</PxBadge>
              <span v-if="g.abv" class="font-logo text-[8px] text-amber">{{ g.abv }}%</span>
            </span>
          </span>
        </NuxtLink>
      </div>

      <InfiniteLoader
        :has-next-page="hasNextPage"
        :is-fetching-next-page="isFetchingNextPage"
        :error="isError"
        :ended-text="!isEmpty ? 'THE END' : null"
        @load="loadMore()"
      />
    </div>

    <PxEmpty v-else icon="search" title="输入关键词开始搜索，配方、原料、酒单、调酒师都能找。">
      <span>试试</span>
      <PxButton size="sm" icon="search" @click="tryKeyword('Daiquiri')">Daiquiri</PxButton>
      <PxButton size="sm" icon="search" @click="tryKeyword('朗姆')">朗姆</PxButton>
      <PxButton size="sm" icon="search" @click="tryKeyword('金酒')">金酒</PxButton>
    </PxEmpty>
  </div>
</template>

<style scoped>
.tabs-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-top: 4px;
  scrollbar-width: none;
}
.tabs-scroll::-webkit-scrollbar { display: none; }
.tabs-scroll :deep(.seg) { flex-shrink: 0; white-space: nowrap; }
/* 角色卡 */
.hero {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: calc(var(--p) * 2);
  padding: 10px 12px;
  background: var(--panel);
  box-shadow:
    0 0 0 var(--p) var(--line),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 3) calc(var(--p) * 3) 0 calc(var(--p) * 2) var(--shadow);
}
.hero:hover,
.hero:focus-visible {
  transform: translate(calc(var(--p) * -1), calc(var(--p) * -2));
  box-shadow:
    0 0 0 var(--p) var(--amber),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 5) calc(var(--p) * 6) 0 calc(var(--p) * 2) var(--shadow);
  outline: none;
}
.hero .cur { width: 0; overflow: hidden; color: var(--amber); font-size: 10px; flex-shrink: 0; }
.hero:hover .cur { width: 12px; animation: px-blink 0.8s steps(1) infinite; }
.hero:hover .text-fg { color: var(--amber); }
.stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.stats span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 64px;
  padding: 2px 6px;
  background: var(--panel-lo);
  color: var(--faint);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}

/* 物品格 */
.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: var(--p);
  padding: 8px;
  background: var(--panel);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    calc(var(--p) * 2) calc(var(--p) * 2) 0 0 var(--shadow);
}
.item:hover,
.item:focus-visible {
  background: var(--panel-hi);
  box-shadow:
    0 0 0 var(--p) var(--amber),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 2) calc(var(--p) * 2) 0 0 var(--shadow);
  outline: none;
}
.slot {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  background: var(--deep);
  color: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.item:hover .slot { color: var(--fg); }
</style>
