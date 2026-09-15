<script setup lang="ts">
/** 用户主页：资料 + 配方/酒单/关注/粉丝。 */
import { useQuery } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import RecipeCard from "@/components/RecipeCard.vue";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PubUser = components["schemas"]["PublicUserBody"];
type RecipePage = components["schemas"]["RecipeListOutputBody"];
type MenuPage = components["schemas"]["MenuListOutputBody"];
type UserPage = components["schemas"]["UserListOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const handle = computed(() => String(route.params.handle ?? ""));
const tab = ref((route.query.tab as string) || "recipes");

const { data: user, error, isLoading } = useQuery({
  queryKey: computed(() => ["user", handle.value] as const),
  queryFn: async (): Promise<PubUser> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
});

const { data: recipes } = useQuery({
  queryKey: computed(() => ["user-recipes", handle.value] as const),
  queryFn: async (): Promise<RecipePage> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/recipes", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
});

const { data: menus } = useQuery({
  queryKey: computed(() => ["user-menus", handle.value] as const),
  queryFn: async (): Promise<MenuPage> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/menus", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
});

const followersTab = computed(() => tab.value === "followers");
const followingTab = computed(() => tab.value === "following");

const { data: followers } = useQuery({
  queryKey: computed(() => ["user-followers", handle.value] as const),
  queryFn: async (): Promise<UserPage> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/followers", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
  enabled: followersTab,
});

const { data: following } = useQuery({
  queryKey: computed(() => ["user-following", handle.value] as const),
  queryFn: async (): Promise<UserPage> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/following", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
  enabled: followingTab,
});

const isSelf = computed(() => auth.user?.handle === handle.value);
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

useHead(() => ({ title: `${user.value?.displayName ?? handle.value} · Shaker` }));

const menuVis: Record<string, string> = {
  public: "公开",
  unlisted: "不列出",
  private: "私密",
};
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-4">
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
      <Button
        v-if="!isSelf"
        :variant="followingNow ? 'outline' : 'default'"
        :disabled="followPending"
        @click="toggleFollow()"
      >
        {{ followingNow ? "已关注" : "关注" }}
      </Button>
    </div>

    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="recipes">配方</TabsTrigger>
        <TabsTrigger value="menus">酒单</TabsTrigger>
        <TabsTrigger value="followers">粉丝</TabsTrigger>
        <TabsTrigger value="following">关注</TabsTrigger>
      </TabsList>

      <TabsContent value="recipes" class="mt-4">
        <div v-if="(recipes?.items ?? []).length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RecipeCard v-for="r in recipes?.items ?? []" :key="r.id" :recipe="r" />
        </div>
        <p v-else class="py-10 text-center text-sm text-muted-foreground">还没有发布配方</p>
      </TabsContent>

      <TabsContent value="menus" class="mt-4">
        <div v-if="(menus?.items ?? []).length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NuxtLink
            v-for="m in menus?.items ?? []"
            :key="m.id"
            :to="m.visibility === 'unlisted' && m.shareToken ? `/menus/shared/${m.shareToken}` : `/menus/${m.id}`"
            class="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <span class="font-medium">{{ m.title }}</span>
            <span class="text-xs text-muted-foreground">
              {{ m.itemCount }} 杯 · {{ menuVis[m.visibility] ?? m.visibility }}
            </span>
          </NuxtLink>
        </div>
        <p v-else class="py-10 text-center text-sm text-muted-foreground">
          {{ isSelf ? "还没有酒单" : "没有公开酒单" }}
        </p>
      </TabsContent>

      <TabsContent value="followers" class="mt-4">
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
      </TabsContent>

      <TabsContent value="following" class="mt-4">
        <Card><CardContent class="flex flex-col divide-y divide-border">
          <NuxtLink
            v-for="u in following?.items ?? []"
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
          <p v-if="(following?.items ?? []).length === 0" class="py-8 text-center text-sm text-muted-foreground">
            还没有关注任何人
          </p>
        </CardContent></Card>
      </TabsContent>
    </Tabs>
  </div>
</template>
