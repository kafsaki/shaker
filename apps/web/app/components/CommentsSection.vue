<script setup lang="ts">
/**
 * 留言板：顶层评论 + 每条前几条回复（一层回复，规范 §2.4）。
 * 每条留言是一个像素对话气泡；发评论 / 回复 / 点赞 / 编辑 / 删除自己的评论。
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { toast } from "@/lib/toast";

type Comment = components["schemas"]["CommentBody"];
type CommentsPage = components["schemas"]["CommentsOutputBody"];

const props = defineProps<{ recipeId: string }>();

const auth = useAuthStore();
const api = useApi();
const qc = useQueryClient();
const { play } = useSfx();

const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: computed(() => ["comments", props.recipeId] as const),
  // 游标是服务端编码的不透明串，必须原样回传（传评论 id 会被判 cursor.invalid）
  queryFn: async ({ pageParam }): Promise<CommentsPage> => {
    const { data, error } = await api.GET("/api/v1/recipes/{id}/comments", {
      params: { path: { id: props.recipeId }, query: { cursor: pageParam || undefined } },
    });
    if (error) throw error;
    return data;
  },
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});

const comments = computed(() => data.value?.pages.flatMap((p) => p.items ?? []) ?? []);

/* ── 发表 ── */
const draft = ref("");
const replyTo = ref<Comment | null>(null);
const replyDraft = ref("");
const submitting = ref(false);

async function post(body: string, parentId?: string): Promise<boolean> {
  submitting.value = true;
  try {
    const { error } = await api.POST("/api/v1/recipes/{id}/comments", {
      params: { path: { id: props.recipeId } },
      body: parentId ? { body, parentId } : { body },
    });
    if (error) throw error;
    play("confirm");
    void qc.invalidateQueries({ queryKey: ["comments"] });
    return true;
  } catch (err) {
    toast.error(apiErrorMessage(err));
    return false;
  } finally {
    submitting.value = false;
  }
}

async function submit(): Promise<void> {
  const body = draft.value.trim();
  if (body && (await post(body))) draft.value = "";
}

async function submitReply(): Promise<void> {
  const body = replyDraft.value.trim();
  if (!replyTo.value || !body) return;
  if (await post(body, replyTo.value.id)) {
    replyDraft.value = "";
    replyTo.value = null;
  }
}

/* ── 点赞 / 编辑 / 删除 ── */
const likeMutation = useMutation({
  mutationFn: async (c: Comment) => {
    const on = !(c.viewerState?.liked ?? false);
    const opts = { params: { path: { id: c.id } } };
    const { error } = on
      ? await api.PUT("/api/v1/comments/{id}/like", opts)
      : await api.DELETE("/api/v1/comments/{id}/like", opts);
    if (error) throw error;
    return on;
  },
  onMutate: (c) => {
    const on = !(c.viewerState?.liked ?? false);
    c.viewerState = { liked: on };
    c.likeCount += on ? 1 : -1;
    play(on ? "coin" : "click");
  },
  onError: (err, c) => {
    const on = !(c.viewerState?.liked ?? false);
    c.viewerState = { liked: !on };
    c.likeCount += on ? -1 : 1;
    toast.error(apiErrorMessage(err));
  },
});

function likeComment(c: Comment): void {
  if (!auth.isAuthenticated) {
    toast.info("读取存档（登录）后才能点赞");
    return;
  }
  likeMutation.mutate(c);
}

const editing = ref<Comment | null>(null);
const editDraft = ref("");

