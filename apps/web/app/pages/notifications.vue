<script setup lang="ts">
/** 收件箱：通知列表 + 标读。 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { CheckCheck } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Notice = components["schemas"]["NotificationBody"];

definePageMeta({ middleware: "auth" });
useHead({ title: "通知 · Shaker" });

const api = useApi();
const qc = useQueryClient();

const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: async ({ pageParam }): Promise<Notice[]> => {
      const cursor = pageParam || undefined;
      const { data, error } = await api.GET("/api/v1/notifications", {
        params: { query: { cursor } },
      });
      if (error) throw error;
      return data.items ?? [];
    },
    initialPageParam: "",
    getNextPageParam: (last) =>
      last.length > 0 ? last[last.length - 1]?.id : undefined,
  });

const notices = computed(() => data.value?.pages.flat() ?? []);

const markAll = useMutation({
  mutationFn: async () => {
    const { error } = await api.POST("/api/v1/notifications/read", { body: {} });
    if (error) throw error;
  },
  onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    toast.success("已全部标为已读");
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

const markOne = useMutation({
  mutationFn: async (n: Notice) => {
    const { error } = await api.POST("/api/v1/notifications/read", {
      body: { ids: [n.id] },
    });
    if (error) throw error;
    return n;
  },
  onSuccess: (n) => {
    n.readAt = new Date().toISOString();
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

const TYPE_TEXT: Record<string, string> = {
  like: "赞了你的配方",
  comment: "评论了你的配方",
  reply: "回复了你的评论",
  follow: "关注了你",
  mention: "提及了你",
  system: "系统通知",
};

function targetLink(n: Notice): string | null {
  if (n.entityType === "recipe" && n.entityId) return `/recipes/${n.entityId}`;
  return null;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">通知</h1>
      <Button
        variant="outline"
        size="sm"
        :disabled="markAll.isPending.value"
        @click="markAll.mutate()"
      >
        <CheckCheck class="size-4" /> 全部已读
      </Button>
    </div>

    <div v-if="isLoading" class="flex flex-col gap-2">
      <Skeleton v-for="i in 5" :key="i" class="h-16 w-full" />
    </div>

    <p v-else-if="notices.length === 0" class="py-16 text-center text-sm text-muted-foreground">
      没有通知
    </p>

    <template v-else>
      <Card><CardContent class="flex flex-col divide-y divide-border">
        <component
          :is="targetLink(n) ? 'NuxtLink' : 'div'"
          v-for="n in notices"
          :key="n.id"
          v-bind="targetLink(n) ? { to: targetLink(n)! } : {}"
          class="flex items-center gap-3 py-3 transition-colors hover:bg-accent/50"
          :class="n.readAt ? 'opacity-60' : ''"
          @click="!n.readAt && markOne.mutate(n)"
        >
          <Avatar class="size-9 shrink-0">
            <AvatarFallback>{{ n.actor.displayName.slice(0, 1) }}</AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">
              <span class="font-medium">{{ n.actor.displayName }}</span>
              {{ TYPE_TEXT[n.type] ?? n.type }}
            </p>
            <p class="text-xs text-muted-foreground">{{ fmt(n.createdAt) }}</p>
          </div>
          <span v-if="!n.readAt" class="size-2 shrink-0 rounded-full bg-primary" />
        </component>
      </CardContent></Card>

      <div v-if="hasNextPage" class="flex justify-center">
        <Button variant="outline" :disabled="isFetchingNextPage" @click="fetchNextPage()">
          {{ isFetchingNextPage ? "加载中…" : "更多" }}
        </Button>
      </div>
    </template>
  </div>
</template>
