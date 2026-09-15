<script setup lang="ts">
/** 经典条目：权威配方 + 社区变体 + 规格分布图（IR 白拿的产品亮点，ADR-013）。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import RecipeCard from "@/components/RecipeCard.vue";
import RecipeDetail from "@/components/RecipeDetail.vue";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Recipe = components["schemas"]["RecipeBody"];
type Dist = components["schemas"]["DistributionOutputBody"];
type VariantPage = components["schemas"]["RecipeListOutputBody"];

const route = useRoute();
const api = useApi();
const vocab = useVocabStore();
const key = computed(() => String(route.params.classicKey ?? ""));
const tab = ref("variants");

// 权威条目不带 viz，RecipeDetail 回退到全量词表编译动画
onMounted(() => void vocab.ensure().catch(() => {}));

const { data: canonical, isLoading, error } = useQuery({
  queryKey: computed(() => ["classic", key.value] as const),
  queryFn: async (): Promise<Recipe> => {
    const { data, error } = await api.GET("/api/v1/classics/{classicKey}", {
      params: { path: { classicKey: key.value } },
    });
    if (error) throw error;
    return data;
  },
});

const { data: variants } = useQuery({
  queryKey: computed(() => ["classic-variants", key.value] as const),
  queryFn: async (): Promise<VariantPage> => {
    const { data, error } = await api.GET(
      "/api/v1/classics/{classicKey}/variants",
      { params: { path: { classicKey: key.value }, query: { sort: "hot" } } },
    );
    if (error) throw error;
    return data;
  },
  enabled: computed(() => tab.value === "variants"),
});

const { data: dist } = useQuery({
  queryKey: computed(() => ["classic-dist", key.value] as const),
  queryFn: async (): Promise<Dist> => {
    const { data, error } = await api.GET(
      "/api/v1/classics/{classicKey}/distribution",
      { params: { path: { classicKey: key.value } } },
    );
    if (error) throw error;
    return data;
  },
  enabled: computed(() => tab.value === "distribution"),
});

useHead(() => ({ title: `${canonical.value?.title ?? key.value} · Shaker` }));

/** 分布图行：名字 + p10~p90 区间条 + median 刻度。 */
const distRows = computed(() => {
  const ings = dist.value?.ingredients ?? [];
  const maxP90 = Math.max(1, ...ings.map((i) => i.amountMl.p90 ?? 0));
  return ings
    .slice()
    .sort((a, b) => (b.amountMl.median ?? 0) - (a.amountMl.median ?? 0))
    .map((i) => {
      const m = vocab.ingMap.get(i.ingredientId);
      return {
        id: i.ingredientId,
        name: m ? `${m.nameZh}` : i.ingredientId,
        role: i.role,
        presentIn: i.presentIn,
        variantCount: dist.value?.variantCount ?? 1,
        p10: i.amountMl.p10,
        p25: i.amountMl.p25,
        median: i.amountMl.median,
        p75: i.amountMl.p75,
        p90: i.amountMl.p90,
        left: ((i.amountMl.p10 ?? 0) / maxP90) * 100,
        width: (((i.amountMl.p90 ?? 0) - (i.amountMl.p10 ?? 0)) / maxP90) * 100,
        medianLeft: ((i.amountMl.median ?? 0) / maxP90) * 100,
      };
    });
});
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-4">
    <Skeleton class="h-8 w-1/2" />
    <Skeleton class="aspect-[400/520] w-96 rounded-xl" />
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>{{ apiErrorMessage(error) }}</AlertDescription>
  </Alert>

  <div v-else-if="canonical" class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="flex items-center gap-2 text-xl font-bold">
        经典：{{ canonical.title }}
        <Badge class="border-primary/40 bg-primary/10 text-primary">权威条目</Badge>
      </h1>
    </div>

    <!-- 权威配方本体（动画 + 原料 + 步骤） -->
    <RecipeDetail :recipe="canonical" />

    <!-- 变体 / 分布 -->
    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="variants">社区变体（{{ (variants?.items ?? []).length }}）</TabsTrigger>
        <TabsTrigger value="distribution">规格分布</TabsTrigger>
      </TabsList>

      <TabsContent value="variants" class="mt-4">
        <div v-if="(variants?.items ?? []).length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RecipeCard v-for="r in variants?.items ?? []" :key="r.id" :recipe="r" />
        </div>
        <p v-else class="py-10 text-center text-sm text-muted-foreground">
          还没有社区变体 —— 去
          <NuxtLink to="/editor/new" class="text-primary underline-offset-4 hover:underline">创作</NuxtLink>
          你的版本。
        </p>
      </TabsContent>

      <TabsContent value="distribution" class="mt-4">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">社区共识落点</CardTitle>
            <CardDescription>
              {{ dist?.variantCount ?? 0 }} 个变体的用量分布（p10~p90 区间，刻度线为中位数）
              —— 看看你的配方偏甜还是偏酸。
            </CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-4">
            <div v-for="r in distRows" :key="r.id" class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-3 text-sm">
                <span class="truncate">{{ r.name }}</span>
                <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                  中位 {{ r.median?.toFixed(1) }} ml · {{ r.presentIn }}/{{ r.variantCount }} 变体在用
                </span>
              </div>
              <div class="relative h-3 rounded-full bg-secondary">
                <div
                  class="absolute inset-y-0 rounded-full bg-primary/40"
                  :style="{ left: `${r.left}%`, width: `${Math.max(r.width, 1)}%` }"
                />
                <div
                  class="absolute inset-y-[-2px] w-0.5 rounded bg-primary"
                  :style="{ left: `${r.medianLeft}%` }"
                />
              </div>
            </div>

            <div v-if="dist?.abvEst?.median" class="text-sm text-muted-foreground">
              ABV 估计：中位 {{ dist.abvEst.median.toFixed(1) }}%
              <span v-if="dist.abvEst.p10 !== null && dist.abvEst.p90 !== null">
                （{{ dist.abvEst.p10.toFixed(1) }}% ~ {{ dist.abvEst.p90.toFixed(1) }}%）
              </span>
            </div>

            <p v-if="distRows.length === 0" class="py-6 text-center text-sm text-muted-foreground">
              暂无分布数据
            </p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </div>
</template>
