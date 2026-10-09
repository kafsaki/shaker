<script setup lang="ts">
/**
 * 搜索结果页（B 站式）：顶部搜索框 + 「配方 / 原料 / 酒单 / 用户」Tab 切换。
 * 各 Tab 独立游标分页（useInfiniteQuery），且只在激活时请求。
 * 配方 Tab 额外提供标签、家族、手法、杯型与排序筛选。
 */
import { useInfiniteQuery } from "@tanstack/vue-query";
import { Search } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import { CATEGORY_ZH } from "@/lib/labels";
import InfiniteLoader from "@/components/InfiniteLoader.vue";
import MenuCoverStack from "@/components/MenuCoverStack.vue";
import RecipeCard from "@/components/RecipeCard.vue";
import RecipeFilterBar from "@/components/RecipeFilterBar.vue";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type SearchOut = components["schemas"]["SearchOutputBody"];

const TABS = [
  { key: "recipe", label: "配方" },
  { key: "ingredient", label: "原料" },
  { key: "menu", label: "酒单" },
  { key: "user", label: "用户" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const route = useRoute();
const router = useRouter();
const api = useApi();
const { pickCovers } = useCover();

const q = ref((route.query.q as string) ?? "");
const tab = ref<TabKey>(normalizeTab(route.query.type as string));
const submitted = ref((route.query.q as string) ?? "");
const searched = ref(Boolean(submitted.value));

// reka-ui 的 SelectItem 不接受空字符串 value（空串保留给「清除选择」），统一用 all 哨兵
const family = ref((route.query.family as string) || "all");
const method = ref((route.query.method as string) || "all");
const glass = ref((route.query.glass as string) || "all");
const tag = ref((route.query.tag as string) || "");
const sort = ref<"relevance" | "hot" | "new">(
  route.query.sort === "hot" || route.query.sort === "new" ? route.query.sort : "relevance",
);

function normalizeTab(v: string | undefined): TabKey {
  return TABS.some((t) => t.key === v) ? (v as TabKey) : "recipe";
}

/** 把当前状态写回地址栏，保证刷新/分享后结果可复现。 */
function syncQuery(): void {
  router.replace({
    query: {
      ...(submitted.value ? { q: submitted.value } : {}),
      ...(tab.value !== "recipe" ? { type: tab.value } : {}),
      ...(family.value !== "all" ? { family: family.value } : {}),
      ...(method.value !== "all" ? { method: method.value } : {}),
      ...(glass.value !== "all" ? { glass: glass.value } : {}),
      ...(tag.value ? { tag: tag.value } : {}),
      ...(sort.value !== "relevance" ? { sort: sort.value } : {}),
    },
  });
}

function submit(): void {
  const v = q.value.trim();
  if (!v) return; // 空关键词不触发搜索（本页下面的搜索框同样不允许空值）
  submitted.value = v;
  searched.value = true;
  syncQuery();
}

function switchTab(next: TabKey): void {
  if (next === tab.value) return;
  tab.value = next;
  syncQuery();
}

// 筛选变化即时重查并写回地址栏（下拉/标签点了就走）
watch([family, method, glass, tag], () => searched.value && syncQuery());

/** 各 Tab 独立的无限查询骨架：仅激活的 Tab 发请求。 */
const recipeQuery = useInfiniteQuery({
  queryKey: computed(
    () =>
      [
        "search",
        "recipe",
        submitted.value,
        family.value,
        method.value,
        glass.value,
        tag.value,
        sort.value,
      ] as const,
  ),
  queryFn: async ({ pageParam }): Promise<NonNullable<SearchOut["recipes"]>> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          q: submitted.value || undefined,
          type: "recipe",
          cursor: pageParam || undefined,
          limit: 24,
          family: family.value !== "all" ? family.value : undefined,
          method: method.value !== "all" ? method.value : undefined,
          glass: glass.value !== "all" ? glass.value : undefined,
          tag: tag.value || undefined,
          sort: sort.value,
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

/** 当前 Tab 的中文名（空态文案复用）。 */
const tabLabel = computed(() => TABS.find((t) => t.key === tab.value)?.label ?? "");

/** 是否有生效的筛选（空态文案用）。 */
const hasFilters = computed(
  () =>
    family.value !== "all" ||
    method.value !== "all" ||
    glass.value !== "all" ||
    tag.value !== "" ||
    sort.value !== "relevance",
);

function loadMore(): void {
  void activeQuery.value.fetchNextPage();
}

useHead(() => ({
  title: submitted.value ? `${submitted.value} · 搜索 · Shaker` : "搜索 · Shaker",
}));
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-5">
    <form class="flex gap-2" @submit.prevent="submit()">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="q"
          placeholder="搜配方 / 酒单 / 用户 / 原料…"
          class="pl-9"
          :autofocus="!submitted"
        />
      </div>
      <Button type="submit" :disabled="isFetching">搜索</Button>
    </form>

    <!-- Tab 导航 -->
    <nav class="flex items-center gap-1 border-b-2 border-border">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        class="-mb-0.5 border-b-2 px-4 py-2 text-sm transition-colors"
        :class="
          tab === t.key
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="switchTab(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- 配方筛选（与「探索」页共用同一组件） -->
    <RecipeFilterBar
      v-if="tab === 'recipe'"
      v-model:family="family"
      v-model:method="method"
      v-model:glass="glass"
      v-model:tag="tag"
      v-model:sort="sort"
      show-sort
    />

    <!-- 结果 -->
    <div v-if="isLoading" class="flex flex-col gap-3">
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-full" />
    </div>

    <template v-else-if="searched">
      <!-- 配方 -->
      <div v-if="tab === 'recipe'" class="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <RecipeCard v-for="r in recipes" :key="r.id" :recipe="r" />
      </div>

      <!-- 酒单 -->
      <div v-else-if="tab === 'menu'" class="flex flex-col gap-3">
        <div
          v-for="m in menus"
          :key="m.id"
          class="flex flex-col gap-3 rounded-sm border-2 border-border bg-card p-3 pixel-shadow-sm sm:flex-row"
        >
          <MenuCoverStack
            :covers="pickCovers(m.coverUrls, m.coverUrlsLight)"
            class="w-28 shrink-0 sm:w-36"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <NuxtLink :to="`/menus/${m.id}`" class="truncate font-medium hover:text-primary">
                {{ m.title }}
              </NuxtLink>
              <Badge variant="secondary">{{ m.itemCount }} 杯</Badge>
            </div>
            <NuxtLink
              v-if="m.owner"
              :to="`/u/${m.owner.handle}`"
              class="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Avatar class="size-5">
                <AvatarImage v-if="m.owner.avatarUrl" :src="m.owner.avatarUrl" />
                <AvatarFallback class="text-[10px]">
                  {{ m.owner.displayName.slice(0, 1) }}
                </AvatarFallback>
              </Avatar>
              {{ m.owner.displayName }}
            </NuxtLink>
            <p v-if="m.description" class="line-clamp-2 text-xs text-muted-foreground">
              {{ m.description }}
            </p>
            <div v-if="(m.recipeCards ?? []).length" class="flex gap-2 overflow-x-auto pb-1">
              <RecipeCard
                v-for="c in m.recipeCards"
                :key="c.id"
                :recipe="c"
                class="w-28 shrink-0"
              />
            </div>
            <Button size="sm" variant="outline" as-child class="w-fit">
              <NuxtLink :to="`/menus/${m.id}`">查看酒单</NuxtLink>
            </Button>
          </div>
        </div>
      </div>

      <!-- 用户 -->
      <div v-else-if="tab === 'user'" class="grid gap-3 sm:grid-cols-2">
        <NuxtLink
          v-for="u in users"
          :key="u.id"
          :to="`/u/${u.handle}`"
          class="flex items-center gap-3 rounded-sm border-2 border-border bg-card p-3 transition-all pixel-shadow-sm hover:-translate-y-0.5 hover:border-primary/60"
        >
          <Avatar class="size-11">
            <AvatarImage v-if="u.avatarUrl" :src="u.avatarUrl" />
            <AvatarFallback>{{ u.displayName.slice(0, 1) }}</AvatarFallback>
          </Avatar>
          <div class="min-w-0">
            <div class="truncate font-medium">
              {{ u.displayName }}
              <span class="text-xs text-muted-foreground">@{{ u.handle }}</span>
            </div>
            <div class="text-xs text-muted-foreground">
              {{ u.recipeCount }} 个配方 · {{ u.followerCount }} 粉丝
            </div>
          </div>
        </NuxtLink>
      </div>

      <!-- 原料 -->
      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="g in ingredients"
          :key="g.id"
          :to="`/ingredients/${g.id}`"
          class="flex flex-col gap-2 rounded-sm border-2 border-border bg-card p-3 transition-all pixel-shadow-sm hover:-translate-y-0.5 hover:border-primary/60"
        >
          <div class="flex items-baseline gap-2">
            <span class="truncate font-medium">{{ g.nameZh }}</span>
            <span class="truncate text-xs text-muted-foreground">{{ g.nameEn }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{{ CATEGORY_ZH[g.category] ?? g.category }}</Badge>
            <span v-if="g.abv" class="text-xs text-muted-foreground">{{ g.abv }}% ABV</span>
          </div>
        </NuxtLink>
      </div>

      <p v-if="isEmpty" class="py-12 text-center text-sm text-muted-foreground">
        没有找到相关{{ tabLabel }}{{ tab === "recipe" && hasFilters ? "，试试清除筛选" : "" }}
      </p>

      <InfiniteLoader
        :has-next-page="hasNextPage"
        :is-fetching-next-page="isFetchingNextPage"
        :error="isError"
        :ended-text="!isEmpty ? '到底了' : null"
        @load="loadMore()"
      />
    </template>

    <p v-else class="py-12 text-center text-sm text-muted-foreground">
      输入关键词开始搜索，比如 <Badge variant="secondary">Daiquiri</Badge> 或
      <Badge variant="secondary">朗姆</Badge>
    </p>
  </div>
</template>