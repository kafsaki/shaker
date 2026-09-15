<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import RecipeDetail from "@/components/RecipeDetail.vue";

const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));

const api = useApi();
const { data, error, isLoading } = useQuery({
  queryKey: computed(() => ["recipe", "id", id.value] as const),
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/recipes/{id}", {
      params: { path: { id: id.value }, query: { expand: "viz" } },
    });
    if (error) throw error;
    return data;
  },
});

useHead(() => ({ title: `${data.value?.title ?? "配方"} · Shaker` }));
</script>

<template>
  <div v-if="isLoading" class="grid gap-8 lg:grid-cols-[400px_minmax(0,1fr)]">
    <Skeleton class="aspect-[400/520] rounded-xl" />
    <div class="flex flex-col gap-4">
      <Skeleton class="h-8 w-2/3" />
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>
      {{ apiErrorMessage(error) }}
      <NuxtLink to="/" class="underline underline-offset-4">回探索页</NuxtLink>
    </AlertDescription>
  </Alert>

  <RecipeDetail v-else-if="data" :recipe="data" />
</template>
