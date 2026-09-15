<script setup lang="ts">
/** 酒单详情：条目列表 + （属主）编辑/重排/分享/删除。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ArrowDown, ArrowUp, Link2, Share2, Trash2 } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type MenuDetail = components["schemas"]["MenuDetailOutputBody"];

const route = useRoute();
const api = useApi();
const qc = useQueryClient();
const id = computed(() => String(route.params.id ?? ""));

const { data: detail, isLoading, error } = useQuery({
  queryKey: computed(() => ["menu", id.value] as const),
  queryFn: async (): Promise<MenuDetail> => {
    const { data, error } = await api.GET("/api/v1/menus/{id}", {
      params: { path: { id: id.value } },
    });
    if (error) throw error;
    return data;
  },
});

const menu = computed(() => detail.value?.menu);
const items = computed(() => detail.value?.items ?? []);
const isOwner = computed(() => menu.value?.shareToken !== undefined);

/* ── 编辑基本信息 ── */
const editOpen = ref(false);
const editTitle = ref("");
const editDesc = ref("");
const editVis = ref<"private" | "unlisted" | "public">("private");

watch(editOpen, (o) => {
  if (o && menu.value) {
    editTitle.value = menu.value.title;
    editDesc.value = menu.value.description ?? "";
    editVis.value = (menu.value.visibility as "private") ?? "private";
  }
});

const updateMenu = useMutation({
  mutationFn: async () => {
    const { error } = await api.PATCH("/api/v1/menus/{id}", {
      params: { path: { id: id.value } },
      body: {
        title: editTitle.value.trim(),
        description: editDesc.value.trim() || null,
        visibility: editVis.value,
      },
    });
    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("已保存");
    editOpen.value = false;
    void qc.invalidateQueries({ queryKey: ["menu"] });
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

/* ── 条目操作 ── */
const removeItem = useMutation({
  mutationFn: async (recipeId: string) => {
    const { error } = await api.DELETE("/api/v1/menus/{id}/items/{recipeId}", {
      params: { path: { id: id.value, recipeId } },
    });
    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("已移出");
    void qc.invalidateQueries({ queryKey: ["menu"] });
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

const reorder = useMutation({
  mutationFn: async (p: { recipeId: string; afterRecipeId: string | null }) => {
    const { error } = await api.POST("/api/v1/menus/{id}/items/reorder", {
      params: { path: { id: id.value } },
      body: { recipeId: p.recipeId, afterRecipeId: p.afterRecipeId ?? undefined },
    });
    if (error) throw error;
  },
  onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ["menu"] });
  },
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

/* ── 分享 ── */
const shareOpen = ref(false);
const shareUrl = ref("");

const share = useMutation({
  mutationFn: async () => {
    const { data, error } = await api.POST("/api/v1/menus/{id}/share", {
      params: { path: { id: id.value } },
    });
    if (error) throw error;
    return data;
  },
  onSuccess: (d) => {
    shareUrl.value = `${window.location.origin}/menus/shared/${d.shareToken}`;
    void qc.invalidateQueries({ queryKey: ["menu"] });
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

async function copyShare(): Promise<void> {
  await navigator.clipboard.writeText(shareUrl.value);
  toast.success("链接已复制");
}

/* ── 删除 ── */
const deleteOpen = ref(false);

const deleteMenu = useMutation({
  mutationFn: async () => {
    const { error } = await api.DELETE("/api/v1/menus/{id}", {
      params: { path: { id: id.value } },
    });
    if (error) throw error;
  },
  onSuccess: async () => {
    toast.success("酒单已删除");
    await navigateTo("/me/menus");
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

useHead(() => ({ title: `${menu.value?.title ?? "酒单"} · Shaker` }));

const VIS_ZH: Record<string, string> = {
  public: "公开",
  unlisted: "不列出",
  private: "私密",
};
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-4">
    <Skeleton class="h-12 w-2/3" />
    <Skeleton class="h-64 w-full" />
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>{{ apiErrorMessage(error) }}</AlertDescription>
  </Alert>

  <div v-else-if="menu" class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="flex flex-wrap items-center gap-2 text-xl font-bold">
          {{ menu.title }}
          <Badge variant="secondary">{{ VIS_ZH[menu.visibility] ?? menu.visibility }}</Badge>
        </h1>
        <p v-if="menu.description" class="mt-1 text-sm text-muted-foreground">
          {{ menu.description }}
        </p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ menu.itemCount }} 杯</p>
      </div>

      <div v-if="isOwner" class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" @click="editOpen = true">编辑</Button>
        <Button variant="outline" size="sm" @click="shareOpen = true">
          <Share2 class="size-4" /> 分享
        </Button>
        <Button variant="outline" size="sm" class="text-destructive" @click="deleteOpen = true">
          <Trash2 class="size-4" /> 删除
        </Button>
      </div>
    </div>

    <Card v-if="items.length">
      <CardContent class="flex flex-col divide-y divide-border">
        <div
          v-for="(it, i) in items"
          :key="it.recipe.id"
          class="flex items-center gap-3 py-3"
          :class="it.recipe.deleted && 'opacity-50'"
        >
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
          <template v-if="isOwner">
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
          </template>
        </div>
      </CardContent>
    </Card>

    <p v-else class="py-16 text-center text-sm text-muted-foreground">
      酒单还是空的。去配方页点「收藏」加进来。
    </p>

    <!-- 编辑 -->
    <Dialog v-model:open="editOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>编辑酒单</DialogTitle>
        </DialogHeader>
        <form class="flex flex-col gap-3" @submit.prevent="updateMenu.mutate()">
          <div class="flex flex-col gap-1.5">
            <Label for="mtitle">名称</Label>
            <Input id="mtitle" v-model="editTitle" maxlength="60" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="mdesc">描述</Label>
            <Input id="mdesc" v-model="editDesc" maxlength="200" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>可见性</Label>
            <Select v-model="editVis">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">私密（仅自己）</SelectItem>
                <SelectItem value="unlisted">不列出（链接可访问）</SelectItem>
                <SelectItem value="public">公开</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" :disabled="updateMenu.isPending.value">保存</Button>
        </form>
      </DialogContent>
    </Dialog>

    <!-- 分享 -->
    <Dialog v-model:open="shareOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享酒单</DialogTitle>
          <DialogDescription>
            生成（或轮换）分享链接。unlisted 酒单只有拿到链接的人能访问。
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <template v-if="shareUrl">
            <div class="flex items-center gap-2">
              <Input :model-value="shareUrl" readonly class="h-9 text-xs" />
              <Button size="sm" variant="outline" @click="copyShare()">
                <Link2 class="size-4" /> 复制
              </Button>
            </div>
            <Button variant="outline" size="sm" :disabled="share.isPending.value" @click="share.mutate()">
              {{ share.isPending.value ? "轮换中…" : "轮换链接（旧链接作废）" }}
            </Button>
          </template>
          <Button v-else :disabled="share.isPending.value" @click="share.mutate()">
            {{ share.isPending.value ? "生成中…" : "生成分享链接" }}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 删除 -->
    <Dialog v-model:open="deleteOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>删除「{{ menu.title }}」？</DialogTitle>
          <DialogDescription>删除后无法恢复（配方本身不受影响）。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="deleteOpen = false">取消</Button>
          <Button variant="destructive" :disabled="deleteMenu.isPending.value" @click="deleteMenu.mutate()">
            {{ deleteMenu.isPending.value ? "删除中…" : "删除" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
