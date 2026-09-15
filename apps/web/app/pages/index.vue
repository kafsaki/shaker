<script setup lang="ts">
import { useInfiniteQuery } from "@tanstack/vue-query";
import { Flame, Sparkles, Users } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import RecipeCard from "@/components/RecipeCard.vue";
import { Button } from "@/components/ui/button";
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

const enabled = computed(
  () => tab.value !== "following" || auth.isAuthenticated,
);

const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
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
    enabled,
  });

const items = computed(() => data.value?.pages.flatMap((p) => p.items ?? []) ?? []);
</script>

<template>
  <div class="flex flex-col gap-5">
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

    <p v-if="tab === 'following' && !auth.isAuthenticated" class="py-16 text-center text-sm text-muted-foreground">
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
      这里还空空如也。
    </p>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RecipeCard v-for="r in items" :key="r.id" :recipe="r" />
      </div>

      <div v-if="hasNextPage" class="flex justify-center py-2">
        <Button
          variant="outline"
          :disabled="isFetchingNextPage"
          @click="fetchNextPage()"
        >
          {{ isFetchingNextPage ? "加载中…" : "加载更多" }}
        </Button>
      </div>
      <p v-else class="pb-4 text-center text-xs text-muted-foreground">到底了</p>
    </template>
  </div>
</template>
