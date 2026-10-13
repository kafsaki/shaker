<script setup lang="ts">
/**
 * 配方互动条：点赞（幂等 PUT/DELETE，点亮时飘一颗 +1 爱心）、放进酒单
 * （GET /me/menus?containsRecipe= 一次拿到带勾选态的列表）、复制分享链接、浏览数。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { compact } from "@/lib/game";
import { toast } from "@/lib/toast";

type Recipe = components["schemas"]["RecipeBody"];
type MyMenu = components["schemas"]["MyMenuBody"];

const props = defineProps<{ recipe: Recipe }>();

const auth = useAuthStore();
const api = useApi();
const qc = useQueryClient();
const { play } = useSfx();

/* ── 点赞 ── */
const liked = ref(props.recipe.viewerState?.liked ?? false);
const likeCount = ref(props.recipe.counts.like);
const pops = ref<number[]>([]);
let popSeq = 0;

watch(
  () => props.recipe,
  (r) => {
    liked.value = r.viewerState?.liked ?? false;
    likeCount.value = r.counts.like;
  },
);

const likeMutation = useMutation({
  mutationFn: async (on: boolean) => {
    const opts = { params: { path: { id: props.recipe.id } } };
    const { data, error } = on
      ? await api.PUT("/api/v1/recipes/{id}/like", opts)
      : await api.DELETE("/api/v1/recipes/{id}/like", opts);
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
    toast.info("读取存档（登录）后才能点赞");
    return;
  }
  const on = !liked.value;
  if (on) {
    play("coin");
    const id = ++popSeq;
    pops.value.push(id);
    setTimeout(() => (pops.value = pops.value.filter((p) => p !== id)), 700);
  } else {
    play("cancel");
  }
  likeMutation.mutate(on);
}

/* ── 放进酒单 ── */
const menuOpen = ref(false);
const newMenuTitle = ref("");
/** 收藏数 = 出现在多少个酒单里（后端 collect_count，含别人公开/私有酒单）。 */
const collectCount = ref(props.recipe.counts.collect);
const collected = ref((props.recipe.viewerState?.collectedInMenus?.length ?? 0) > 0);
watch(
  () => props.recipe,
  (r) => {
    collectCount.value = r.counts.collect;
    collected.value = (r.viewerState?.collectedInMenus?.length ?? 0) > 0;
  },
);

function openMenus(): void {
  if (!auth.isAuthenticated) {
    toast.info("读取存档（登录）后才能收藏");
    return;
  }
  menuOpen.value = true;
}

const { data: myMenus, isLoading: menusLoading } = useQuery({
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
    const opts = { params: { path: { id: m.id, recipeId: props.recipe.id } } };
    const { error } = m.containsRecipe
      ? await api.DELETE("/api/v1/menus/{id}/items/{recipeId}", opts)
      : await api.PUT("/api/v1/menus/{id}/items/{recipeId}", { ...opts, body: {} });
    if (error) throw error;
    return !m.containsRecipe;
  },
  onSuccess: (added, m) => {
    m.containsRecipe = added;
    // 加入/移出必然让 collect_count 变化 ±1（一个酒单里同一配方只有一条）
    collectCount.value += added ? 1 : -1;
    collected.value = (myMenus.value ?? []).some((x) => x.containsRecipe);
    void qc.invalidateQueries({ queryKey: ["my-menus"] });
    toast.success(added ? `已放进「${m.title}」` : `已从「${m.title}」取出`);
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});

const createMutation = useMutation({
  mutationFn: async (title: string) => {
    const { data, error } = await api.POST("/api/v1/menus", { body: { title, visibility: "private" } });
    if (error) throw error;
    const { error: putErr } = await api.PUT("/api/v1/menus/{id}/items/{recipeId}", {
      params: { path: { id: data.id, recipeId: props.recipe.id } },
      body: {},
    });
    if (putErr) throw putErr;
    return data;
  },
  onSuccess: (m) => {
    toast.success(`新酒单「${m.title}」已创建并放入本配方`);
    collectCount.value += 1;
    collected.value = true;
    newMenuTitle.value = "";
    void qc.invalidateQueries({ queryKey: ["my-menus"] });
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});

/* ── 分享 ── */
async function share(): Promise<void> {
  const url = props.recipe.isCanonical && props.recipe.classicKey
    ? `${location.origin}/classics/${props.recipe.classicKey}`
    : `${location.origin}/r/${props.recipe.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("链接已复制", { description: url });
  } catch {
    toast.info(url);
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span class="relative">
      <PxButton :variant="liked ? 'accent' : 'secondary'" :icon="liked ? 'heart' : 'heart-o'" :sfx="false" @click="toggleLike()">
        <span class="font-logo text-[8px]">{{ compact(likeCount) }}</span>
      </PxButton>
      <span v-for="p in pops" :key="p" class="pop" aria-hidden="true">+1 ♥</span>
    </span>
    <PxButton :icon="collected ? 'bookmark' : 'bookmark-o'" :class="collected && '!text-amber'" sfx="open" @click="openMenus()">
      放进酒单 <span class="font-logo text-[8px] text-faint">{{ compact(collectCount) }}</span>
    </PxButton>
    <PxButton icon="share" @click="share()">分享</PxButton>
    <span class="ml-auto flex items-center gap-1 text-faint" title="浏览">
      <PxIcon name="eye" :scale="1" />
      <span class="font-logo text-[8px]">{{ compact(recipe.counts.view) }}</span>
    </span>

    <PxDialog v-model:open="menuOpen" title="放进酒单" icon="bookmark" size="sm">
      <p class="mb-3 text-dim">勾选要放入或取出的酒单。</p>
      <div v-if="menusLoading" class="flex flex-col gap-2">
        <PxSkeleton v-for="i in 3" :key="i" class="h-8" />
      </div>
      <div v-else class="flex max-h-72 flex-col gap-1 overflow-y-auto">
        <div v-for="m in myMenus ?? []" :key="m.id" class="flex items-center gap-3 px-2 py-1.5 hover:bg-panel-hi">
          <PxCheckbox
            :model-value="m.containsRecipe"
            :disabled="itemMutation.isPending.value"
            class="min-w-0 flex-1"
            @update:model-value="itemMutation.mutate(m)"
          >
            <span class="truncate">{{ m.title }}</span>
          </PxCheckbox>
          <PxIcon :name="m.visibility === 'public' ? 'globe' : 'lock'" :scale="1" class="text-faint" />
          <span class="font-logo text-[8px] text-faint">{{ m.itemCount }}杯</span>
        </div>
        <PxEmpty v-if="myMenus && myMenus.length === 0" icon="list" title="还没有酒单，下面新建一个。" />
      </div>
      <form
        class="mt-4 flex items-center gap-2 border-t-2 border-dashed border-line pt-4"
        @submit.prevent="newMenuTitle.trim() && createMutation.mutate(newMenuTitle.trim())"
      >
        <PxInput v-model="newMenuTitle" placeholder="新酒单名称" maxlength="60" class="flex-1" />
        <PxButton type="submit" variant="primary" icon="plus" :loading="createMutation.isPending.value" sfx="confirm">新建</PxButton>
      </form>
    </PxDialog>
  </div>
</template>

<style scoped>
.pop {
  position: absolute;
  left: 50%;
  top: -6px;
  color: var(--pink);
  font-family: var(--font-logo);
  font-size: 8px;
  white-space: nowrap;
  pointer-events: none;
  text-shadow: 1px 1px 0 var(--ink);
  animation: px-float-up 0.7s steps(7) forwards;
}
</style>
