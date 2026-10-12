<script setup lang="ts">
/**
 * 酒单详情（像一本卡册）：封面卡叠 + 酒单名 + 主人 + 分享，正文用 RecipeCard 卡片排列。
 * 本人可「编辑信息」（含删除）与「编辑酒单」（编辑态：卡片可拖拽重排 + 卡片角上 ✕ 移出）。
 * 点赞/收藏/评论后端没有对应功能，不放占位按钮。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { toast } from "@/lib/toast";

type MenuDetail = components["schemas"]["MenuDetailOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const qc = useQueryClient();
const { pickCovers } = useCover();
const { play } = useSfx();
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
const isPublic = computed(() => menu.value?.visibility === "public");

const VIS_OPTIONS = [
  { value: "private", label: "私密（仅自己）" },
  { value: "public", label: "公开" },
];

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
/** 松手后等待服务器回包期间的目标顺序：保持落点，避免卡片先动画跳回原位再跑到新位。 */
const pendingIds = ref<string[] | null>(null);

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
 * 松手后若等待服务器回包，则按 pendingIds 保持落点顺序（幽灵态结束但位置不跳回）。
 */
const previewItems = computed(() => {
  const arr = [...items.value];
  const from = dragIndex.value;
  const slot = dropIndex.value;
  if (from !== null && slot !== null) {
    const [m] = arr.splice(from, 1);
    if (!m) return arr;
    arr.splice(slot > from ? slot - 1 : slot, 0, m);
    return arr;
  }
  const pending = pendingIds.value;
  if (pending && pending.length === arr.length) {
    const byId = new Map(arr.map((it) => [it.recipe.id, it]));
    return pending.map((id) => byId.get(id)!).filter(Boolean);
  }
  return arr;
});

/* 服务器数据回来（或失败回退）后交出 pending 顺序 */
watch(items, () => {
  pendingIds.value = null;
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
  onError: (e) => {
    pendingIds.value = null; // 回退落点预览，恢复服务器顺序
    toast.error(apiErrorMessage(e));
  },
});

