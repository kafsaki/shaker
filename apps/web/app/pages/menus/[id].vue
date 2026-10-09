<script setup lang="ts">
/**
 * 酒单展示详情页（类似歌单）：顶部封面 + 酒单名 + 作者 + 互动条，
 * 正文用 RecipeCard 卡片排列。本人可「编辑信息」（含删除）与「编辑酒单」
 * （编辑态：卡片可拖拽重排 + 卡片角上「X」移出）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  ArrowUpDown,
  Heart,
  MessageCircle,
  Pencil,
  Share2,
  Star,
  Trash2,
  X,
} from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import MenuCoverStack from "@/components/MenuCoverStack.vue";
import RecipeCard from "@/components/RecipeCard.vue";

type MenuDetail = components["schemas"]["MenuDetailOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const qc = useQueryClient();
const { pickCovers } = useCover();
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
const isOwner = computed(() => menu.value?.viewerIsOwner ?? false);

const VIS_ZH: Record<string, string> = { public: "公开", private: "私密" };

/* ── 互动占位（后端未开放，仅 UI） ── */
function notOpen(): void {
  toast.info("该功能暂未开放");
}

/* ── 分享：直接分享 /menus/{id} 链接 ── */
async function copyShare(): Promise<void> {
  await navigator.clipboard.writeText(`${window.location.origin}/menus/${id.value}`);
  toast.success("链接已复制");
}

/* ── 编辑信息（含删除） ── */
const editOpen = ref(false);
const confirmDelete = ref(false);
const editTitle = ref("");
const editDesc = ref("");
const editVis = ref<"private" | "public">("private");

function openEditInfo(): void {
  confirmDelete.value = false;
  editOpen.value = true;
}

