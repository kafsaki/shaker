<script setup lang="ts">
/**
 * 用户主页 · 酒单分栏（由旧 /me/menus 迁移而来）。
 * 本人：管理视图——收藏夹式双栏（左酒单列表，右选中酒单的条目），可新建/重排/移出。
 * 他人：只读——服务端仅返回公开酒单，点进 /menus/{id} 查看。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ArrowDown, ArrowUp, Plus, Settings, Trash2 } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import MenuCoverStack from "@/components/MenuCoverStack.vue";
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

type MyMenu = components["schemas"]["MyMenuBody"];
type MenuDetail = components["schemas"]["MenuDetailOutputBody"];
type MenuList = components["schemas"]["MenuListOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const qc = useQueryClient();
const { pickCover, pickCovers } = useCover();
const handle = computed(() => String(route.params.handle ?? ""));
const isSelf = computed(() => auth.user?.handle === handle.value);

const VIS_ZH: Record<string, string> = {
  public: "公开",
  unlisted: "不列出",
  private: "私密",
};

/* ── 本人：全部酒单（含私密），管理用 ── */
const { data: mine, isLoading: mineLoading } = useQuery({
  queryKey: ["my-menus", "list"],
  queryFn: async (): Promise<MyMenu[]> => {
    const { data, error } = await api.GET("/api/v1/me/menus");
    if (error) throw error;
    return data.items ?? [];
  },
  enabled: isSelf,
});

/* ── 他人：仅公开酒单，只读 ── */
const { data: pub, isLoading: pubLoading } = useQuery({
  queryKey: computed(() => ["user-menus", handle.value] as const),
  queryFn: async (): Promise<MenuList> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}/menus", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
  enabled: computed(() => !isSelf.value),
});

/* ── 选中酒单（仅本人管理视图用）── */
const selectedId = ref<string | null>(null);

watch(mine, (list) => {
  if (list?.length && !(selectedId.value && list.some((m) => m.id === selectedId.value))) {
    selectedId.value = list[0]!.id;
  }
}, { immediate: true });

const { data: detail, isLoading: detailLoading } = useQuery({
  queryKey: computed(() => ["menu", selectedId.value] as const),
  enabled: computed(() => isSelf.value && !!selectedId.value),
  queryFn: async (): Promise<MenuDetail> => {
    const { data, error } = await api.GET("/api/v1/menus/{id}", {
      params: { path: { id: selectedId.value! } },
    });
    if (error) throw error;
    return data;
  },
});

const menu = computed(() => detail.value?.menu);
const items = computed(() => detail.value?.items ?? []);

/* ── 条目操作（本人酒单，viewerIsOwner 恒 true）── */
const invalidate = () => {
  void qc.invalidateQueries({ queryKey: ["menu"] });
  void qc.invalidateQueries({ queryKey: ["my-menus"] });
};

