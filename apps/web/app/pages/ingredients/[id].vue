<script setup lang="ts">
/** 物品详情（原料）：大号物品格 + 说明 + 物性属性格 + 反查「用到它的配方」（需求 1）。 */
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { CATEGORY_ZH } from "@/lib/labels";
import { fmtTime } from "@/lib/wiki";

type Detail = components["schemas"]["IngredientDetailBody"];
type SearchOut = components["schemas"]["SearchOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
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
// PxSegmented 的 v-model 是 string，这里收窄回排序类型
const sortModel = computed({
  get: () => sort.value,
  set: (v: string) => (sort.value = v === "new" ? "new" : "hot"),
});
const SORTS = [
  { value: "hot", label: "热门", icon: "fire" as const },
  { value: "new", label: "最新", icon: "sparkle" as const },
];

// 反查「用到它的配方」：文档 §2.2 的 /ingredients/:id/recipes 端点后端未实现，
// 用 /search?type=recipe&ingredient= 等价替代（数据同源：recipe_ingredients 投影，
// 筛选条件与 hot/new 排序一致）。接上游标分页，避免高频原料被首页上限截断。
const {
  data: recipePages,
  isLoading: recipesLoading,
  isError: recipesError,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: computed(() => ["ingredient-recipes", id.value, sort.value] as const),
  queryFn: async ({ pageParam }): Promise<SearchOut> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          type: "recipe",
          ingredient: [id.value],
          sort: sort.value,
          limit: 24,
          cursor: pageParam || undefined,
        },
      },
    });
    if (error) throw error;
    return data;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.recipes?.nextCursor ?? undefined,
});

const recipes = computed(
  () => recipePages.value?.pages.flatMap((p) => p.recipes?.items ?? []) ?? [],
);

useHead(() => ({ title: `${ing.value?.nameZh ?? id.value} · Shaker` }));

const viz = computed(() => ing.value?.viz as Record<string, unknown> | undefined);
const color = computed(() => (viz.value?.color as string | undefined) ?? null);
const viscosity = computed(() => String(viz.value?.viscosity ?? "—"));
const texture = computed(() => String(viz.value?.texture ?? "—"));

/** 物性属性格：数值走 font-logo 读数；密度没有就不显示这一格。 */
const stats = computed(() => {
  const out = [
    { key: "viscosity", label: "粘度", en: "VISCOSITY", value: viscosity.value },
    { key: "texture", label: "质地", en: "TEXTURE", value: texture.value },
  ];
  if (ing.value?.density) out.push({ key: "density", label: "密度", en: "DENSITY", value: `${ing.value.density} g/ml` });
  return out;
});
</script>

