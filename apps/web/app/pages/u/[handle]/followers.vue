<script setup lang="ts">
/** 用户主页 · 粉丝分栏。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";

type UserPage = components["schemas"]["UserListOutputBody"];

const route = useRoute();
const api = useApi();
const handle = computed(() => String(route.params.handle ?? ""));

const { data: followers } = useQuery({
  queryKey: computed(() => ["user-followers", handle.value] as const),
  queryFn: async (): Promise<UserPage> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/followers", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
});
</script>

<template>
  <Card><CardContent class="flex flex-col divide-y divide-border">
    <NuxtLink
      v-for="u in followers?.items ?? []"
      :key="u.id"
      :to="`/u/${u.handle}`"
      class="flex items-center gap-3 py-2.5 transition-colors hover:bg-accent/50"
    >
      <Avatar class="size-9">
        <AvatarImage v-if="u.avatarUrl" :src="u.avatarUrl" />
        <AvatarFallback>{{ u.displayName.slice(0, 1) }}</AvatarFallback>
      </Avatar>
      <div class="font-medium">{{ u.displayName }}</div>
      <div class="text-xs text-muted-foreground">@{{ u.handle }}</div>
    </NuxtLink>
    <p v-if="(followers?.items ?? []).length === 0" class="py-8 text-center text-sm text-muted-foreground">
      还没有粉丝
    </p>
  </CardContent></Card>
</template>