const removeItem = useMutation({
  mutationFn: async (recipeId: string) => {
    const { error } = await api.DELETE("/api/v1/menus/{id}/items/{recipeId}", {
      params: { path: { id: selectedId.value!, recipeId } },
    });
    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("已移出");
    invalidate();
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

const reorder = useMutation({
  mutationFn: async (p: { recipeId: string; afterRecipeId: string | null }) => {
    const { error } = await api.POST("/api/v1/menus/{id}/items/reorder", {
      params: { path: { id: selectedId.value! } },
      body: { recipeId: p.recipeId, afterRecipeId: p.afterRecipeId ?? undefined },
    });
    if (error) throw error;
  },
  onSuccess: invalidate,
  onError: (e) => toast.error(apiErrorMessage(e)),
});

/** 上移：放到上一个条目之前 = afterRecipeId = 上上一个；列表头则 null。 */
function moveUp(i: number): void {
  const list = items.value;
  if (i === 0) return;
  reorder.mutate({
    recipeId: list[i]!.recipe.id,
    afterRecipeId: i >= 2 ? list[i - 2]!.recipe.id : null,
  });
}

function moveDown(i: number): void {
  const list = items.value;
  if (i >= list.length - 1) return;
  reorder.mutate({
    recipeId: list[i + 1]!.recipe.id,
    afterRecipeId: i >= 1 ? list[i - 1]!.recipe.id : null,
  });
}

/* ── 新建 ── */
const open = ref(false);
const title = ref("");
const visibility = ref<"private" | "unlisted" | "public">("private");

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
    selectedId.value = d.id;
    void qc.invalidateQueries({ queryKey: ["my-menus"] });
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});
</script>

<template>
  <!-- ── 本人：管理视图 ── -->
  <div v-if="isSelf" class="flex flex-col gap-5">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold">我的酒单</h2>
      <Dialog v-model:open="open">
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
                  <SelectItem value="unlisted">不列出（链接可访问）</SelectItem>
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

    <div v-if="mineLoading" class="grid gap-5 lg:grid-cols-[300px_1fr]">
      <div class="flex flex-col gap-2"><Skeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" /></div>
      <Skeleton class="h-64 rounded-xl" />
    </div>

    <p v-else-if="(mine ?? []).length === 0" class="py-16 text-center text-sm text-muted-foreground">
      还没有酒单。也可以在配方页点「收藏」直接加入。
    </p>

    <div v-else class="grid items-start gap-5 lg:grid-cols-[300px_1fr]">
      <!-- 左栏：酒单列表 -->
      <nav class="flex flex-col gap-2">
        <button
          v-for="m in mine ?? []"
          :key="m.id"
          type="button"
          class="flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors"
          :class="m.id === selectedId
            ? 'border-primary/50 bg-primary/5'
            : 'border-transparent bg-card hover:border-primary/30'"
          @click="selectedId = m.id"
        >
          <MenuCoverStack :covers="pickCovers(m.coverUrls, m.coverUrlsLight)" class="w-16 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="truncate text-sm font-medium">{{ m.title }}</span>
            <span class="text-xs text-muted-foreground">
              {{ m.itemCount }} 杯 · {{ VIS_ZH[m.visibility] ?? m.visibility }}
            </span>
          </div>
        </button>
      </nav>

      <!-- 右栏：选中酒单的配方卡片 -->
      <div class="flex flex-col gap-4">
        <div v-if="detailLoading" class="flex flex-col gap-3">
          <Skeleton class="h-8 w-1/3" />
          <Skeleton v-for="i in 3" :key="i" class="h-20 rounded-xl" />
        </div>

        <template v-else-if="menu">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <h3 class="flex flex-wrap items-center gap-2 font-bold">
                {{ menu.title }}
                <Badge variant="secondary">{{ VIS_ZH[menu.visibility] ?? menu.visibility }}</Badge>
              </h3>
              <p v-if="menu.description" class="mt-1 text-sm text-muted-foreground">{{ menu.description }}</p>
            </div>
            <Button variant="outline" size="sm" as-child>
              <NuxtLink :to="`/menus/${menu.id}`"><Settings class="size-4" /> 管理</NuxtLink>
            </Button>
          </div>

          <Card v-if="items.length">
            <CardContent class="flex flex-col divide-y divide-border">
              <div
                v-for="(it, i) in items"
                :key="it.recipe.id"
                class="flex items-center gap-3 py-3"
                :class="it.recipe.deleted && 'opacity-50'"
              >
                <img
                  v-if="it.recipe.coverUrl && !it.recipe.deleted"
                  :src="pickCover(it.recipe.coverUrl, it.recipe.coverUrlLight)"
                  alt=""
                  loading="lazy"
                  class="size-14 shrink-0 rounded-lg border border-border object-cover"
                >
                <div v-else class="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-xs text-muted-foreground">
                  {{ it.recipe.deleted ? "已删" : "无封面" }}
                </div>
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
                <div class="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" size="icon" class="size-7" :disabled="i === 0 || reorder.isPending.value" title="上移" @click="moveUp(i)">
                    <ArrowUp class="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-7" :disabled="i === items.length - 1 || reorder.isPending.value" title="下移" @click="moveDown(i)">
                    <ArrowDown class="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-7 text-destructive" title="移出" @click="removeItem.mutate(it.recipe.id)">
                    <Trash2 class="size-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <p v-else class="py-16 text-center text-sm text-muted-foreground">
            酒单还是空的。去配方页点「收藏」加进来。
          </p>
        </template>

        <p v-else class="py-16 text-center text-sm text-muted-foreground">选择左侧的酒单查看内容</p>
      </div>
    </div>
  </div>

  <!-- ── 他人：只读公开酒单 ── -->
  <div v-else class="flex flex-col gap-4">
    <div v-if="pubLoading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-28 rounded-xl" />
    </div>

    <div v-else-if="(pub?.items ?? []).length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="m in pub?.items ?? []"
        :key="m.id"
        :to="`/menus/${m.id}`"
        class="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
      >
        <MenuCoverStack :covers="pickCovers(m.coverUrls, m.coverUrlsLight)" class="w-20 shrink-0" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="truncate font-medium">{{ m.title }}</span>
          <span class="text-xs text-muted-foreground">
            {{ m.itemCount }} 杯 · {{ VIS_ZH[m.visibility] ?? m.visibility }}
          </span>
        </div>
      </NuxtLink>
    </div>

    <p v-else class="py-10 text-center text-sm text-muted-foreground">没有公开酒单</p>
  </div>
</template>