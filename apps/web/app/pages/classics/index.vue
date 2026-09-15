<script setup lang="ts">
/** 经典列表：IBA 徽章 / 家族筛选。 */
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { FAMILY_ZH, IBA_ZH } from "@/lib/labels";
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

type Page = components["schemas"]["RecipeListOutputBody"];

useHead({ title: "经典 · Shaker" });

const api = useApi();
const iba = ref("");
const family = ref("");

const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: computed(() => ["classics", iba.value, family.value] as const),
    queryFn: async ({ pageParam }): Promise<Page> => {
      const { data, error } = await api.GET("/api/v1/classics", {
        params: {
          query: {
            ibaCategory:
              (iba.value || undefined) as "unforgettable" | undefined,
            family: family.value || undefined,
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
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-bold">经典配方</h1>
      <Select v-model="iba">
        <SelectTrigger class="h-9 w-40"><SelectValue placeholder="IBA 分档" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">全部 IBA 分档</SelectItem>
          <SelectItem v-for="(zh, c) in IBA_ZH" :key="c" :value="c">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="family">
        <SelectTrigger class="h-9 w-36"><SelectValue placeholder="家族" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">全部家族</SelectItem>
          <SelectItem v-for="(zh, f) in FAMILY_ZH" :key="f" :value="f">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="isLoading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="aspect-[4/5] rounded-xl" />
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="r in items"
          :key="r.id"
          :to="`/classics/${r.classicKey}`"
          class="contents"
        >
          <RecipeCard :recipe="r" />
        </NuxtLink>
      </div>
      <p v-if="items.length === 0" class="py-12 text-center text-sm text-muted-foreground">
        没有匹配的经典
      </p>
      <div v-if="hasNextPage" class="flex justify-center">
        <Button variant="outline" :disabled="isFetchingNextPage" @click="fetchNextPage()">
          {{ isFetchingNextPage ? "加载中…" : "加载更多" }}
        </Button>
      </div>
    </template>
  </div>
</template>
