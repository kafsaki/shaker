<script setup lang="ts">
/**
 * 酒馆大厅：酒保对白（打字机 + 分支选项）+ 今日特调 + 酒单墙（热门 / 最新 / 关注）。
 * 「随便来一杯」从热门流里抽一杯直接端上来。
 * 页内搜索与筛选都是 Feed 的服务端过滤条件，热门/最新/关注与时间窗照常生效。
 */
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { toast } from "@/lib/toast";
import {
  ABV_MAX,
  VOLUME_MAX,
  defaultFilter,
  filterKey,
  filterToParams,
  isFilterActive,
  type RecipeFilterState,
} from "@/lib/recipe-filter";

type FeedPage = components["schemas"]["FeedOutputBody"];
type FeedCard = components["schemas"]["FeedCard"];

useHead({ title: "酒馆 · Shaker" });

const auth = useAuthStore();
const api = useApi();
const route = useRoute();
const router = useRouter();

/* ── 酒保对白 ── */
function greeting(): string {
  const h = new Date().getHours();
  const time = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  const name = auth.user?.displayName;
  const lines = name
    ? [
        `${time}，${name}。老位置给你留着呢。今晚想喝点什么？`,
        `${time}，${name}。吧台刚擦干净——要不要露一手，调一杯新的？`,
      ]
    : [
        `${time}，欢迎光临 Shaker。这里每一杯酒都会在吧台上演一遍——经典的、热门的，还是你自己来？`,
        `${time}，旅人。第一次来？墙上那本图鉴收着 IBA 的经典，随便翻。`,
      ];
  return lines[Math.floor(Math.random() * lines.length)]!;
}
const line = ref("");
onMounted(() => (line.value = greeting()));

/* ── 今日特调：全时段最热的一杯 ── */
const { data: special } = useQuery({
  queryKey: ["feed", "special"] as const,
  queryFn: async (): Promise<FeedCard | null> => {
    const { data, error } = await api.GET("/api/v1/feed/hot", {
      params: { query: { window: "7d", limit: 1 } },
    });
    if (error) throw error;
    if (data.items?.[0]) return data.items[0];
    const all = await api.GET("/api/v1/feed/hot", { params: { query: { window: "all", limit: 1 } } });
    return all.data?.items?.[0] ?? null;
  },
  staleTime: 5 * 60_000,
});

const rolling = ref(false);
async function randomDrink(): Promise<void> {
  rolling.value = true;
  try {
    const { data, error } = await api.GET("/api/v1/feed/hot", {
      params: { query: { window: "all", limit: 40 } },
    });
    if (error) throw error;
    const pool = data.items ?? [];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick) {
      toast.info("吧台今天空空的，先去图鉴里看看吧");
      return;
    }
    toast.success(`酒保推荐：${pick.title}`);
    await router.push(
      pick.isCanonical && pick.classicKey ? `/classics/${pick.classicKey}` : `/r/${pick.code}`,
    );
  } catch (err) {
    toast.error(apiErrorMessage(err));
  } finally {
    rolling.value = false;
  }
}

/* ── 酒单墙 ── */
const tab = ref<string>((route.query.tab as string) || "hot");
watch(tab, (t) => {
  void router.replace({ query: t === "hot" ? {} : { tab: t } });
});
const TABS = [
  { value: "hot", label: "热门", icon: "fire" as const },
  { value: "new", label: "最新", icon: "sparkle" as const },
  { value: "following", label: "关注", icon: "users" as const },
];
const hotWindow = ref("all");
const WINDOWS = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "ALL" },
];

const q = ref("");
const debouncedQ = ref("");
let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});
const searching = computed(() => debouncedQ.value !== "");

const filter = ref<RecipeFilterState>(defaultFilter());
const hasFilters = computed(() => isFilterActive(filter.value));
const showFilter = ref(false);
/** 生效的筛选维度数（按钮上的小角标）。 */
const filterCount = computed(() => {
  const f = filter.value;
  return (
    (f.family !== "all" ? 1 : 0) +
    (f.method !== "all" ? 1 : 0) +
    (f.glass !== "all" ? 1 : 0) +
    (f.origin ? 1 : 0) +
    (f.tags.length ? 1 : 0) +
    (f.abvMin > 0 || f.abvMax < ABV_MAX ? 1 : 0) +
    (f.volumeMin > 0 || f.volumeMax < VOLUME_MAX ? 1 : 0) +
    (f.difficultyMax > 0 ? 1 : 0)
  );
});

