<script setup lang="ts">
/**
 * 用户主页 · 酒单分栏。
 * 自己与他人同一布局：一个酒单占一整行，行内横向排列配方卡片（RecipeCard），
 * 右侧按钮跳 /menus/{id} 详情页。本人额外可见私密酒单并可新建。
 * 数据源统一 /users/{handle}/menus（本人视角服务端返回全部含私密）。
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { Plus } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import InfiniteLoader from "@/components/InfiniteLoader.vue";
import MenuCoverStack from "@/components/MenuCoverStack.vue";
import RecipeCard from "@/components/RecipeCard.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Page = components["schemas"]["MenuListOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const qc = useQueryClient();
const { pickCovers } = useCover();
const handle = computed(() => String(route.params.handle ?? ""));
const isSelf = computed(() => !!auth.user && auth.user.handle === handle.value);

const VIS_ZH: Record<string, string> = { public: "公开", private: "私密" };

const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: computed(() => ["user-menus", handle.value] as const),
    queryFn: async ({ pageParam }): Promise<Page> => {
      const { data, error } = await api.GET("/api/v1/users/{handle}/menus", {
        params: {
          path: { handle: handle.value },
          query: { cursor: pageParam || undefined, limit: 20 },
        },
      });
      if (error) throw error;
      return data;
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

const menus = computed(() => data.value?.pages.flatMap((p) => p.items ?? []) ?? []);

/* ── 新建（仅本人）── */
const open = ref(false);
const title = ref("");
const visibility = ref<"private" | "public">("private");

const create = useMutation({
  mutationFn: async () => {
    const { data, error } = await api.POST("/api/v1/menus", {
      body: { title: title.value.trim(), visibility: visibility.value },
    });
    if (error) throw error;
    return data;
  },
  onSuccess: (d) => {
    toast.success("酒单已创建");
    title.value = "";
    open.value = false;
    void qc.invalidateQueries({ queryKey: ["user-menus", handle.value] });
    void navigateTo(`/menus/${d.id}`);
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-lg font-bold">{{ isSelf ? "我的酒单" : "酒单" }}</h2>
      <Dialog v-if="isSelf" v-model:open="open">
        <DialogTrigger as-child>
          <Button><Plus class="size-4" /> 新建酒单</Button>
        </DialogTrigger>
        <DialogContent class="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新建酒单</DialogTitle>
            <DialogDescription>把喜欢的配方收进一份酒单</DialogDescription>
          </DialogHeader>
          <form
            class="flex flex-col gap-3"
            @submit.prevent="title.trim() && create.mutate()"
          >
            <div class="flex flex-col gap-1.5">
              <Label for="menu-title">名称</Label>
              <Input id="menu-title" v-model="title" maxlength="60" placeholder="家里能做的十杯" />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label>可见性</Label>
              <Select v-model="visibility">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">私密（仅自己）</SelectItem>
                  <SelectItem value="public">公开</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" :disabled="create.isPending.value || !title.trim()">
              {{ create.isPending.value ? "创建中…" : "创建" }}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>

    <div v-if="isLoading" class="flex flex-col gap-4">
      <Skeleton v-for="i in 2" :key="i" class="h-56 rounded-xl" />
    </div>

    <template v-else>
      <div v-if="menus.length" class="flex flex-col gap-4">
        <Card v-for="m in menus" :key="m.id">
          <CardContent class="flex flex-col gap-4">
            <div class="flex items-start gap-4">
              <MenuCoverStack
                :covers="pickCovers(m.coverUrls, m.coverUrlsLight)"
                class="w-20 shrink-0 sm:w-28"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <h3 class="flex flex-wrap items-center gap-2 font-bold">
                  {{ m.title }}
                  <Badge variant="secondary">{{ VIS_ZH[m.visibility] ?? m.visibility }}</Badge>
                </h3>
                <p v-if="m.description" class="line-clamp-2 text-sm text-muted-foreground">
                  {{ m.description }}
                </p>
                <p class="text-xs text-muted-foreground">{{ m.itemCount }} 杯</p>
              </div>
              <Button variant="outline" size="sm" as-child class="shrink-0">
                <NuxtLink :to="`/menus/${m.id}`">查看酒单</NuxtLink>
              </Button>
            </div>

            <div v-if="(m.recipeCards ?? []).length" class="flex gap-3 overflow-x-auto pb-1">
              <div v-for="c in m.recipeCards ?? []" :key="c.id" class="w-40 shrink-0">
                <RecipeCard :recipe="c" />
              </div>
            </div>
            <p v-else class="text-xs text-muted-foreground">这个酒单还没有配方</p>
          </CardContent>
        </Card>
      </div>

      <p v-else-if="isError" class="py-12 text-center text-sm text-muted-foreground">
        加载失败，请稍后重试
      </p>
      <p v-else class="py-12 text-center text-sm text-muted-foreground">
        {{ isSelf ? "还没有酒单。也可以在配方页点「收藏」直接加入。" : "还没有公开酒单" }}
      </p>

      <InfiniteLoader
        :has-next-page="hasNextPage"
        :is-fetching-next-page="isFetchingNextPage"
        :error="isError"
        :ended-text="menus.length ? '到底了' : null"
        @load="fetchNextPage()"
      />
    </template>
  </div>
</template>