<template>
  <div>
    <div v-if="isLoading" class="flex flex-col gap-6">
      <div class="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <PxSkeleton class="aspect-square w-full max-w-[200px]" />
        <div class="flex flex-col gap-3">
          <PxSkeleton class="h-8 w-64" />
          <PxSkeleton class="h-32 w-full" />
        </div>
      </div>
      <PxSkeleton class="h-64 w-full" />
    </div>

    <PxEmpty v-else-if="error" icon="warn" tone="red" :title="apiErrorMessage(error)">
      <PxButton icon="bottle" to="/ingredients">回原料库</PxButton>
    </PxEmpty>

    <div v-else-if="ing" class="flex flex-col gap-8">
      <NuxtLink to="/ingredients" class="flex w-fit items-center gap-1 text-dim hover:text-amber">
        <PxIcon name="chevron-left" :scale="1" />原料库
        <template v-if="CATEGORY_ZH[ing.category]">
          <span class="text-faint">/</span>
          <span>{{ CATEGORY_ZH[ing.category] }}</span>
        </template>
      </NuxtLink>

      <section class="grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <!-- 左：物品格 + 色票 -->
        <div class="flex flex-col items-center gap-3 md:items-stretch">
          <div class="frame">
            <IngredientSlot :category="ing.category" :color="color" :scale="8" :size="180" />
          </div>
          <div class="chip">
            <span class="swatch" :style="color ? { background: color } : undefined" />
            <span class="font-logo text-[8px] uppercase text-dim">{{ color ?? "NO COLOR" }}</span>
          </div>
        </div>

        <!-- 右：名牌 + 说明 -->
        <div class="flex min-w-0 flex-col gap-4">
          <div>
            <p class="font-logo text-[8px] tracking-[0.3em] text-amber">ITEM</p>
            <h1 class="text-2xl text-fg text-shadow-px">{{ ing.nameZh }}</h1>
            <p class="text-faint">{{ ing.nameEn }}</p>
          </div>

          <div class="flex flex-wrap items-center gap-1">
            <NuxtLink :to="`/ingredients?category=${ing.category}`" class="hover:brightness-125">
              <PxBadge tone="amber" variant="solid">{{ CATEGORY_ZH[ing.category] ?? ing.category }}</PxBadge>
            </NuxtLink>
            <PxBadge v-if="ing.subcategory">{{ ing.subcategory }}</PxBadge>
            <PxBadge v-if="ing.abv" tone="pink" icon="fire">{{ ing.abv }}% ABV</PxBadge>
            <PxBadge v-if="ing.recipeCount" tone="cyan" icon="martini">{{ ing.recipeCount }} 个配方</PxBadge>
          </div>

          <PxPanel v-if="ing.descriptionZh || ing.descriptionEn" title="物品说明" icon="book" tone="plain" variant="inset">
            <p v-if="ing.descriptionZh" class="whitespace-pre-wrap leading-[2] text-fg">{{ ing.descriptionZh }}</p>
            <p v-if="ing.descriptionEn" class="mt-2 whitespace-pre-wrap text-faint">{{ ing.descriptionEn }}</p>
          </PxPanel>
          <NuxtLink v-else-if="auth.isEditor" :to="`/wiki/ingredients/${ing.id}`" class="empty-desc">
            <PxIcon name="pencil" :scale="2" class="text-amber" />
            <span>这件物品还没有说明，来写第一段</span>
          </NuxtLink>

          <!-- 百科条目（ADR-027）：编辑可直接修订，所有人都能翻修订历史 -->
          <div class="flex flex-wrap items-center gap-2">
            <PxButton v-if="auth.isEditor" size="sm" icon="pencil" :to="`/wiki/ingredients/${ing.id}`">编辑词条</PxButton>
            <PxButton size="sm" variant="ghost" icon="clock" :to="`/wiki/history/ingredient/${ing.id}`">修订历史</PxButton>
            <span v-if="ing.wikiVersion" class="text-faint">
              已修订 {{ ing.wikiVersion }} 次<template v-if="ing.wikiEditedAt"> · {{ fmtTime(ing.wikiEditedAt) }}</template>
            </span>
          </div>

          <p v-if="(ing.aliases ?? []).length" class="flex flex-wrap items-center gap-x-2 text-faint">
            <span>又名</span>
            <span v-for="a in ing.aliases ?? []" :key="a" class="alias">{{ a }}</span>
          </p>
        </div>
      </section>

      <!-- 物性 -->
      <PxPanel title="物性" icon="drop" tone="cyan">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div v-for="s in stats" :key="s.key" class="stat">
            <span class="flex items-baseline justify-between gap-2">
              <span class="text-faint">{{ s.label }}</span>
              <span class="font-logo text-[8px] text-faint">{{ s.en }}</span>
            </span>
            <span class="val">{{ s.value }}</span>
          </div>
        </div>
      </PxPanel>

      <!-- 用到它的配方 -->
      <section class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="flex items-center gap-2 text-fg">
            <PxIcon name="martini" :scale="2" class="text-amber" />用到它的配方
          </h2>
          <PxSegmented v-model="sortModel" :items="SORTS" size="sm" />
        </div>

        <div v-if="recipesLoading" class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <PxSkeleton v-for="i in 4" :key="i" class="aspect-[3/4]" />
        </div>
        <PxEmpty v-else-if="recipesError && recipes.length === 0" icon="warn" tone="red" title="配方列表加载失败" />
        <PxEmpty v-else-if="recipes.length === 0" icon="martini" title="还没有配方用到它。" />
        <div v-else class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <RecipeCard v-for="r in recipes" :key="r.id" :recipe="r" />
        </div>
        <InfiniteLoader
          :has-next-page="hasNextPage"
          :is-fetching-next-page="isFetchingNextPage"
          :error="recipesError"
          ended-text=""
          @load="fetchNextPage()"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 物品格外再套一圈金框：详情页里它是「当前查看的物品」 */
.frame {
  padding: 8px;
  margin: calc(var(--p) * 2);
  background: var(--panel);
  box-shadow:
    0 0 0 var(--p) var(--gold),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 4) calc(var(--p) * 4) 0 calc(var(--p) * 2) var(--shadow);
}
.chip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 196px;
  padding: 6px 8px;
  margin: var(--p) calc(var(--p) * 2);
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.swatch {
  flex-shrink: 0;
  width: 24px;
  height: 16px;
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.25);
}
.alias {
  padding: 0 6px;
  background: var(--panel-lo);
  color: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--line);
}
/* 编辑看到的空说明：虚线框邀请补写 */
.empty-desc {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  color: var(--dim);
  outline: var(--p) dashed var(--line);
  outline-offset: calc(var(--p) * -1);
}
.empty-desc:hover {
  color: var(--amber);
  outline-color: var(--amber);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.stat .val {
  font-family: var(--font-logo);
  font-size: 16px;
  line-height: 24px;
  color: var(--cyan);
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
</style>
