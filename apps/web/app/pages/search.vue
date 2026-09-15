<script setup lang="ts">
/** 搜索：分组结果（配方/用户/原料）+ 多维筛选。 */
import { useQuery } from "@tanstack/vue-query";
import { Search } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import { FAMILY_ZH, METHOD_ZH } from "@/lib/labels";
import RecipeCard from "@/components/RecipeCard.vue";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type SearchOut = components["schemas"]["SearchOutputBody"];

const route = useRoute();
const router = useRouter();
const api = useApi();
const vocab = useVocabStore();

useHead({ title: "搜索 · Shaker" });

const q = ref((route.query.q as string) || "");
const family = ref((route.query.family as string) || "");
const method = ref((route.query.method as string) || "");
const glass = ref((route.query.glass as string) || "");
const submitted = ref((route.query.q as string) || "");
const searched = ref(Boolean(submitted.value));

function submit(): void {
  submitted.value = q.value.trim();
  searched.value = true;
  router.replace({
    query: {
      ...(submitted.value ? { q: submitted.value } : {}),
      ...(family.value ? { family: family.value } : {}),
      ...(method.value ? { method: method.value } : {}),
      ...(glass.value ? { glass: glass.value } : {}),
    },
  });
}

watch([family, method, glass], () => searched.value && submit());

const { data, isLoading, isFetching } = useQuery({
  queryKey: computed(
    () =>
      ["search", submitted.value, family.value, method.value, glass.value] as const,
  ),
  queryFn: async (): Promise<SearchOut> => {
    const { data, error } = await api.GET("/api/v1/search", {
      params: {
        query: {
          q: submitted.value || undefined,
          type: "all",
          family: family.value || undefined,
          method: method.value || undefined,
          glass: glass.value || undefined,
        },
      },
    });
    if (error) throw error;
    return data;
  },
  enabled: searched,
});

onMounted(() => {
  void vocab.ensure().catch(() => {});
});

const recipes = computed(() => data.value?.recipes?.items ?? []);
const users = computed(() => data.value?.users?.items ?? []);
const ingredients = computed(() => data.value?.ingredients?.items ?? []);
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-5">
    <form class="flex gap-2" @submit.prevent="submit()">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="q" placeholder="搜配方 / 用户 / 原料…" class="pl-9" autofocus />
      </div>
      <Button type="submit" :disabled="isFetching">搜索</Button>
    </form>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <Select v-model="family">
        <SelectTrigger class="h-8 w-32 text-xs"><SelectValue placeholder="家族" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">全部家族</SelectItem>
          <SelectItem v-for="(zh, f) in FAMILY_ZH" :key="f" :value="f">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="method">
        <SelectTrigger class="h-8 w-32 text-xs"><SelectValue placeholder="手法" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">全部手法</SelectItem>
          <SelectItem v-for="(zh, m) in METHOD_ZH" :key="m" :value="m">{{ zh }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="glass">
        <SelectTrigger class="h-8 w-32 text-xs"><SelectValue placeholder="杯型" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">全部杯型</SelectItem>
          <SelectItem v-for="g in vocab.glassware" :key="g.id" :value="g.id">
            {{ g.nameZh }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="isLoading" class="flex flex-col gap-3">
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-full" />
    </div>

    <template v-else-if="data">
      <!-- 配方 -->
      <section v-if="recipes.length" class="flex flex-col gap-2">
        <h2 class="text-sm font-medium text-muted-foreground">
          配方（{{ data.recipes?.total ?? recipes.length }}）
        </h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <RecipeCard v-for="r in recipes" :key="r.id" :recipe="r" />
        </div>
      </section>

      <!-- 用户 -->
      <section v-if="users.length" class="flex flex-col gap-2">
        <h2 class="text-sm font-medium text-muted-foreground">用户</h2>
        <NuxtLink
          v-for="u in users"
          :key="u.id"
          :to="`/u/${u.handle}`"
          class="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
        >
          <Avatar class="size-10">
            <AvatarImage v-if="u.avatarUrl" :src="u.avatarUrl" />
            <AvatarFallback>{{ u.displayName.slice(0, 1) }}</AvatarFallback>
          </Avatar>
          <div class="min-w-0">
            <div class="font-medium">{{ u.displayName }} <span class="text-xs text-muted-foreground">@{{ u.handle }}</span></div>
            <div class="text-xs text-muted-foreground">{{ u.recipeCount }} 个配方 · {{ u.followerCount }} 粉丝</div>
          </div>
        </NuxtLink>
      </section>

      <!-- 原料 -->
      <section v-if="ingredients.length" class="flex flex-col gap-2">
        <h2 class="text-sm font-medium text-muted-foreground">原料</h2>
        <div class="flex flex-wrap gap-2">
          <NuxtLink
            v-for="i in ingredients"
            :key="i.id"
            :to="`/ingredients/${i.id}`"
            class="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            {{ i.nameZh }}
            <span class="text-xs text-muted-foreground">{{ i.nameEn }}</span>
          </NuxtLink>
        </div>
      </section>

      <p
        v-if="!recipes.length && !users.length && !ingredients.length"
        class="py-12 text-center text-sm text-muted-foreground"
      >
        没有找到相关内容
      </p>
    </template>

    <p v-else-if="!searched" class="py-12 text-center text-sm text-muted-foreground">
      输入关键词开始搜索，比如 <Badge variant="secondary">Daiquiri</Badge> 或 <Badge variant="secondary">朗姆</Badge>
    </p>
  </div>
</template>
