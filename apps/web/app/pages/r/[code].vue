<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import RecipeDetail from "@/components/RecipeDetail.vue";

const route = useRoute();
const code = computed(() => String(route.params.code ?? ""));

const api = useApi();
const { data, error, isLoading } = useQuery({
  queryKey: computed(() => ["recipe", "code", code.value] as const),
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/r/{code}", {
      params: { path: { code: code.value }, query: { expand: "viz" } },
    });
    if (error) throw error;
    return data;
  },
});

useHead(() => ({ title: `${data.value?.title ?? code.value} · Shaker` }));

/** 经典配方的唯一地址是 /classics/{key}，这里只做收敛（旧链接/外部分享兜底）。 */
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
</script>

<template>
  <div>
    <RecipeSkeleton v-if="isLoading || canonicalKey" />
    <PxEmpty v-else-if="error" icon="warn" tone="red" :title="`${apiErrorMessage(error)} —— 配方可能不存在或已被删除。`">
      <PxButton icon="home" to="/">回酒馆</PxButton>
    </PxEmpty>
    <RecipeDetail v-else-if="data" :recipe="data" />
  </div>
</template>
