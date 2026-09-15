<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-4">
    <h1 class="text-3xl font-bold">Shaker</h1>
    <p class="text-muted-foreground">结构化配方库 + 可视化调酒播放器 + UGC 社区</p>
    <div
      class="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm"
    >
      <span class="inline-block size-2 rounded-full bg-primary" />
      API 状态：{{ apiStatus }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";

// 骨架冒烟：确认 vue-query 插件与 /api 代理链路通了（devProxy → Go API）。
const { data, isError } = useQuery({
  queryKey: ["smoke", "vocab"],
  queryFn: async (): Promise<{ ingredients: unknown[] }> => {
    const res = await fetch("/api/v1/vocab");
    if (!res.ok) throw new Error(`vocab ${res.status}`);
    return (await res.json()) as { ingredients: unknown[] };
  },
  retry: 1,
  staleTime: 60_000,
});

const apiStatus = computed(() =>
  isError.value
    ? "无法连接"
    : data.value === undefined
      ? "连接中…"
      : `正常（${data.value.ingredients.length} 个原料）`,
);
useHead({ title: "Shaker · 调酒社区" });
</script>
