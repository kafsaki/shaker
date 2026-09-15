<script setup lang="ts">
/** 原料百科首页：14 品类导航（ADR-009）+ 搜索 + 分页浏览。 */
import { useInfiniteQuery } from "@tanstack/vue-query";
import { Search } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import { CATEGORY_ZH } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Ingredient = components["schemas"]["IngredientBody"];
type Page = components["schemas"]["IngredientListOutputBody"];

useHead({ title: "原料百科 · Shaker" });

const api = useApi();
const route = useRoute();
const router = useRouter();

const category = ref<string>((route.query.category as string) || "");
const q = ref("");
const debouncedQ = ref("");

let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});

watch([category, debouncedQ], () => {
  router.replace({
    query: category.value ? { category: category.value } : {},
  });
});

const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: computed(
      () => ["ingredients", category.value, debouncedQ.value] as const,
    ),
    queryFn: async ({ pageParam }): Promise<Page> => {
      const { data, error } = await api.GET("/api/v1/ingredients", {
        params: {
          query: {
            category: category.value || undefined,
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
      <h1 class="text-xl font-bold">原料百科</h1>
      <div class="relative max-w-sm">
        <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="q" placeholder="搜原料名 / 别名…" class="pl-8" />
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          class="rounded-full border px-3 py-1 text-xs transition-colors"
          :class="
            category === ''
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:bg-accent'
          "
          @click="category = ''"
        >
          全部
        </button>
        <button
          v-for="(zh, c) in CATEGORY_ZH"
          :key="c"
          class="rounded-full border px-3 py-1 text-xs transition-colors"
          :class="
            category === c
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:bg-accent'
          "
          @click="category = c"
        >
          {{ zh }}
        </button>
      </div>
    </div>

    <div v-if="isLoading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 9" :key="i" class="h-20 rounded-xl" />
    </div>

    <p v-else-if="items.length === 0" class="py-12 text-center text-sm text-muted-foreground">
      没有匹配的原料
    </p>

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="i in items"
          :key="i.id"
          :to="`/ingredients/${i.id}`"
          class="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-medium">{{ i.nameZh }}</span>
            <span
              class="inline-block size-3 shrink-0 rounded-full border border-border"
              :style="{ background: (i.viz as { color?: string } | undefined)?.color ?? 'transparent' }"
            />
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-muted-foreground">{{ i.nameEn }}</span>
            <Badge variant="secondary" class="text-[10px]">
              {{ CATEGORY_ZH[i.category] ?? i.category }}
            </Badge>
          </div>
        </NuxtLink>
      </div>

      <div v-if="hasNextPage" class="flex justify-center">
        <Button variant="outline" :disabled="isFetchingNextPage" @click="fetchNextPage()">
          {{ isFetchingNextPage ? "加载中…" : "加载更多" }}
        </Button>
      </div>
    </template>
  </div>
</template>
