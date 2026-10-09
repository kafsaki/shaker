<script setup lang="ts">
import { useInfiniteQuery } from "@tanstack/vue-query";
import { Flame, Search, Sparkles, Users } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import InfiniteLoader from "@/components/InfiniteLoader.vue";
import RecipeCard from "@/components/RecipeCard.vue";
import RecipeFilterBar from "@/components/RecipeFilterBar.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  defaultFilter,
  filterKey,
  filterToParams,
  isFilterActive,
  type RecipeFilterState,
} from "@/lib/recipe-filter";

type FeedPage = components["schemas"]["FeedOutputBody"];

useHead({ title: "探索 · Shaker" });

const auth = useAuthStore();
const api = useApi();
const route = useRoute();
const router = useRouter();

const tab = ref<string>((route.query.tab as string) || "hot");
watch(tab, (t) => {
  router.replace({ query: t === "hot" ? {} : { tab: t } });
});

const hotWindow = ref("7d");
const windows = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "all", label: "全部" },
];

// 页内搜索：关键词作为 Feed 的过滤条件（服务端过滤 + 游标分页），
// 因此 热门/最新/关注 与时间范围在搜索时照常生效。
const q = ref("");
const debouncedQ = ref("");
let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});
const searching = computed(() => debouncedQ.value !== "");

// 筛选：与搜索结果页同一套组件、同一套后端谓词（Feed 与 /search 共用 filterConds）。
// 探索页用 Tab 表达热度/时间，所以这里的 sort 不参与请求。
const filter = ref<RecipeFilterState>(defaultFilter());
const hasFilters = computed(() => isFilterActive(filter.value));

const feedEnabled = computed(
  () => tab.value !== "following" || auth.isAuthenticated,
);

const feedQuery = useInfiniteQuery({
  queryKey: computed(
    () =>
      [
        "feed",
        String(tab.value),
        hotWindow.value,
        debouncedQ.value,
        filterKey(filter.value),
      ] as const,
  ),
  queryFn: async ({ pageParam }): Promise<FeedPage> => {
    const cursor = pageParam || undefined;
    const query = {
      cursor,
      q: debouncedQ.value || undefined,
      ...filterToParams(filter.value),
    };
    if (tab.value === "new") {
      const { data, error } = await api.GET("/api/v1/feed/new", { params: { query } });
      if (error) throw error;
      return data;
    }
    if (tab.value === "following") {
      const { data, error } = await api.GET("/api/v1/feed/following", { params: { query } });
      if (error) throw error;
      return data;
    }
    const { data, error } = await api.GET("/api/v1/feed/hot", {
      params: { query: { ...query, window: hotWindow.value as "24h" } },
    });
    if (error) throw error;
    return data;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: feedEnabled,
});

const items = computed(() => feedQuery.data.value?.pages.flatMap((p) => p.items ?? []) ?? []);

const isLoading = computed(() => feedQuery.isLoading.value);
const isError = computed(() => feedQuery.isError.value);
const error = computed(() => feedQuery.error.value);
const hasNextPage = computed(() => feedQuery.hasNextPage.value);
const isFetchingNextPage = computed(() => feedQuery.isFetchingNextPage.value);

function loadMore(): void {
  void feedQuery.fetchNextPage();
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 酒馆招牌（未登录访客可见）：旋转光束 + 像素标题 + 闪烁光标 -->
    <section
      v-if="!auth.isAuthenticated"
      class="relative overflow-hidden rounded-sm border-2 border-border bg-card p-6 pixel-shadow sm:p-8"
    >
      <div
        class="tavern-rays animate-rays-spin pointer-events-none absolute -left-20 -top-20 size-[400px] opacity-[0.06] dark:opacity-[0.1]"
        aria-hidden="true"
      />
      <p class="font-pixel text-[10px] uppercase tracking-widest text-primary">
        ★ Welcome to Shaker ★
      </p>
      <h1 class="mt-3 text-2xl font-bold sm:text-3xl">
        像素酒馆营业中<span class="animate-cursor-blink text-primary">▌</span>
      </h1>
      <p class="mt-2 max-w-xl text-sm text-muted-foreground">
        收录 IBA 经典配方与社区创作，每一杯都有可播放的调酒动画。
        看一杯酒的社区共识落点，或者写下你自己的版本。
      </p>
      <div class="mt-4 flex gap-2">
        <Button as-child size="sm">
          <NuxtLink to="/register">进店看看</NuxtLink>
        </Button>
        <Button as-child size="sm" variant="outline">
          <NuxtLink to="/classics">翻经典酒谱</NuxtLink>
        </Button>
      </div>
    </section>

    <!-- 页内搜索：关键词作用于当前这条流（热门/最新/关注 + 时间范围照常生效） -->
    <div class="relative max-w-sm">
      <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="q" placeholder="在当前流里搜配方名…" class="pl-8" />
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Tabs :model-value="tab" @update:model-value="tab = String($event)">
        <TabsList>
          <TabsTrigger value="hot" class="gap-1.5">
            <Flame class="size-3.5" /> 热门
          </TabsTrigger>
          <TabsTrigger value="new" class="gap-1.5">
            <Sparkles class="size-3.5" /> 最新
          </TabsTrigger>
          <TabsTrigger value="following" class="gap-1.5">
            <Users class="size-3.5" /> 关注
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Select v-if="tab === 'hot'" v-model="hotWindow">
        <SelectTrigger class="h-9 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="w in windows" :key="w.value" :value="w.value">
            {{ w.label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <h1 class="sr-only">探索</h1>
    </div>

    <!-- 配方筛选（与搜索结果页共用同一组件） -->
    <RecipeFilterBar v-model="filter" />

    <p
      v-if="tab === 'following' && !auth.isAuthenticated"
      class="py-16 text-center text-sm text-muted-foreground"
    >
      登录后可以看到你关注的调酒师的动态。
      <NuxtLink to="/login" class="text-primary underline-offset-4 hover:underline">去登录</NuxtLink>
    </p>

    <div v-else-if="isLoading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="aspect-[4/5] rounded-xl" />
    </div>

    <p v-else-if="isError" class="py-16 text-center text-sm text-destructive">
      {{ apiErrorMessage(error) }}
    </p>

    <p v-else-if="items.length === 0" class="py-16 text-center text-sm text-muted-foreground">
      {{ searching || hasFilters ? "没有匹配的配方，试试换个关键词或清除筛选。" : "这里还空空如也。" }}
    </p>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RecipeCard v-for="r in items" :key="r.id" :recipe="r" />
      </div>

      <InfiniteLoader
        :has-next-page="hasNextPage"
        :is-fetching-next-page="isFetchingNextPage"
        :error="isError"
        @load="loadMore()"
      />
    </template>
  </div>
</template>
