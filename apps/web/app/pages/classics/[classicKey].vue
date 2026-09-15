<script setup lang="ts">
/** 经典条目：权威配方 + 社区变体 + 规格分布图（IR 白拿的产品亮点，ADR-013）。
 *  hero 用琥珀金档案氛围 + 衬线大字，与 /r/{code} 的 UGC 页一眼可辨。 */
import { useQuery } from "@tanstack/vue-query";
import { Plus } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import type { RecipeIR } from "@shaker/recipe-ir/core";
import RecipeCard from "@/components/RecipeCard.vue";
import RecipeDetail from "@/components/RecipeDetail.vue";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FAMILY_ZH, IBA_ZH, METHOD_ZH } from "@/lib/labels";

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

// hero 摘要需要分布数据（变体数 / ABV 中位 / 迷你区间条），始终加载
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
});

useHead(() => ({ title: `${canonical.value?.title ?? key.value} · Shaker` }));

const ir = computed(() => canonical.value?.ir as RecipeIR | undefined);

/** hero 摘要的 ABV：优先社区中位，无变体时退回权威条目自己的估计。 */
const abv = computed(() => dist.value?.abvEst?.median ?? canonical.value?.abvEst ?? null);

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

/** hero 迷你共识：用量中位前 3 的原料。 */
const heroDistRows = computed(() => distRows.value.slice(0, 3));

/** hero「查看完整分布」：切 Tab 并平滑滚到分布区。 */
async function goDistribution(): Promise<void> {
  tab.value = "distribution";
  await nextTick();
  document
    .getElementById("classic-tabs")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-6">
    <Skeleton class="h-44 w-full rounded-2xl" />
    <div class="grid items-start gap-8 lg:grid-cols-[400px_minmax(0,1fr)]">
      <Skeleton class="aspect-[400/520] w-full rounded-xl" />
      <div class="flex flex-col gap-4">
        <Skeleton class="h-6 w-1/2" />
        <Skeleton class="h-40 w-full rounded-xl" />
      </div>
    </div>
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>{{ apiErrorMessage(error) }}</AlertDescription>
  </Alert>

  <div v-else-if="canonical" class="flex flex-col gap-6">
    <!-- 经典档案 hero：琥珀金 + 衬线大字，首屏即传达「这是一杯有社区共识的经典」 -->
    <section
      class="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-50 to-transparent p-6 sm:p-8 dark:border-amber-400/20 dark:from-amber-950/40"
    >
      <p
        class="text-xs font-medium uppercase tracking-[0.35em] text-amber-700 dark:text-amber-400"
      >
        Shaker 经典档案
      </p>
      <h1 class="mt-3 font-classic text-4xl font-bold leading-tight sm:text-5xl">
        {{ canonical.title }}
      </h1>
      <p v-if="canonical.subtitle" class="mt-2 text-sm text-muted-foreground">
        {{ canonical.subtitle }}
      </p>

      <!-- IBA 分档（琥珀）· 家族 · 做法 -->
      <div class="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge
          v-if="canonical.ibaCategory && IBA_ZH[canonical.ibaCategory]"
          class="border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
        >
          IBA · {{ IBA_ZH[canonical.ibaCategory] }}
        </Badge>
        <Badge v-if="canonical.family && FAMILY_ZH[canonical.family]" variant="secondary">
          {{ FAMILY_ZH[canonical.family] }}
        </Badge>
        <Badge v-if="ir && METHOD_ZH[ir.method]" variant="secondary">
          {{ METHOD_ZH[ir.method] }}
        </Badge>
      </div>

      <p
        class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
      >
        <span>{{ dist?.variantCount ?? 0 }} 个社区变体</span>
        <span v-if="abv !== null">ABV 中位 {{ abv.toFixed(1) }}%</span>
        <span v-if="canonical.difficulty">
          难度 {{ "★".repeat(canonical.difficulty) }}
        </span>
      </p>

      <!-- 迷你共识分布：主原料用量中位前 3 的 p10~p90 区间 -->
      <div v-if="heroDistRows.length" class="mt-5 flex max-w-md flex-col gap-2">
        <div v-for="r in heroDistRows" :key="r.id" class="flex flex-col gap-1">
          <div class="flex items-baseline justify-between gap-3 text-xs">
            <span class="truncate">{{ r.name }}</span>
            <span class="shrink-0 tabular-nums text-muted-foreground">
              {{ r.median?.toFixed(1) }} ml
            </span>
          </div>
          <div class="relative h-2 rounded-full bg-secondary">
            <div
              class="absolute inset-y-0 rounded-full bg-amber-500/40"
              :style="{ left: `${r.left}%`, width: `${Math.max(r.width, 1)}%` }"
            />
            <div
              class="absolute inset-y-[-2px] w-0.5 rounded bg-amber-600"
              :style="{ left: `${r.medianLeft}%` }"
            />
          </div>
        </div>
        <button
          class="mt-1 self-start text-xs text-amber-700 underline-offset-4 hover:underline dark:text-amber-400"
          @click="goDistribution"
        >
          查看完整分布 ↓
        </button>
      </div>

      <!-- 从经典进入创作：编辑器据此自动关联 classicKey + derivedFrom，
           发布后就会出现在下面的「社区变体」里 -->
      <Button as-child class="mt-6 bg-amber-600 text-white hover:bg-amber-700">
        <NuxtLink :to="`/editor/new?classicKey=${key}&derivedFrom=${canonical.id}`">
          <Plus class="size-4" /> 创作我的版本
        </NuxtLink>
      </Button>
    </section>

    <!-- 权威配方本体（动画 + 原料 + 步骤；标题与徽章由 hero 承载） -->
    <RecipeDetail :recipe="canonical" hide-header />

    <!-- 变体 / 分布 -->
    <div id="classic-tabs">
      <Tabs v-model="tab">
        <TabsList>
          <TabsTrigger value="variants">
            社区变体（{{ dist?.variantCount ?? 0 }}）
          </TabsTrigger>
          <TabsTrigger value="distribution">规格分布</TabsTrigger>
        </TabsList>

        <TabsContent value="variants" class="mt-4">
          <div
            v-if="(variants?.items ?? []).length"
            class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <RecipeCard v-for="r in variants?.items ?? []" :key="r.id" :recipe="r" />
          </div>
          <p v-else class="py-10 text-center text-sm text-muted-foreground">
            还没有社区变体 —— 点上面的
            <span class="text-foreground">「创作我的版本」</span>
            写下第一个。
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
  </div>
</template>