const feedEnabled = computed(() => tab.value !== "following" || auth.isAuthenticated);

const feedQuery = useInfiniteQuery({
  queryKey: computed(
    () => ["feed", String(tab.value), hotWindow.value, debouncedQ.value, filterKey(filter.value)] as const,
  ),
  queryFn: async ({ pageParam }): Promise<FeedPage> => {
    const query = {
      cursor: pageParam || undefined,
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
</script>

<template>
  <div class="flex flex-col gap-10">
    <h1 class="sr-only">酒馆大厅</h1>

    <!-- 吧台：酒保对白 + 今日特调 -->
    <section class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <BarScene>
        <PxDialogue v-if="line" speaker="酒保 · 摇摇" :text="line">
          <template #choices>
          <PxButton variant="primary" icon="dice" :loading="rolling" sfx="coin" @click="randomDrink()">
            随便来一杯
          </PxButton>
          <PxButton icon="book" to="/classics">翻翻经典图鉴</PxButton>
          <PxButton v-if="auth.isAuthenticated" icon="shaker" to="/editor/new">我自己调一杯</PxButton>
          <PxButton v-else variant="accent" icon="play" to="/register" sfx="start">开始新游戏</PxButton>
          </template>
        </PxDialogue>
        <div v-else class="h-28" />
      </BarScene>

      <div v-if="special" class="hidden flex-col gap-2 lg:flex">
        <p class="flex items-center gap-2 text-amber">
          <PxIcon name="trophy" :scale="2" />
          <span class="font-logo text-[8px] tracking-[0.2em]">TODAY'S SPECIAL</span>
        </p>
        <RecipeCard :recipe="special" />
      </div>
    </section>

    <!-- 酒单墙 -->
    <section class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <PxSegmented v-model="tab" variant="tabs" :items="TABS" class="min-w-0 flex-1" />
        <PxSegmented v-if="tab === 'hot'" v-model="hotWindow" :items="WINDOWS" size="sm" />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <PxInput v-model="q" icon="search" placeholder="在当前流里搜配方名…" class="w-full max-w-sm" />
        <PxButton
          icon="filter"
          :active="showFilter"
          :aria-expanded="showFilter"
          @click="showFilter = !showFilter"
        >
          筛选<span v-if="filterCount" class="font-logo text-[8px] text-amber">×{{ filterCount }}</span>
        </PxButton>
      </div>
      <RecipeFilterBar v-if="showFilter" v-model="filter" class="animate-pop-in" />

      <PxEmpty v-if="tab === 'following' && !auth.isAuthenticated" icon="users" title="登录后能看到你关注的调酒师的新作。">
        <PxButton variant="primary" icon="play" to="/login">读取存档</PxButton>
      </PxEmpty>

      <div v-else-if="feedQuery.isLoading.value" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <PxSkeleton v-for="i in 8" :key="i" class="aspect-[3/4]" />
      </div>

      <PxEmpty v-else-if="feedQuery.isError.value" icon="warn" tone="red" :title="apiErrorMessage(feedQuery.error.value)" />

      <PxEmpty
        v-else-if="items.length === 0"
        icon="martini"
        :title="searching || hasFilters ? '没有匹配的配方，换个关键词或清掉筛选试试。' : '这面墙还空着。'"
      />

      <template v-else>
        <div class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <RecipeCard v-for="r in items" :key="r.id" :recipe="r" />
        </div>
        <InfiniteLoader
          :has-next-page="feedQuery.hasNextPage.value"
          :is-fetching-next-page="feedQuery.isFetchingNextPage.value"
          :error="feedQuery.isError.value"
          @load="feedQuery.fetchNextPage()"
        />
      </template>
    </section>
  </div>
</template>
