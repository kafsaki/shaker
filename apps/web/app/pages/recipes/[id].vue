<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
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

/** 经典配方的唯一地址是 /classics/{key}，这里只做收敛（通知等按 id 的入口兜底）。 */
const canonicalKey = computed(() =>
  data.value?.isCanonical && data.value.classicKey ? data.value.classicKey : null,
);
watch(
  canonicalKey,
  (k) => {
    if (k) void navigateTo(`/classics/${k}`, { replace: true });
  },
  { immediate: true },
);

useHead(() => ({ title: `${data.value?.title ?? "配方"} · Shaker` }));
</script>

<template>
  <div>
    <RecipeSkeleton v-if="isLoading || canonicalKey" />
    <PxEmpty v-else-if="error" icon="warn" tone="red" :title="apiErrorMessage(error)">
      <PxButton icon="home" to="/">回酒馆</PxButton>
    </PxEmpty>
    <RecipeDetail v-else-if="data" :recipe="data" />
  </div>
</template>