watch(editOpen, (o) => {
  if (o && menu.value) {
    editTitle.value = menu.value.title;
    editDesc.value = menu.value.description ?? "";
    editVis.value = menu.value.visibility === "public" ? "public" : "private";
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

const deleteMenu = useMutation({
  mutationFn: async () => {
    const { error } = await api.DELETE("/api/v1/menus/{id}", {
      params: { path: { id: id.value } },
    });
    if (error) throw error;
  },
  onSuccess: async () => {
    toast.success("酒单已删除");
    const handle = menu.value?.owner?.handle ?? auth.user?.handle ?? "";
    await navigateTo(`/u/${handle}/menus`);
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

/* ── 编辑酒单：拖拽重排 + 移出（仅编辑态可拖，拖动中实时预览落点） ── */
const editMode = ref(false);
const dragIndex = ref<number | null>(null);
const dragId = ref<string | null>(null);
/** 插入位（0..n）：插到原列表第 dropIndex 张之前；n 表示放到最后。 */
const dropIndex = ref<number | null>(null);
const gridWrap = ref<HTMLElement | null>(null);

function toggleEdit(): void {
  editMode.value = !editMode.value;
  resetDrag();
}

function resetDrag(): void {
  dragIndex.value = null;
  dragId.value = null;
  dropIndex.value = null;
}

/**
 * 拖拽中的预览顺序：被拖卡片虚拟移到插入位（渲染成半透明幽灵），
 * 其他卡片经 TransitionGroup 滑开让位 —— 落点是否生效拖动中即可见。
 */
const previewItems = computed(() => {
  const arr = [...items.value];
  const from = dragIndex.value;
  const slot = dropIndex.value;
  if (from === null || slot === null) return arr;
  const [m] = arr.splice(from, 1);
  if (!m) return arr;
  arr.splice(slot > from ? slot - 1 : slot, 0, m);
  return arr;
});

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

function onDragStart(i: number, e: DragEvent): void {
  dragIndex.value = i;
  dragId.value = items.value[i]?.recipe.id ?? null;
  dropIndex.value = i;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", items.value[i]?.recipe.id ?? "");
  }
}

/**
 * 按鼠标坐标对网格几何求插入槽位（列取最近的槽缝，行取所在行）。
 * 不依赖「悬停在哪张卡片上」，因此预览重排导致卡片位移时判定依然稳定。
 */
function onGridDragOver(e: DragEvent): void {
  if (dragIndex.value === null) return;
  const grid = gridWrap.value?.firstElementChild as HTMLElement | null;
  if (!grid) return;
  const n = items.value.length;
  const rect = grid.getBoundingClientRect();
  const style = getComputedStyle(grid);
  const cols = Math.max(1, style.gridTemplateColumns.split(" ").length);
  const gapX = parseFloat(style.columnGap) || 0;
  const gapY = parseFloat(style.rowGap) || 0;
  const cellW = (rect.width - (cols - 1) * gapX) / cols;
  const cellH = (grid.children[0] as HTMLElement | undefined)?.offsetHeight ?? 0;
  if (cellW <= 0 || cellH <= 0) return;
  const col = Math.min(
    Math.max(Math.round((e.clientX - rect.left + gapX / 2) / (cellW + gapX)), 0),
    cols,
  );
  const row = Math.min(
    Math.max(Math.floor((e.clientY - rect.top + gapY / 2) / (cellH + gapY)), 0),
    Math.ceil(n / cols) - 1,
  );
  dropIndex.value = Math.min(row * cols + col, n);
}

/** 落点换算成新顺序：afterRecipeId = 目标前一张（null → 移到最前）。 */
function onDrop(): void {
  const from = dragIndex.value;
  const slot = dropIndex.value;
  const id = dragId.value;
  resetDrag();
  if (from === null || slot === null || !id) return;
  const target = slot > from ? slot - 1 : slot; // 摘除被拖项后，插入位要左移一格
  if (target === from) return;
  const ids = items.value.map((it) => it.recipe.id);
  ids.splice(from, 1);
  ids.splice(target, 0, id);
  const after = target > 0 ? ids[target - 1]! : null;
  reorder.mutate({ recipeId: id, afterRecipeId: after });
}

useHead(() => ({ title: `${menu.value?.title ?? "酒单"} · Shaker` }));
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-4">
    <Skeleton class="h-12 w-2/3" />
    <Skeleton class="h-64 w-full" />
  </div>

  <Alert v-else-if="error" variant="destructive">
    <AlertDescription>{{ apiErrorMessage(error) }}</AlertDescription>
  </Alert>

  <div v-else-if="menu" class="flex flex-col gap-6">
    <!-- 头部（歌单式） -->
    <div class="flex flex-col gap-5 sm:flex-row sm:items-start">
      <MenuCoverStack
        :covers="pickCovers(menu.coverUrls, menu.coverUrlsLight)"
        class="w-32 shrink-0 sm:w-44"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-bold">{{ menu.title }}</h1>
          <Badge variant="secondary">{{ VIS_ZH[menu.visibility] ?? menu.visibility }}</Badge>
        </div>

        <NuxtLink
          v-if="menu.owner"
          :to="`/u/${menu.owner.handle}`"
          class="flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <img
            v-if="menu.owner.avatarUrl"
            :src="menu.owner.avatarUrl"
            alt=""
            class="size-6 rounded-full object-cover"
          >
          <span>{{ menu.owner.displayName }}</span>
          <span class="text-xs">@{{ menu.owner.handle }}</span>
        </NuxtLink>

        <p v-if="menu.description" class="text-sm text-muted-foreground">{{ menu.description }}</p>
        <p class="text-xs text-muted-foreground">{{ menu.itemCount }} 杯</p>

        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" class="gap-1.5" @click="notOpen()">
            <Heart class="size-4" /> 点赞
          </Button>
          <Button variant="outline" size="sm" class="gap-1.5" @click="notOpen()">
            <Star class="size-4" /> 收藏
          </Button>
          <Button variant="outline" size="sm" class="gap-1.5" @click="notOpen()">
            <MessageCircle class="size-4" /> 评论
          </Button>
          <Button variant="outline" size="sm" class="gap-1.5" @click="copyShare()">
            <Share2 class="size-4" /> 分享
          </Button>
        </div>

        <div v-if="isOwner" class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" class="gap-1.5" @click="openEditInfo()">
            <Pencil class="size-4" /> 编辑信息
          </Button>
          <Button
            :variant="editMode ? 'default' : 'outline'"
            size="sm"
            class="gap-1.5"
            @click="toggleEdit()"
          >
            <ArrowUpDown class="size-4" /> {{ editMode ? "完成" : "编辑酒单" }}
          </Button>
        </div>
      </div>
    </div>

    <!-- 卡片排列（TransitionGroup：实时预览重排 + 移出动画）。
         dragover/drop 挂包裹层：卡片位移后事件冒泡仍能稳定命中 -->
    <div ref="gridWrap" @dragover.prevent="onGridDragOver" @drop.prevent="onDrop()">
      <TransitionGroup
        v-if="previewItems.length"
        tag="div"
        name="menu"
        class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        <div
          v-for="(it, i) in previewItems"
          :key="it.recipe.id"
          class="relative transition-all duration-150"
          :draggable="editMode"
          :class="[
            editMode && 'cursor-grab active:cursor-grabbing',
            dragId && dragId === it.recipe.id && 'pointer-events-none scale-95 opacity-40',
          ]"
          @dragstart="onDragStart(i, $event)"
          @dragend="resetDrag()"
        >
          <RecipeCard
            :recipe="it.recipe"
            :disabled="it.recipe.deleted"
            :class="editMode && 'pointer-events-none'"
          />
          <button
            v-if="editMode"
            type="button"
            draggable="false"
            class="pointer-events-auto absolute -right-2 -top-2 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background text-destructive shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground"
            title="移出酒单"
            @click.stop="removeItem.mutate(it.recipe.id)"
          >
          <X class="size-3.5" />
        </button>
      </div>
      </TransitionGroup>
      <p v-else class="py-16 text-center text-sm text-muted-foreground">
        这个酒单还是空的。去配方页点「收藏」加进来。
      </p>
    </div>

    <!-- 编辑信息 -->
    <Dialog v-model:open="editOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>编辑信息</DialogTitle>
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
                <SelectItem value="public">公开</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" :disabled="updateMenu.isPending.value">保存</Button>
        </form>

        <Separator />
        <div class="flex items-center justify-between gap-2">
          <template v-if="!confirmDelete">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="gap-1.5 text-destructive"
              @click="confirmDelete = true"
            >
              <Trash2 class="size-4" /> 删除酒单
            </Button>
          </template>
          <template v-else>
            <span class="text-sm text-muted-foreground">删除后无法恢复</span>
            <div class="flex gap-2">
              <Button type="button" variant="ghost" size="sm" @click="confirmDelete = false">
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                :disabled="deleteMenu.isPending.value"
                @click="deleteMenu.mutate()"
              >
                {{ deleteMenu.isPending.value ? "删除中…" : "确认删除" }}
              </Button>
            </div>
          </template>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
/* TransitionGroup：重排时平滑位移，移出时淡出并让位 */
.menu-move,
.menu-enter-active,
.menu-leave-active {
  transition: all 0.25s ease;
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
.menu-leave-active {
  position: absolute;
}
</style>