<script setup lang="ts">
/** 用户主页 · 配方分栏。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import RecipeCard from "@/components/RecipeCard.vue";

type RecipePage = components["schemas"]["RecipeListOutputBody"];

const route = useRoute();
const api = useApi();
const handle = computed(() => String(route.params.handle ?? ""));

const { data: recipes } = useQuery({
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
  <div v-if="(recipes?.items ?? []).length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <RecipeCard v-for="r in recipes?.items ?? []" :key="r.id" :recipe="r" />
  </div>
  <p v-else class="py-10 text-center text-sm text-muted-foreground">还没有发布配方</p>
</template>