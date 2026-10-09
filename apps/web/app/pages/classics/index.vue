<script setup lang="ts">
/** 经典列表：IBA 徽章 / 家族筛选 + 页内搜索。 */
import { useInfiniteQuery } from "@tanstack/vue-query";
import { Search } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import { FAMILY_ZH, IBA_ZH } from "@/lib/labels";
import InfiniteLoader from "@/components/InfiniteLoader.vue";
import RecipeCard from "@/components/RecipeCard.vue";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Page = components["schemas"]["RecipeListOutputBody"];

useHead({ title: "经典 · Shaker" });

const api = useApi();
// reka-ui 禁止 SelectItem 用空字符串 value（空串是"清除选择"的保留值），用 all 哨兵
type IbaFilter = "all" | "none" | "unforgettable" | "contemporary" | "new_era";
const iba = ref<IbaFilter>("all");
const family = ref("all");

// 页内搜索：防抖后作为查询条件（与原料百科一致，不进地址栏）
const q = ref("");
const debouncedQ = ref("");
let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});

const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
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
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="flex items-center gap-2 text-xl font-bold">
          <span class="animate-pixel-blink text-primary">★</span>经典配方
        </h1>
        <Select v-model="iba">
          <SelectTrigger class="h-9 w-40"><SelectValue placeholder="IBA 分档" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分档</SelectItem>
            <SelectItem v-for="(zh, c) in IBA_ZH" :key="c" :value="c">{{ zh }}</SelectItem>
            <SelectItem value="none">非 IBA 经典</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="family">
          <SelectTrigger class="h-9 w-36"><SelectValue placeholder="家族" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部家族</SelectItem>
            <SelectItem v-for="(zh, f) in FAMILY_ZH" :key="f" :value="f">{{ zh }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="relative max-w-sm">
        <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="q" placeholder="搜经典配方名…" class="pl-8" />
      </div>
    </div>

    <div v-if="isLoading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="aspect-[4/5] rounded-xl" />
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RecipeCard
          v-for="r in items"
          :key="r.id"
          :recipe="r"
          :to="`/classics/${r.classicKey}`"
        />
      </div>
      <p v-if="items.length === 0" class="py-12 text-center text-sm text-muted-foreground">
        {{ debouncedQ ? "没有匹配的经典，试试换个关键词" : "没有匹配的经典" }}
      </p>
      <InfiniteLoader
        :has-next-page="hasNextPage"
        :is-fetching-next-page="isFetchingNextPage"
        :error="isError"
        @load="fetchNextPage()"
      />
    </template>
  </div>
</template>
