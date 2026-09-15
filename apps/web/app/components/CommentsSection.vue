<script setup lang="ts">
/**
 * 评论区：顶层评论 + 每条前几条回复（一层回复，规范 §2.4）。
 * 发评论 / 回复 / 点赞 / 编辑 / 删除自己的评论。
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { Heart, Pencil, Reply, Trash2 } from "lucide-vue-next";
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Comment = components["schemas"]["CommentBody"];

const props = defineProps<{ recipeId: string }>();

const auth = useAuthStore();
const api = useApi();
const qc = useQueryClient();

const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: computed(() => ["comments", props.recipeId] as const),
    queryFn: async ({ pageParam }): Promise<Comment[]> => {
      const cursor = pageParam || undefined;
      const { data, error } = await api.GET(
        "/api/v1/recipes/{id}/comments",
        { params: { path: { id: props.recipeId }, query: { cursor } } },
      );
      if (error) throw error;
      return data.items ?? [];
    },
    initialPageParam: "",
    getNextPageParam: (last) =>
      last.length > 0 ? last[last.length - 1]?.id : undefined,
  });

const comments = computed(() => data.value?.pages.flat() ?? []);

/* ── 发表 ── */
const draft = ref("");
const replyTo = ref<Comment | null>(null);
const replyDraft = ref("");
const submitting = ref(false);

async function submit(): Promise<void> {
  if (!draft.value.trim()) return;
  submitting.value = true;
  try {
    const { error } = await api.POST("/api/v1/recipes/{id}/comments", {
      params: { path: { id: props.recipeId } },
      body: { body: draft.value.trim() },
    });
    if (error) throw error;
    draft.value = "";
    void qc.invalidateQueries({ queryKey: ["comments"] });
  } catch (err) {
    toast.error(apiErrorMessage(err));
  } finally {
    submitting.value = false;
  }
}

async function submitReply(): Promise<void> {
  if (!replyTo.value || !replyDraft.value.trim()) return;
  submitting.value = true;
  try {
    const { error } = await api.POST("/api/v1/recipes/{id}/comments", {
      params: { path: { id: props.recipeId } },
      body: { body: replyDraft.value.trim(), parentId: replyTo.value.id },
    });
    if (error) throw error;
    replyDraft.value = "";
    replyTo.value = null;
    void qc.invalidateQueries({ queryKey: ["comments"] });
  } catch (err) {
    toast.error(apiErrorMessage(err));
  } finally {
    submitting.value = false;
  }
}

