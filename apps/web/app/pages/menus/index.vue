<script setup lang="ts">
/**
 * 酒单广场（像酒馆门口的告示板）：
 * - 官方精选：seed 里策划的主题酒单（新手入门排第一），卡片网格；
 * - 玩家酒单：公开酒单按「热门」（收藏数）/「最新」排；登录后多一个「我收藏的」页签。
 * 精选不进玩家流（服务端已排除），避免同一份酒单出现两次。页签写进 ?tab=，刷新与分享不丢。
 */
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import type { SegItem } from "@/components/px/Segmented.vue";

type Page = components["schemas"]["MenuListOutputBody"];

const route = useRoute();
const router = useRouter();
const api = useApi();
const auth = useAuthStore();
const { pickCovers } = useCover();

const { data: featured, isLoading: featuredLoading } = useQuery({
  queryKey: ["menus-featured"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/menus/featured");
    if (error) throw error;
    return data.items ?? [];
  },
});

type Tab = "hot" | "new" | "saved";
const TABS = computed<SegItem[]>(() => [
  { value: "hot", label: "热门", icon: "fire" },
  { value: "new", label: "最新", icon: "sparkle" },
  ...(auth.isAuthenticated ? [{ value: "saved", label: "我收藏的", icon: "bookmark" as const }] : []),
]);
function toTab(v: unknown): Tab {
  return v === "new" || (v === "saved" && auth.isAuthenticated) ? v : "hot";
}
const tab = computed<string>({
  get: () => toTab(route.query.tab),
  set: (v) => void router.replace({ query: { ...route.query, tab: v === "hot" ? undefined : v } }),
});

