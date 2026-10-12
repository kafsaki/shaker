<script setup lang="ts">
/** 用户主页 · 配方分栏（收藏卡墙）。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";

type RecipePage = components["schemas"]["RecipeListOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const handle = computed(() => String(route.params.handle ?? ""));
const isSelf = computed(() => auth.user?.handle === handle.value);

const { data: recipes, isLoading } = useQuery({
  queryKey: computed(() => ["user-recipes", handle.value] as const),
  queryFn: async (): Promise<RecipePage> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/recipes", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
});
</script>

<template>
  <div>
    <div v-if="isLoading" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <PxSkeleton v-for="i in 4" :key="i" class="aspect-[3/4]" />
    </div>
    <div v-else-if="(recipes?.items ?? []).length" class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
      <RecipeCard v-for="r in recipes?.items ?? []" :key="r.id" :recipe="r" />
    </div>
    <PxEmpty v-else icon="martini" title="还没有发布配方">
      <PxButton v-if="isSelf" variant="primary" icon="shaker" to="/editor/new">调第一杯</PxButton>
    </PxEmpty>
  </div>
</template>
