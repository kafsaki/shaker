<script setup lang="ts">
/** 用户主页 · 关注分栏（名册）。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";

type UserPage = components["schemas"]["UserListOutputBody"];

const route = useRoute();
const api = useApi();
const handle = computed(() => String(route.params.handle ?? ""));

const { data: following, isLoading } = useQuery({
  queryKey: computed(() => ["user-following", handle.value] as const),
  queryFn: async (): Promise<UserPage> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/following", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
});
</script>

<template>
  <ProfileRoster
    title="关注名册"
    icon="users"
    :users="following?.items ?? []"
    :loading="isLoading"
    empty-text="还没有关注任何人"
  />
</template>
