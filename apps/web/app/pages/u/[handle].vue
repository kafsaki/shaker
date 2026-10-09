<script setup lang="ts">
/**
 * 用户主页骨架：资料头 + 分栏导航 + 子路由出口。
 * 分栏（配方/酒单/粉丝/关注）是真实子路由，路径 `/u/{handle}/recipes|menus|followers|following`。
 * `/u/{handle}/settings` 是本人专属页，不挂资料头与分栏导航（bare 分支）。
 */
import { useQuery } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { Settings as SettingsIcon } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type PubUser = components["schemas"]["PublicUserBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const handle = computed(() => String(route.params.handle ?? ""));

// 设置页独立成页：精确比对路径，避免 handle 恰为 "settings" 时误判
const bare = computed(() => route.path === `/u/${handle.value}/settings`);

const { data: user, error, isLoading } = useQuery({
  queryKey: computed(() => ["user", handle.value] as const),
  queryFn: async (): Promise<PubUser> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
  enabled: computed(() => !bare.value),
});

const isSelf = computed(() => auth.user?.handle === handle.value);

const tabs = computed(() => [
  { to: `/u/${handle.value}/recipes`, label: "配方" },
  { to: `/u/${handle.value}/menus`, label: "酒单" },
  { to: `/u/${handle.value}/followers`, label: "粉丝" },
  { to: `/u/${handle.value}/following`, label: "关注" },
]);

const followingNow = ref(false);
watch(
  user,
  (u) => {
    followingNow.value = u?.viewerIsFollowing ?? false;
  },
  { immediate: true },
);

const followPending = ref(false);
async function toggleFollow(): Promise<void> {
  if (!auth.isAuthenticated) {
    toast.info("登录后即可关注");
    return;
  }
  followPending.value = true;
  try {
    if (followingNow.value) {
      const { error } = await api.DELETE("/api/v1/users/{handle}/follow", {
        params: { path: { handle: handle.value } },
      });
      if (error) throw error;
      followingNow.value = false;
    } else {
      const { error } = await api.PUT("/api/v1/users/{handle}/follow", {
        params: { path: { handle: handle.value } },
      });
      if (error) throw error;
      followingNow.value = true;
    }
  } catch (err) {
    toast.error(apiErrorMessage(err));
  } finally {
    followPending.value = false;
  }
}

useHead(() => ({
  title: bare.value
    ? "设置 · Shaker"
    : `${user.value?.displayName ?? handle.value} · Shaker`,
}));
</script>

<template>
  <!-- 设置页：全屏，无资料头/分栏 -->
  <NuxtPage v-if="bare" />

  <div v-else-if="isLoading" class="flex flex-col gap-4">
    <Skeleton class="h-28 w-full" />
    <Skeleton class="h-64 w-full" />
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>{{ apiErrorMessage(error) }}</AlertDescription>
  </Alert>

  <div v-else-if="user" class="flex flex-col gap-6">
    <!-- 资料 -->
    <div class="flex flex-wrap items-center gap-4">
      <Avatar class="size-16">
        <AvatarImage v-if="user.avatarUrl" :src="user.avatarUrl" />
        <AvatarFallback class="text-xl">{{ user.displayName.slice(0, 1) }}</AvatarFallback>
      </Avatar>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-xl font-bold">{{ user.displayName }}</h1>
          <span class="text-sm text-muted-foreground">@{{ user.handle }}</span>
          <Badge v-if="user.isOfficial" class="border-primary/40 bg-primary/10 text-primary">官方</Badge>
        </div>
        <p v-if="user.bio" class="mt-1 max-w-xl text-sm text-muted-foreground">{{ user.bio }}</p>
        <p class="mt-1 flex gap-3 text-sm text-muted-foreground">
          <span>{{ user.counts.recipe }} 配方</span>
          <span>{{ user.counts.follower }} 粉丝</span>
          <span>{{ user.counts.following }} 关注</span>
        </p>
      </div>
      <!-- 本人：设置入口（对他人不可见）；他人：关注按钮 -->
      <Button v-if="isSelf" variant="outline" size="sm" as-child>
        <NuxtLink :to="`/u/${handle}/settings`">
          <SettingsIcon class="size-4" /> 设置
        </NuxtLink>
      </Button>
      <Button
        v-else
        :variant="followingNow ? 'outline' : 'default'"
        :disabled="followPending"
        @click="toggleFollow()"
      >
        {{ followingNow ? "已关注" : "关注" }}
      </Button>
    </div>

    <!-- 分栏导航（真实路由） -->
    <nav class="inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-0.75 text-muted-foreground">
      <NuxtLink
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md border border-transparent px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow]"
        :class="route.path.startsWith(t.to)
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'"
      >
        {{ t.label }}
      </NuxtLink>
    </nav>

    <NuxtPage />
  </div>
</template>