function onDragStart(i: number, e: DragEvent): void {
  if (!editMode.value) return; // 仅「编辑酒单」态可拖
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
 * 依赖结构：gridWrap 的第一个子元素就是 grid 容器，grid 的子元素就是卡片格。
 */
function onGridDragOver(e: DragEvent): void {
  if (!editMode.value || dragIndex.value === null) return;
  e.preventDefault(); // 仅编辑态允许放置，否则浏览器显示「禁止」光标
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
function onDrop(e?: DragEvent): void {
  const from = dragIndex.value;
  const slot = dropIndex.value;
  const id = dragId.value;
  resetDrag();
  if (e && editMode.value) e.preventDefault();
  if (from === null || slot === null || !id) return;
  const target = slot > from ? slot - 1 : slot; // 摘除被拖项后，插入位要左移一格
  if (target === from) return;
  const ids = items.value.map((it) => it.recipe.id);
  ids.splice(from, 1);
  ids.splice(target, 0, id);
  pendingIds.value = ids; // 保持落点顺序直到服务器回包
  play("step");
  const after = target > 0 ? ids[target - 1]! : null;
  reorder.mutate({ recipeId: id, afterRecipeId: after });
}

useHead(() => ({ title: `${menu.value?.title ?? "酒单"} · Shaker` }));
</script>

<template>
  <div>
    <div v-if="isLoading" class="flex flex-col gap-4">
      <PxSkeleton class="h-56" />
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <PxSkeleton v-for="i in 4" :key="i" class="aspect-[3/4]" />
      </div>
    </div>

    <PxEmpty v-else-if="error" icon="warn" tone="red" :title="apiErrorMessage(error)">
      <PxButton icon="chevron-left" to="/">回酒馆</PxButton>
    </PxEmpty>

    <div v-else-if="menu" class="flex flex-col gap-6">
      <!-- 头部：卡册封皮 -->
      <PxPanel :padded="false">
        <div class="flex flex-col gap-5 p-4 sm:flex-row sm:items-start sm:p-5">
          <MenuCoverStack
            :covers="pickCovers(menu.coverUrls, menu.coverUrlsLight)"
            class="w-40 shrink-0 self-center sm:w-56 sm:self-start"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <p class="flex items-center gap-2 text-amber">
              <PxIcon name="list" :scale="2" />
              <span class="font-logo text-[8px] tracking-[0.2em]">CARD ALBUM</span>
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="min-w-0 break-words text-2xl text-fg text-shadow-px">{{ menu.title }}</h1>
              <PxBadge :tone="isPublic ? 'green' : 'plain'" :icon="isPublic ? 'globe' : 'lock'">
                {{ isPublic ? "公开" : "私密" }}
              </PxBadge>
            </div>

            <NuxtLink
              v-if="menu.owner"
              :to="`/u/${menu.owner.handle}`"
              class="flex w-fit items-center gap-2 text-dim hover:text-amber"
            >
              <PxAvatar :src="menu.owner.avatarUrl" :seed="menu.owner.handle" :size="24" />
              <span class="text-fg">{{ menu.owner.displayName }}</span>
              <span class="text-faint">@{{ menu.owner.handle }}</span>
              <PxBadge v-if="menu.owner.isOfficial" tone="amber" icon="crown">官方</PxBadge>
            </NuxtLink>

            <p v-if="menu.description" class="note whitespace-pre-wrap text-fg">{{ menu.description }}</p>

            <p class="flex items-center gap-2 text-dim">
              收录
              <span class="font-logo text-[16px] text-amber">{{ menu.itemCount }}</span>
              杯
            </p>

            <div class="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-line pt-3">
              <PxButton icon="share" @click="copyShare()">分享</PxButton>
              <template v-if="isOwner">
                <PxButton icon="pencil" @click="openEditInfo()">编辑信息</PxButton>
                <PxButton
                  :variant="editMode ? 'primary' : 'secondary'"
                  :icon="editMode ? 'check' : 'grip'"
                  :active="editMode"
                  @click="toggleEdit()"
                >
                  {{ editMode ? "完成" : "编辑酒单" }}
                </PxButton>
              </template>
            </div>
          </div>
        </div>
      </PxPanel>

      <!-- 卡片排列 -->
      <section class="flex flex-col gap-3">
        <p v-if="editMode && previewItems.length" class="hint">
          <PxIcon name="grip" :scale="2" class="text-amber" />
          拖动卡片调整顺序，点右上角
          <span class="x-demo" aria-hidden="true"><PxIcon name="x" :scale="1" /></span>
          移出酒单
        </p>

        <!-- TransitionGroup：实时预览重排 + 移出动画（steps 步进）。
             dragover/drop 挂包裹层：卡片位移后事件冒泡仍能稳定命中。
             结构勿改：onGridDragOver 依赖 firstElementChild = grid、grid.children = 卡片格 -->
        <div ref="gridWrap" class="wrap" :class="{ editing: editMode }" @dragover="onGridDragOver" @drop="onDrop($event)">
          <TransitionGroup
            v-if="previewItems.length"
            tag="div"
            name="menu"
            class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            <div
              v-for="(it, i) in previewItems"
              :key="it.recipe.id"
              class="cell"
              :draggable="editMode"
              :class="{ grab: editMode, ghost: dragId && dragId === it.recipe.id }"
              @dragstart="onDragStart(i, $event)"
              @dragend="resetDrag()"
            >
              <RecipeCard
                :recipe="it.recipe"
                :disabled="it.recipe.deleted"
                :class="editMode && 'pointer-events-none'"
              />
              <template v-if="editMode">
                <span class="grip" aria-hidden="true"><PxIcon name="grip" :scale="1" /></span>
                <button
                  type="button"
                  draggable="false"
                  class="rm"
                  title="移出酒单"
                  aria-label="移出酒单"
                  @click.stop="removeItem.mutate(it.recipe.id)"
                >
                  <PxIcon name="x" :scale="1" />
                </button>
              </template>
            </div>
          </TransitionGroup>
          <PxEmpty v-else icon="list" title="这个酒单还是空的。去配方页点「收藏」加进来。">
            <PxButton icon="book" to="/classics">翻翻经典图鉴</PxButton>
          </PxEmpty>
        </div>
      </section>

      <!-- 编辑信息 -->
      <PxDialog v-model:open="editOpen" title="编辑信息" icon="pencil" size="sm">
        <form id="menu-edit-form" class="flex flex-col gap-3" @submit.prevent="updateMenu.mutate()">
          <div class="flex flex-col gap-1">
            <span class="text-dim">名称</span>
            <PxInput v-model="editTitle" maxlength="60" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-dim">描述</span>
            <PxTextarea v-model="editDesc" maxlength="200" rows="3" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-dim">可见性</span>
            <PxSelect
              :model-value="editVis"
              :options="VIS_OPTIONS"
              @update:model-value="(v) => (editVis = v === 'public' ? 'public' : 'private')"
            />
          </div>
        </form>

        <!-- 危险区：二次确认才删除 -->
        <div class="mt-5 flex flex-wrap items-center justify-between gap-2 border-t-2 border-dashed border-line pt-3">
          <PxButton v-if="!confirmDelete" size="sm" variant="ghost" icon="trash" class="!text-red" @click="confirmDelete = true">
            删除酒单
          </PxButton>
          <template v-else>
            <span class="flex items-center gap-1 text-red"><PxIcon name="warn" :scale="1" />删除后无法恢复</span>
            <div class="flex gap-2">
              <PxButton size="sm" variant="ghost" sfx="cancel" @click="confirmDelete = false">取消</PxButton>
              <PxButton size="sm" variant="danger" icon="trash" :loading="deleteMenu.isPending.value" @click="deleteMenu.mutate()">
                确认删除
              </PxButton>
            </div>
          </template>
        </div>

        <template #footer>
          <PxButton @click="editOpen = false">取消</PxButton>
          <PxButton type="submit" form="menu-edit-form" variant="primary" icon="save" :loading="updateMenu.isPending.value">
            保存
          </PxButton>
        </template>
      </PxDialog>
    </div>
  </div>
</template>

<style scoped>
/* 酒单描述：贴在封皮内页的便签 */
.note {
  max-width: 60ch;
  padding: 8px 12px;
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
  margin: var(--p);
}

.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--amber) 14%, var(--panel));
  color: var(--fg);
  box-shadow: 0 0 0 var(--p) var(--ink), inset calc(var(--p) * 2) 0 0 0 var(--amber);
  animation: px-pop-in 0.22s steps(4) both;
}
.x-demo {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  background: var(--red);
  color: #fff;
  box-shadow: 0 0 0 var(--p) var(--ink);
}

