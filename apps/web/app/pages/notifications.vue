<script setup lang="ts">
/**
 * 信箱：每条通知是一封信。未读 = 亮色 + 琥珀信封 + NEW，已读 = 暗淡。
 * 点一封未读信即标读；指向配方的信点开直接跳过去。
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import type { PixelIconName } from "@/lib/pixel-icons";
import { toast } from "@/lib/toast";

type Notice = components["schemas"]["NotificationBody"];
type NoticesPage = components["schemas"]["NotificationListOutputBody"];

definePageMeta({ middleware: "auth" });
useHead({ title: "信箱 · Shaker" });

const api = useApi();
const qc = useQueryClient();
const { play } = useSfx();

const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: ["notifications"],
    // 游标是服务端编码的不透明串，必须原样回传（传通知 id 会被判 cursor.invalid）
    queryFn: async ({ pageParam }): Promise<NoticesPage> => {
      const cursor = pageParam || undefined;
      const { data, error } = await api.GET("/api/v1/notifications", {
        params: { query: { cursor } },
      });
      if (error) throw error;
      return data;
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

const notices = computed(
  () => data.value?.pages.flatMap((p) => p.items ?? []) ?? [],
);
/** 已加载部分里的未读数（标题栏读数；全量未读数归 HUD 的角标管）。 */
const unread = computed(() => notices.value.filter((n) => !n.readAt).length);

const markAll = useMutation({
  mutationFn: async () => {
    const { error } = await api.POST("/api/v1/notifications/read", { body: {} });
    if (error) throw error;
  },
  onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    toast.success("已全部标为已读");
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

const markOne = useMutation({
  mutationFn: async (n: Notice) => {
    const { error } = await api.POST("/api/v1/notifications/read", {
      body: { ids: [n.id] },
    });
    if (error) throw error;
    return n;
  },
  onSuccess: (n) => {
    n.readAt = new Date().toISOString();
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

function open(n: Notice): void {
  if (n.readAt) return;
  play("open");
  markOne.mutate(n);
}

const TYPE_TEXT: Record<string, string> = {
  like: "赞了你的配方",
  comment: "评论了你的配方",
  reply: "回复了你的评论",
  follow: "关注了你",
  mention: "提及了你",
  system: "系统通知",
};
/** 信件类型角标（头像右下角的小印章）。 */
const TYPE_ICON: Record<string, { icon: PixelIconName; tone: string }> = {
  like: { icon: "heart", tone: "pink" },
  comment: { icon: "comment", tone: "cyan" },
  reply: { icon: "reply", tone: "cyan" },
  follow: { icon: "user", tone: "green" },
  mention: { icon: "sparkle", tone: "amber" },
  system: { icon: "info", tone: "gold" },
};

function targetLink(n: Notice): string | null {
  if (n.entityType === "recipe" && n.entityId) return `/recipes/${n.entityId}`;
  return null;
}

// 纯数字格式：时间用 font-logo 渲染，8px 像素字没有中文字形
function fmt(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <PxPanel title="信箱" icon="mail" tone="amber" :padded="false">
      <template #actions>
        <span v-if="unread" class="font-logo text-[8px] text-amber max-sm:!hidden">{{ unread }} NEW</span>
        <PxButton
          size="sm"
          icon="check"
          :disabled="markAll.isPending.value || notices.length === 0"
          :loading="markAll.isPending.value"
          sfx="confirm"
          @click="markAll.mutate()"
        >
          全部已读
        </PxButton>
      </template>

      <div v-if="isLoading" class="flex flex-col gap-2 p-3">
        <PxSkeleton v-for="i in 5" :key="i" class="h-14" />
      </div>

      <PxEmpty v-else-if="isError && notices.length === 0" icon="warn" tone="red" title="信件读取失败，请稍后重试" />

      <PxEmpty v-else-if="notices.length === 0" icon="mail" title="信箱空空的，还没有人给你写信。" />

      <ul v-else class="flex flex-col gap-2 p-3">
        <li v-for="n in notices" :key="n.id">
          <component
            :is="targetLink(n) ? 'NuxtLink' : 'div'"
            v-bind="targetLink(n) ? { to: targetLink(n)! } : {}"
            class="letter"
            :class="n.readAt ? 'read' : 'unread'"
            @click="open(n)"
          >
            <span class="env" :title="n.readAt ? '已读' : '未读'">
              <PxIcon name="mail" :scale="2" />
            </span>
            <span class="relative shrink-0">
              <PxAvatar :seed="n.actor.handle" :size="32" />
              <span class="stamp" :class="`t-${TYPE_ICON[n.type]?.tone ?? 'amber'}`">
                <PxIcon :name="TYPE_ICON[n.type]?.icon ?? 'mail'" :scale="1" />
              </span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate">
                <span class="actor">{{ n.actor.displayName }}</span>
                <span class="text-dim">{{ TYPE_TEXT[n.type] ?? n.type }}</span>
              </span>
              <span class="block font-logo text-[8px] text-faint">{{ fmt(n.createdAt) }}</span>
            </span>
            <span v-if="!n.readAt" class="new font-logo">NEW</span>
            <PxIcon v-if="targetLink(n)" name="chevron-right" :scale="1" class="go" />
          </component>
        </li>
      </ul>
    </PxPanel>

    <InfiniteLoader
      v-if="notices.length"
      :has-next-page="hasNextPage"
      :is-fetching-next-page="isFetchingNextPage"
      :error="isError"
      ended-text="NO MORE MAIL"
      @load="fetchNextPage()"
    />
  </div>
</template>

<style scoped>
.letter {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 10px;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.letter.unread {
  background: var(--panel-hi);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset calc(var(--p) * 2) 0 0 0 var(--amber),
    inset 0 var(--p) 0 0 var(--hi),
    calc(var(--p) * 2) calc(var(--p) * 2) 0 0 var(--shadow);
}
.letter.read { opacity: 0.6; }
.letter:hover { opacity: 1; background: var(--panel-hi); }
.letter:hover .actor { text-decoration: underline; }
.letter:hover .go { color: var(--amber); }

.env {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  background: var(--deep);
  color: var(--faint);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.unread .env {
  color: var(--amber);
  --px-icon-2: var(--amber-hi);
  --px-icon-2-alpha: 1;
}
.unread:hover .env { animation: px-bob 1.2s steps(2) infinite; }
.actor { margin-right: 6px; color: var(--fg); }
.unread .actor { color: var(--amber); }

.stamp {
  --c: var(--amber);
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  background: var(--c);
  color: var(--on-accent);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.stamp.t-pink { --c: var(--pink); }
.stamp.t-cyan { --c: var(--cyan); }
.stamp.t-green { --c: var(--green); }
.stamp.t-gold { --c: var(--gold); }

.new {
  flex-shrink: 0;
  padding: 3px 5px;
  font-size: 8px;
  background: var(--pink);
  color: var(--on-accent);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.3);
}
.go { color: var(--faint); flex-shrink: 0; }
</style>