const editMutation = useMutation({
  mutationFn: async (c: Comment) => {
    const { error } = await api.PATCH("/api/v1/comments/{id}", {
      params: { path: { id: c.id } },
      body: { body: editDraft.value.trim() },
    });
    if (error) throw error;
    return c;
  },
  onSuccess: (c) => {
    c.body = editDraft.value.trim();
    editing.value = null;
    toast.success("已修改");
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});

const deleteMutation = useMutation({
  mutationFn: async (c: Comment) => {
    const { error } = await api.DELETE("/api/v1/comments/{id}", { params: { path: { id: c.id } } });
    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("已删除");
    void qc.invalidateQueries({ queryKey: ["comments"] });
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const isMine = (c: Comment): boolean => auth.user !== null && c.author.handle === auth.user.handle;
const total = computed(() => comments.value.length);
</script>

<template>
  <PxPanel title="留言板" icon="comment" tone="cyan">
    <template #actions>
      <span v-if="total" class="font-logo text-[8px] text-faint">{{ total }}{{ hasNextPage ? "+" : "" }}</span>
    </template>

    <!-- 发表 -->
    <div v-if="auth.isAuthenticated && auth.user" class="flex items-start gap-3">
      <PxAvatar :src="auth.user.avatarUrl" :seed="auth.user.handle" :size="32" class="max-sm:!hidden" />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <PxTextarea v-model="draft" placeholder="聊聊这杯酒…" :maxlength="2000" />
        <div class="flex justify-end">
          <PxButton variant="primary" icon="send" :disabled="!draft.trim()" :loading="submitting && !replyTo" :sfx="false" @click="submit()">
            发表
          </PxButton>
        </div>
      </div>
    </div>
    <p v-else class="flex items-center gap-2 text-dim">
      <PxButton size="sm" variant="primary" icon="play" to="/login">读取存档</PxButton>
      后参与留言
    </p>

    <div v-if="isLoading" class="mt-5 flex flex-col gap-3">
      <PxSkeleton v-for="i in 2" :key="i" class="h-16" />
    </div>

    <PxEmpty v-else-if="comments.length === 0" icon="comment" title="还没有留言，来抢沙发。" />

    <ul v-else class="mt-5 flex flex-col gap-5">
      <li v-for="c in comments" :key="c.id" class="flex items-start gap-3">
        <NuxtLink :to="`/u/${c.author.handle}`" class="shrink-0">
          <PxAvatar :src="c.author.avatarUrl" :seed="c.author.handle" :size="32" />
        </NuxtLink>
        <div class="min-w-0 flex-1">
          <div class="bubble">
            <p class="flex flex-wrap items-baseline gap-x-2">
              <NuxtLink :to="`/u/${c.author.handle}`" class="text-amber hover:underline">{{ c.author.displayName }}</NuxtLink>
              <span class="font-logo text-[8px] text-faint">{{ fmtTime(c.createdAt) }}</span>
            </p>
            <div v-if="editing?.id === c.id" class="mt-2 flex items-center gap-2">
              <PxInput v-model="editDraft" size="sm" class="flex-1" @keyup.enter="editMutation.mutate(c)" />
              <PxButton size="sm" variant="primary" :loading="editMutation.isPending.value" @click="editMutation.mutate(c)">保存</PxButton>
              <PxButton size="sm" variant="ghost" @click="editing = null">取消</PxButton>
            </div>
            <p v-else class="mt-1 whitespace-pre-wrap break-words text-fg">{{ c.body }}</p>
          </div>

          <div class="mt-1 flex items-center gap-1">
            <PxButton size="sm" variant="ghost" :icon="c.viewerState?.liked ? 'heart' : 'heart-o'" :class="c.viewerState?.liked && '!text-pink'" :sfx="false" @click="likeComment(c)">
              <span class="font-logo text-[8px]">{{ c.likeCount }}</span>
            </PxButton>
            <PxButton v-if="auth.isAuthenticated" size="sm" variant="ghost" icon="reply" @click="replyTo = replyTo?.id === c.id ? null : c">
              <span class="font-logo text-[8px]">{{ c.replyCount }}</span>
            </PxButton>
            <template v-if="isMine(c)">
              <PxButton size="sm" variant="ghost" square icon="pencil" title="编辑" @click="editing = c; editDraft = c.body" />
              <PxButton size="sm" variant="ghost" square icon="trash" title="删除" class="hover:!text-red" @click="deleteMutation.mutate(c)" />
            </template>
          </div>

          <!-- 回复（一层） -->
          <ul v-if="c.replies?.length" class="mt-2 flex flex-col gap-2 border-l-2 border-dashed border-line pl-4">
            <li v-for="r in c.replies" :key="r.id" class="flex items-start gap-2">
              <PxAvatar :src="r.author.avatarUrl" :seed="r.author.handle" :size="20" />
              <div class="min-w-0">
                <p class="flex flex-wrap items-baseline gap-x-2">
                  <span class="text-amber">{{ r.author.displayName }}</span>
                  <span class="font-logo text-[8px] text-faint">{{ fmtTime(r.createdAt) }}</span>
                </p>
                <p class="whitespace-pre-wrap break-words text-fg">{{ r.body }}</p>
              </div>
            </li>
          </ul>

          <form v-if="replyTo?.id === c.id" class="mt-2 flex items-center gap-2" @submit.prevent="submitReply()">
            <PxInput v-model="replyDraft" size="sm" :placeholder="`回复 ${c.author.displayName}…`" class="flex-1" />
            <PxButton type="submit" size="sm" variant="primary" :loading="submitting" :sfx="false">回复</PxButton>
          </form>
        </div>
      </li>
    </ul>

    <InfiniteLoader
      v-if="comments.length"
      :has-next-page="hasNextPage"
      :is-fetching-next-page="isFetchingNextPage"
      :error="isError"
      ended-text="NO MORE"
      @load="fetchNextPage()"
    />
  </PxPanel>
</template>

<style scoped>
.bubble {
  position: relative;
  padding: 8px 12px 10px;
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--hi);
}
/* 气泡尾巴：指向左边的头像 */
.bubble::before {
  content: "";
  position: absolute;
  left: -8px;
  top: 10px;
  width: 6px;
  height: 6px;
  background: var(--panel-lo);
  box-shadow: 0 -2px 0 0 var(--ink), -2px 0 0 0 var(--ink), 0 2px 0 0 var(--ink);
}
</style>
