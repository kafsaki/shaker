<script setup lang="ts">
/** 分享链接页（unlisted 酒单）。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type MenuDetail = components["schemas"]["MenuDetailOutputBody"];

const route = useRoute();
const api = useApi();
const token = computed(() => String(route.params.token ?? ""));

const { data: detail, isLoading, error } = useQuery({
  queryKey: computed(() => ["menu-shared", token.value] as const),
  queryFn: async (): Promise<MenuDetail> => {
    const { data, error } = await api.GET("/api/v1/menus/shared/{shareToken}", {
      params: { path: { shareToken: token.value } },
    });
    if (error) throw error;
    return data;
  },
});

const menu = computed(() => detail.value?.menu);
const items = computed(() => detail.value?.items ?? []);

useHead(() => ({ title: `${menu.value?.title ?? "分享的酒单"} · Shaker` }));
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-4">
    <Skeleton class="h-12 w-2/3" />
    <Skeleton class="h-56 w-full" />
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>
      {{ apiErrorMessage(error) }} —— 分享链接可能已失效或被轮换。
    </AlertDescription>
  </Alert>

  <div v-else-if="menu" class="flex flex-col gap-5">
    <div>
      <h1 class="flex flex-wrap items-center gap-2 text-xl font-bold">
        {{ menu.title }}
        <Badge variant="secondary">分享的酒单</Badge>
      </h1>
      <p v-if="menu.description" class="mt-1 text-sm text-muted-foreground">
        {{ menu.description }}
      </p>
      <p class="mt-0.5 text-xs text-muted-foreground">{{ menu.itemCount }} 杯</p>
    </div>

    <Card v-if="items.length">
      <CardContent class="flex flex-col divide-y divide-border">
        <div
          v-for="it in items"
          :key="it.recipe.id"
          class="flex items-center gap-3 py-3"
          :class="it.recipe.deleted && 'opacity-50'"
        >
          <div class="min-w-0 flex-1">
            <template v-if="it.recipe.deleted">
              <span class="truncate font-medium line-through">{{ it.recipe.title }}</span>
              <Badge variant="outline" class="ml-2 align-middle text-[11px]">配方已删除</Badge>
            </template>
            <NuxtLink
              v-else
              :to="`/r/${it.recipe.code}`"
              class="truncate font-medium underline-offset-4 hover:underline"
            >
              {{ it.recipe.title }}
            </NuxtLink>
            <p v-if="it.note" class="truncate text-xs text-muted-foreground">{{ it.note }}</p>
            <p v-if="!it.recipe.deleted" class="text-xs text-muted-foreground">
              {{ it.recipe.likeCount }} 赞 · {{ it.recipe.commentCount }} 评论
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <p v-else class="py-16 text-center text-sm text-muted-foreground">酒单是空的</p>
  </div>
</template>