/* ── 点赞 / 编辑 / 删除 ── */
const likeMutation = useMutation({
  mutationFn: async (c: Comment) => {
    const on = !(c.viewerState?.liked ?? false);
    if (on) {
      const { error } = await api.PUT("/api/v1/comments/{id}/like", {
        params: { path: { id: c.id } },
      });
      if (error) throw error;
    } else {
      const { error } = await api.DELETE("/api/v1/comments/{id}/like", {
        params: { path: { id: c.id } },
      });
      if (error) throw error;
    }
    return on;
  },
  onMutate: (c) => {
    const on = !(c.viewerState?.liked ?? false);
    c.viewerState = { liked: on };
    c.likeCount += on ? 1 : -1;
  },
  onError: (err, c) => {
    const on = !(c.viewerState?.liked ?? false);
    c.viewerState = { liked: !on };
    c.likeCount += on ? -1 : 1;
    toast.error(apiErrorMessage(err));
  },
});

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
    const { error } = await api.DELETE("/api/v1/comments/{id}", {
      params: { path: { id: c.id } },
    });
    if (error) throw error;
    return c;
  },
  onSuccess: () => {
    toast.success("已删除");
    void qc.invalidateQueries({ queryKey: ["comments"] });
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const isMine = (c: Comment): boolean =>
  auth.user !== null && c.author.handle === auth.user.handle;
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-base">评论</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <!-- 发表框 -->
      <div v-if="auth.isAuthenticated" class="flex flex-col gap-2">
        <Textarea
          v-model="draft"
          placeholder="聊聊这杯酒…"
          :maxlength="2000"
          class="min-h-16"
        />
        <div class="flex justify-end">
          <Button size="sm" :disabled="submitting || !draft.trim()" @click="submit()">
            发表
          </Button>
        </div>
      </div>
      <p v-else class="text-sm text-muted-foreground">
        <NuxtLink to="/login" class="text-primary underline-offset-4 hover:underline">登录</NuxtLink>
        后参与评论
      </p>

      <div v-if="isLoading" class="flex flex-col gap-3">
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>

      <p v-else-if="comments.length === 0" class="py-2 text-center text-sm text-muted-foreground">
        还没有评论，来抢沙发。
      </p>

      <!-- 评论列表 -->
      <div v-else class="flex flex-col gap-4">
        <div v-for="c in comments" :key="c.id" class="flex flex-col gap-2">
          <div class="flex items-start gap-3">
            <Avatar class="size-8 shrink-0">
              <AvatarImage v-if="c.author.avatarUrl" :src="c.author.avatarUrl" />
              <AvatarFallback class="text-xs">{{ c.author.displayName.slice(0, 1) }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2 text-sm">
                <span class="font-medium">{{ c.author.displayName }}</span>
                <span class="text-xs text-muted-foreground">{{ fmtTime(c.createdAt) }}</span>
              </div>

              <!-- 编辑态 -->
              <div v-if="editing?.id === c.id" class="mt-1.5 flex items-center gap-2">
                <Input v-model="editDraft" class="h-8" />
                <Button size="sm" :disabled="editMutation.isPending.value" @click="editMutation.mutate(c)">
                  保存
                </Button>
                <Button size="sm" variant="ghost" @click="editing = null">取消</Button>
              </div>
              <p v-else class="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{{ c.body }}</p>

              <!-- 操作 -->
              <div class="mt-1.5 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 gap-1 px-2 text-xs"
                  @click="likeMutation.mutate(c)"
                >
                  <Heart class="size-3" :class="c.viewerState?.liked ? 'fill-current' : ''" />
                  {{ c.likeCount }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 gap-1 px-2 text-xs"
                  @click="replyTo = replyTo?.id === c.id ? null : c"
                >
                  <Reply class="size-3" />
                  {{ c.replyCount }}
                </Button>
                <template v-if="isMine(c)">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 gap-1 px-2 text-xs"
                    @click="editing = c; editDraft = c.body"
                  >
                    <Pencil class="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 gap-1 px-2 text-xs text-destructive"
                    @click="deleteMutation.mutate(c)"
                  >
                    <Trash2 class="size-3" />
                  </Button>
                </template>
              </div>

              <!-- 回复（一层） -->
              <div v-if="c.replies?.length" class="mt-2 flex flex-col gap-2 border-l-2 border-border pl-3">
                <div v-for="r in c.replies" :key="r.id" class="text-sm">
                  <div class="flex items-baseline gap-2">
                    <span class="font-medium">{{ r.author.displayName }}</span>
                    <span class="text-xs text-muted-foreground">{{ fmtTime(r.createdAt) }}</span>
                  </div>
                  <p class="whitespace-pre-wrap leading-relaxed">{{ r.body }}</p>
                </div>
              </div>

              <!-- 回复输入 -->
              <div v-if="replyTo?.id === c.id" class="mt-2 flex items-center gap-2">
                <Input
                  v-model="replyDraft"
                  placeholder="回复…"
                  class="h-8"
                  @keyup.enter="submitReply()"
                />
                <Button size="sm" :disabled="submitting" @click="submitReply()">回复</Button>
              </div>
            </div>
          </div>
          <Separator class="last:hidden" />
        </div>

        <div v-if="hasNextPage" class="flex justify-center">
          <Button variant="outline" :disabled="isFetchingNextPage" @click="fetchNextPage()">
            {{ isFetchingNextPage ? "加载中…" : "更多评论" }}
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
