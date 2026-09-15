<script setup lang="ts">
/** 原料详情：物理/视觉数据 + 反查「用到它的配方」（需求 1）。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { CATEGORY_ZH } from "@/lib/labels";
import RecipeCard from "@/components/RecipeCard.vue";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Detail = components["schemas"]["IngredientDetailBody"];
type SearchOut = components["schemas"]["SearchOutputBody"];

const route = useRoute();
const api = useApi();
const id = computed(() => String(route.params.id ?? ""));

const { data: ing, error, isLoading } = useQuery({
  queryKey: computed(() => ["ingredient", id.value] as const),
  queryFn: async (): Promise<Detail> => {
    const { data, error } = await api.GET("/api/v1/ingredients/{id}", {
      params: { path: { id: id.value } },
    });
    if (error) throw error;
    return data;
  },
});

const sort = ref<"hot" | "new">("hot");

// 反查「用到它的配方」：文档 §2.2 的 /ingredients/:id/recipes 端点后端未实现，
// 用 /search?type=recipe&ingredient= 等价替代（数据同源：recipe_ingredients 投影）。
const { data: searchOut } = useQuery({
  queryKey: computed(() => ["ingredient-recipes", id.value, sort.value] as const),
  queryFn: async (): Promise<SearchOut> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          type: "recipe",
          ingredient: [id.value],
          sort: sort.value,
          limit: 24,
        },
      },
    });
    if (error) throw error;
    return data;
  },
});

const recipes = computed(() => searchOut.value?.recipes?.items ?? []);

useHead(() => ({ title: `${ing.value?.nameZh ?? id.value} · Shaker` }));

const viz = computed(() => ing.value?.viz as Record<string, unknown> | undefined);
const viscosity = computed(() => String(viz.value?.viscosity ?? "—"));
const texture = computed(() => String(viz.value?.texture ?? "—"));
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-4">
    <Skeleton class="h-10 w-64" />
    <Skeleton class="h-40 w-full" />
    <Skeleton class="h-64 w-full" />
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>
      {{ apiErrorMessage(error) }}
      <NuxtLink to="/ingredients" class="underline underline-offset-4">回百科</NuxtLink>
    </AlertDescription>
  </Alert>

  <div v-else-if="ing" class="flex flex-col gap-6">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-3">
        <span
          class="inline-block size-10 rounded-lg border border-border"
          :style="{ background: (viz as { color?: string } | undefined)?.color ?? 'transparent' }"
        />
        <div>
          <h1 class="text-2xl font-bold">
            {{ ing.nameZh }}
            <span class="text-base font-normal text-muted-foreground">{{ ing.nameEn }}</span>
          </h1>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{{ CATEGORY_ZH[ing.category] ?? ing.category }}</Badge>
            <Badge v-if="ing.subcategory" variant="outline">{{ ing.subcategory }}</Badge>
            <Badge v-if="ing.abv" variant="outline">{{ ing.abv }}% ABV</Badge>
            <Badge v-if="ing.recipeCount" variant="outline">{{ ing.recipeCount }} 个配方</Badge>
          </div>
        </div>
      </div>
      <p
        v-if="ing.descriptionZh"
        class="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
      >
        {{ ing.descriptionZh }}
      </p>
      <p v-if="ing.descriptionEn" class="max-w-2xl text-xs text-muted-foreground/70">
        {{ ing.descriptionEn }}
      </p>
      <p v-if="(ing.aliases ?? []).length" class="text-xs text-muted-foreground">
        又名：{{ (ing.aliases ?? []).join(" · ") }}
      </p>
    </div>

    <Card>
      <CardHeader><CardTitle class="text-base">物性</CardTitle></CardHeader>
      <CardContent class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <span class="text-muted-foreground">粘度</span>：{{ viscosity }}
        </div>
        <div>
          <span class="text-muted-foreground">质地</span>：{{ texture }}
        </div>
        <div v-if="ing.density">
          <span class="text-muted-foreground">密度</span>：{{ ing.density }} g/ml
        </div>
      </CardContent>
    </Card>

    <Separator />

    <div class="flex flex-col gap-3">
      <h2 class="text-base font-medium">用到它的配方</h2>
      <Tabs v-model="sort">
        <TabsList>
          <TabsTrigger value="hot">热门</TabsTrigger>
          <TabsTrigger value="new">最新</TabsTrigger>
        </TabsList>
        <TabsContent value="hot" class="mt-0">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RecipeCard v-for="r in recipes" :key="r.id" :recipe="r" />
          </div>
        </TabsContent>
        <TabsContent value="new" class="mt-0">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RecipeCard v-for="r in recipes" :key="r.id" :recipe="r" />
          </div>
        </TabsContent>
      </Tabs>
      <p
        v-if="recipes.length === 0"
        class="py-8 text-center text-sm text-muted-foreground"
      >
        还没有配方用到它。
      </p>
    </div>
  </div>
</template>