const list = useInfiniteQuery({
  queryKey: computed(() => ["menus-plaza", tab.value] as const),
  queryFn: async ({ pageParam }): Promise<Page> => {
    const cursor = pageParam || undefined;
    if (tab.value === "saved") {
      const { data, error } = await api.GET("/api/v1/me/saved-menus", {
        params: { query: { cursor, limit: 20 } },
      });
      if (error) throw error;
      return data;
    }
    const { data, error } = await api.GET("/api/v1/menus", {
      params: { query: { sort: tab.value === "new" ? "new" : "hot", cursor, limit: 20 } },
    });
    if (error) throw error;
    return data;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});
const menus = computed(() => list.data.value?.pages.flatMap((p) => p.items ?? []) ?? []);

useHead({ title: "酒单广场 · Shaker" });
</script>

<template>
  <div class="flex flex-col gap-8">
    <!-- 告示板抬头 -->
    <header class="board px-stripes">
      <div class="flex min-w-0 items-center gap-4">
        <span class="emblem" aria-hidden="true"><PxIcon name="list" :scale="4" /></span>
        <div class="min-w-0">
          <p class="font-logo text-[8px] tracking-[0.3em] text-amber">MENU PLAZA</p>
          <h1 class="text-2xl text-fg text-shadow-px">酒单广场</h1>
          <p class="text-dim">官方策划的主题酒单，和玩家公开分享的私藏清单。收藏一份，或复制到自己名下慢慢改。</p>
        </div>
      </div>
      <PxButton v-if="auth.user" icon="folder" :to="`/u/${auth.user.handle}/menus`">我的酒单</PxButton>
    </header>

    <!-- 官方精选 -->
    <section class="flex flex-col gap-3" aria-labelledby="featured-h">
      <h2 id="featured-h" class="flex items-center gap-2 text-dim">
        <PxIcon name="crown" :scale="2" class="text-gold" />
        官方精选
      </h2>
      <div v-if="featuredLoading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PxSkeleton v-for="i in 3" :key="i" class="h-40" />
      </div>
      <div v-else-if="featured?.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="(m, i) in featured"
          :key="m.id"
          :to="`/menus/${m.id}`"
          class="tile"
          :class="{ first: i === 0 }"
        >
          <span v-if="i === 0" class="ribbon">新手推荐</span>
          <MenuCoverStack :covers="pickCovers(m.coverUrls, m.coverUrlsLight)" class="w-24 shrink-0" />
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="title truncate text-lg text-fg text-shadow-px">
              <span class="cur" aria-hidden="true">▶</span>{{ m.title }}
            </span>
            <span class="flex flex-wrap items-center gap-1">
              <PxBadge tone="amber" icon="martini"><span class="font-logo text-[8px]">{{ m.itemCount }}</span> 杯</PxBadge>
              <PxBadge v-if="m.saveCount" icon="bookmark"><span class="font-logo text-[8px]">{{ m.saveCount }}</span></PxBadge>
              <PxBadge v-if="m.viewerSaved" tone="green" icon="check">已收藏</PxBadge>
            </span>
            <span v-if="m.description" class="line-clamp-3 text-dim">{{ m.description }}</span>
          </span>
        </NuxtLink>
      </div>
    </section>

    <!-- 玩家酒单 -->
    <section class="flex flex-col gap-4" aria-label="玩家酒单">
      <PxSegmented v-model="tab" variant="tabs" :items="TABS" class="w-full !flex-nowrap sm:w-auto" />

      <div v-if="list.isLoading.value" class="flex flex-col gap-4">
        <PxSkeleton v-for="i in 2" :key="i" class="h-56" />
      </div>
      <PxEmpty v-else-if="list.isError.value && !menus.length" icon="warn" tone="red" :title="apiErrorMessage(list.error.value)" />
      <PxEmpty
        v-else-if="!menus.length"
        :icon="tab === 'saved' ? 'bookmark-o' : 'list'"
        :title="tab === 'saved' ? '还没有收藏的酒单。在酒单页点「收藏」，它就会出现在这里。' : '还没有玩家公开酒单。把自己的酒单设为公开，就会贴到这面墙上。'"
      >
        <PxButton v-if="auth.user && tab !== 'saved'" icon="folder" :to="`/u/${auth.user.handle}/menus`">去我的酒单</PxButton>
      </PxEmpty>

      <template v-else>
        <div class="flex flex-col gap-4">
          <MenuRow v-for="m in menus" :key="m.id" :menu="m" />
        </div>
        <InfiniteLoader
          :has-next-page="list.hasNextPage.value"
          :is-fetching-next-page="list.isFetchingNextPage.value"
          :error="list.isError.value"
          ended-text="THE END"
          @load="list.fetchNextPage()"
        />
      </template>
    </section>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  margin: calc(var(--p) * 2);
  background-color: var(--panel);
  --stripe: color-mix(in srgb, var(--amber) 7%, transparent);
  box-shadow:
    0 0 0 var(--p) var(--amber),
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
  color: var(--amber);
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}

/* 精选卡：告示板上钉着的一张卡；悬停抬起 */
.tile {
  position: relative;
  display: flex;
  min-width: 0; /* 网格项默认 min-width:auto，长描述会把单列撑出屏幕 */
  gap: 12px;
  padding: 12px;
  margin: var(--p);
  background: var(--panel);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    calc(var(--p) * 2) calc(var(--p) * 2) 0 0 var(--shadow);
  transition: translate 0.1s steps(2);
}
.tile:hover { translate: 0 calc(var(--p) * -1); }
.tile.first {
  box-shadow:
    0 0 0 var(--p) var(--gold),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    calc(var(--p) * 3) calc(var(--p) * 3) 0 0 var(--shadow);
}
.ribbon {
  position: absolute;
  right: -4px;
  top: -8px;
  z-index: 1;
  padding: 2px 8px;
  background: var(--gold);
  color: var(--on-accent);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.title .cur {
  display: inline-block;
  width: 0;
  overflow: hidden;
  color: var(--amber);
  font-size: 12px;
  vertical-align: middle;
}
.tile:hover .title { color: var(--amber); }
.tile:hover .title .cur { width: 18px; animation: px-blink 0.8s steps(1) infinite; }
</style>