/* 编辑态：网格外框换成虚线 + 斜纹底，表示这里是可拖区 */
.wrap.editing {
  --stripe: color-mix(in srgb, var(--amber) 10%, transparent);
  padding: 12px;
  outline: var(--p) dashed var(--amber);
  outline-offset: calc(var(--p) * -1);
  background-color: var(--panel-lo);
  background-image: repeating-linear-gradient(-45deg, var(--stripe) 0 4px, transparent 4px 8px);
}

.cell {
  position: relative;
  transition: opacity 0.15s steps(3);
}
.cell.grab { cursor: grab; }
.cell.grab:active { cursor: grabbing; }
.cell.grab :deep(.card) { animation: px-bob 1.2s steps(2) infinite; }
.cell.ghost {
  pointer-events: none;
  opacity: 0.4;
  outline: var(--p) dashed var(--amber);
}
.cell.ghost :deep(.card) { animation: none; }

/* 把手：卡片上沿正中的小提耳 */
.grip {
  position: absolute;
  left: 50%;
  top: -6px;
  z-index: 10;
  display: grid;
  place-items: center;
  width: 28px;
  height: 14px;
  translate: -50% 0;
  background: var(--amber);
  color: var(--on-accent);
  box-shadow: 0 0 0 var(--p) var(--ink);
  pointer-events: none;
}
/* 移出键：右上角红色像素 ✕ */
.rm {
  position: absolute;
  right: -4px;
  top: -6px;
  z-index: 10;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  background: var(--red);
  color: #fff;
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35),
    calc(var(--p) * 1) calc(var(--p) * 1) 0 var(--p) var(--shadow);
  pointer-events: auto;
}
.rm:hover { background: var(--red-lo); }
.rm:active { translate: var(--p) var(--p); box-shadow: 0 0 0 var(--p) var(--ink); }

/* TransitionGroup：重排时步进位移，移出时缩小消失并让位 */
.menu-move,
.menu-enter-active,
.menu-leave-active {
  transition: all 0.24s steps(4);
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
.menu-leave-active {
  position: absolute;
}
</style>
