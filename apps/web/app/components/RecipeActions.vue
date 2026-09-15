<script setup lang="ts">
/**
 * 配方互动条：点赞（幂等 PUT/DELETE）+ 加入酒单弹层
 * （GET /me/menus?containsRecipe= 一次拿到带勾选态的列表）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Bookmark, BookmarkCheck, Heart } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type Recipe = components["schemas"]["RecipeBody"];
type MyMenu = components["schemas"]["MyMenuBody"];

const props = defineProps<{ recipe: Recipe }>();

const auth = useAuthStore();
const api = useApi();
const qc = useQueryClient();

/* ── 点赞 ── */
const liked = ref(props.recipe.viewerState?.liked ?? false);
const likeCount = ref(props.recipe.counts.like);

watch(
  () => props.recipe,
  (r) => {
    liked.value = r.viewerState?.liked ?? false;
    likeCount.value = r.counts.like;
  },
);

const likeMutation = useMutation({
  mutationFn: async (on: boolean) => {
    if (on) {
      const { data, error } = await api.PUT("/api/v1/recipes/{id}/like", {
        params: { path: { id: props.recipe.id } },
      });
      if (error) throw error;
      return data;
    }
    const { data, error } = await api.DELETE("/api/v1/recipes/{id}/like", {
      params: { path: { id: props.recipe.id } },
    });
    if (error) throw error;
    return data;
  },
  onMutate: async (on) => {
    liked.value = on;
    likeCount.value += on ? 1 : -1;
  },
  onError: (err, on) => {
    liked.value = !on;
    likeCount.value += on ? -1 : 1;
    toast.error(apiErrorMessage(err));
  },
  onSuccess: (d) => {
    if (d) likeCount.value = d.like;
  },
});

function toggleLike(): void {
  if (!auth.isAuthenticated) {
    toast.info("登录后即可点赞");
    return;
  }
  likeMutation.mutate(!liked.value);
}

/* ── 加入酒单 ── */
const menuOpen = ref(false);
const newMenuTitle = ref("");

const { data: myMenus } = useQuery({
  queryKey: computed(() => ["my-menus", props.recipe.id] as const),
  queryFn: async (): Promise<MyMenu[]> => {
    const { data, error } = await api.GET("/api/v1/me/menus", {
      params: { query: { containsRecipe: props.recipe.id } },
    });
    if (error) throw error;
    return data.items ?? [];
  },
  enabled: computed(() => menuOpen.value && auth.isAuthenticated),
});

const itemMutation = useMutation({
  mutationFn: async (m: MyMenu) => {
    if (m.containsRecipe) {
      const { error } = await api.DELETE("/api/v1/menus/{id}/items/{recipeId}", {
        params: { path: { id: m.id, recipeId: props.recipe.id } },
      });
      if (error) throw error;
    } else {
      const { error } = await api.PUT("/api/v1/menus/{id}/items/{recipeId}", {
        params: { path: { id: m.id, recipeId: props.recipe.id } },
        body: {},
      });
      if (error) throw error;
    }
    return !m.containsRecipe;
  },
  onSuccess: (added, m) => {
    m.containsRecipe = added;
    void qc.invalidateQueries({ queryKey: ["my-menus"] });
    toast.success(added ? `已加入「${m.title}」` : `已从「${m.title}」移出`);
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});

const createMutation = useMutation({
  mutationFn: async (title: string) => {
    const { data, error } = await api.POST("/api/v1/menus", {
      body: { title, visibility: "private" },
    });
    if (error) throw error;
    const { error: putErr } = await api.PUT(
      "/api/v1/menus/{id}/items/{recipeId}",
      { params: { path: { id: data.id, recipeId: props.recipe.id } }, body: {} },
    );
    if (putErr) throw putErr;
    return data;
  },
  onSuccess: (m) => {
    toast.success(`已创建「${m.title}」并加入本配方`);
    newMenuTitle.value = "";
    void qc.invalidateQueries({ queryKey: ["my-menus"] });
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});
</script>

<template>
  <div class="flex items-center gap-2">
    <Button
      :variant="liked ? 'default' : 'outline'"
      size="sm"
      class="gap-1.5"
      @click="toggleLike()"
    >
      <Heart class="size-4" :class="liked ? 'fill-current' : ''" />
      {{ likeCount }}
    </Button>

    <Dialog v-model:open="menuOpen">
      <DialogTrigger as-child>
        <Button variant="outline" size="sm" class="gap-1.5" @click="!auth.isAuthenticated && toast.info('登录后即可收藏')">
          <BookmarkCheck
            v-if="(recipe.viewerState?.collectedInMenus?.length ?? 0) > 0"
            class="size-4"
          />
          <Bookmark v-else class="size-4" />
          收藏
        </Button>
      </DialogTrigger>
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>加入酒单</DialogTitle>
          <DialogDescription>勾选要加入或移出的酒单</DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-1">
          <label
            v-for="m in myMenus ?? []"
            :key="m.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent"
          >
            <Checkbox
              :model-value="m.containsRecipe"
              @update:model-value="itemMutation.mutate(m)"
              @click.prevent
            />
            <span class="min-w-0 flex-1 truncate text-sm">{{ m.title }}</span>
            <span class="text-xs text-muted-foreground">{{ m.itemCount }} 杯</span>
          </label>
          <p
            v-if="myMenus && myMenus.length === 0"
            class="py-2 text-center text-sm text-muted-foreground"
          >
            还没有酒单
          </p>
        </div>

        <Separator />

        <form
          class="flex items-center gap-2"
          @submit.prevent="newMenuTitle.trim() && createMutation.mutate(newMenuTitle.trim())"
        >
          <Input
            v-model="newMenuTitle"
            placeholder="新建酒单名称"
            maxlength="60"
            class="h-9"
          />
          <Button type="submit" size="sm" :disabled="createMutation.isPending.value">
            {{ createMutation.isPending.value ? "创建中…" : "创建" }}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
