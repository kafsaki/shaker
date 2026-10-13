<script setup lang="ts">
/** 用户主页 · 粉丝分栏（名册）。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";

type UserPage = components["schemas"]["UserListOutputBody"];

const route = useRoute();
const api = useApi();
const handle = computed(() => String(route.params.handle ?? ""));

const { data: followers, isLoading } = useQuery({
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
  <ProfileRoster
    title="粉丝名册"
    icon="heart"
    :users="followers?.items ?? []"
    :loading="isLoading"
    empty-text="还没有粉丝"
  />
</template>
