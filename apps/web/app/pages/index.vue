<script setup lang="ts">
import { useInfiniteQuery } from "@tanstack/vue-query";
import { Flame, Search, Sparkles, Users } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import InfiniteLoader from "@/components/InfiniteLoader.vue";
import RecipeCard from "@/components/RecipeCard.vue";
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

type FeedPage = components["schemas"]["FeedOutputBody"];
type SearchOut = components["schemas"]["SearchOutputBody"];

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

// 页内搜索：防抖后切到搜索模式（结果就地展示，不跳搜索结果页；与原料百科一致）
const q = ref("");
const debouncedQ = ref("");
let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});
const searching = computed(() => debouncedQ.value !== "");

const feedEnabled = computed(
  () => !searching.value && (tab.value !== "following" || auth.isAuthenticated),
);

const feedQuery = useInfiniteQuery({
  queryKey: computed(() => ["feed", String(tab.value), hotWindow.value] as const),
  queryFn: async ({ pageParam }): Promise<FeedPage> => {
    const cursor = pageParam || undefined;
    if (tab.value === "new") {
      const { data, error } = await api.GET("/api/v1/feed/new", {
        params: { query: { cursor } },
      });
      if (error) throw error;
      return data;
    }
    if (tab.value === "following") {
      const { data, error } = await api.GET("/api/v1/feed/following", {
        params: { query: { cursor } },
      });
      if (error) throw error;
      return data;
    }
    const { data, error } = await api.GET("/api/v1/feed/hot", {
      params: { query: { cursor, window: hotWindow.value as "24h" } },
    });
    if (error) throw error;
    return data;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: feedEnabled,
});

// 搜索模式下复用全局配方搜索（相关度排序），结果在「探索」页内展示
const searchQuery = useInfiniteQuery({
  queryKey: computed(() => ["search", "recipe", debouncedQ.value, "relevance"] as const),
  queryFn: async ({ pageParam }): Promise<NonNullable<SearchOut["recipes"]>> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          q: debouncedQ.value,
          type: "recipe",
          sort: "relevance",
          cursor: pageParam || undefined,
          limit: 24,
        },
      },
    });
    if (error) throw error;
    if (!data.recipes) throw new Error("搜索结果为空");
    return data.recipes;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: computed(() => searching.value),
});

const items = computed(() =>
  searching.value
    ? (searchQuery.data.value?.pages.flatMap((p) => p.items ?? []) ?? [])
    : (feedQuery.data.value?.pages.flatMap((p) => p.items ?? []) ?? []),
);

/** 当前生效的查询：搜索模式取配方搜索，否则取 Feed。 */
const activeQuery = computed(() => (searching.value ? searchQuery : feedQuery));
const isLoading = computed(() => activeQuery.value.isLoading.value);
const isError = computed(() => activeQuery.value.isError.value);
const error = computed(() => activeQuery.value.error.value);
const hasNextPage = computed(() => activeQuery.value.hasNextPage.value);
const isFetchingNextPage = computed(() => activeQuery.value.isFetchingNextPage.value);

function loadMore(): void {
  void activeQuery.value.fetchNextPage();
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

    <!-- 页内搜索：有词时切到配方搜索结果，清空即回到 Feed -->
    <div class="relative max-w-sm">
      <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="q" placeholder="搜配方名…" class="pl-8" />
    </div>

    <div v-if="!searching" class="flex flex-wrap items-center gap-3">
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

    <p
      v-if="!searching && tab === 'following' && !auth.isAuthenticated"
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
      {{ searching ? "没有匹配的配方，试试换个关键词。" : "这里还空空如也。" }}
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
