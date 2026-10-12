<script setup lang="ts">
/**
 * 用户主页 · 酒单分栏。
 * 自己与他人同一布局：一个酒单占一整行（MenuRow：卡叠封面 + 配方窄卡货架），
 * 「查看酒单」跳 /menus/{id} 详情页。本人额外可见私密酒单并可新建。
 * 数据源统一 /users/{handle}/menus（本人视角服务端返回全部含私密）。
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { toast } from "@/lib/toast";

type Page = components["schemas"]["MenuListOutputBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const qc = useQueryClient();
const handle = computed(() => String(route.params.handle ?? ""));
const isSelf = computed(() => !!auth.user && auth.user.handle === handle.value);

const VIS_OPTIONS = [
  { value: "private", label: "私密（仅自己）" },
  { value: "public", label: "公开" },
];

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
      <h2 class="flex items-center gap-2 text-dim">
        <PxIcon name="list" :scale="2" class="text-amber" />
        {{ isSelf ? "我的酒单" : "酒单" }}
        <span v-if="menus.length" class="font-logo text-[8px] text-faint">{{ menus.length }}{{ hasNextPage ? "+" : "" }}</span>
      </h2>
      <PxButton v-if="isSelf" variant="primary" icon="plus" @click="open = true">新建酒单</PxButton>
    </div>

    <div v-if="isLoading" class="flex flex-col gap-4">
      <PxSkeleton v-for="i in 2" :key="i" class="h-56" />
    </div>

    <template v-else>
      <div v-if="menus.length" class="flex flex-col gap-4">
        <MenuRow v-for="m in menus" :key="m.id" :menu="m" :show-owner="false" :show-visibility="isSelf" />
      </div>

      <PxEmpty v-else-if="isError" icon="warn" tone="red" title="加载失败，请稍后重试" />
      <PxEmpty
        v-else
        icon="list"
        :title="isSelf ? '还没有酒单。也可以在配方页点「收藏」直接加入。' : '还没有公开酒单'"
      >
        <PxButton v-if="isSelf" icon="plus" @click="open = true">新建酒单</PxButton>
      </PxEmpty>

      <InfiniteLoader
        :has-next-page="hasNextPage"
        :is-fetching-next-page="isFetchingNextPage"
        :error="isError"
        :ended-text="menus.length ? 'THE END' : null"
        @load="fetchNextPage()"
      />
    </template>

    <PxDialog
      v-if="isSelf"
      v-model:open="open"
      title="新建酒单"
      description="把喜欢的配方收进一份酒单"
      icon="list"
      size="sm"
    >
      <form id="menu-create-form" class="flex flex-col gap-3" @submit.prevent="title.trim() && create.mutate()">
        <div class="flex flex-col gap-1">
          <span class="text-dim">名称</span>
          <PxInput v-model="title" maxlength="60" placeholder="家里能做的十杯" />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-dim">可见性</span>
          <PxSelect
            :model-value="visibility"
            :options="VIS_OPTIONS"
            @update:model-value="(v) => (visibility = v === 'public' ? 'public' : 'private')"
          />
        </div>
      </form>
      <template #footer>
        <PxButton @click="open = false">取消</PxButton>
        <PxButton
          type="submit"
          form="menu-create-form"
          variant="primary"
          icon="check"
          :disabled="!title.trim()"
          :loading="create.isPending.value"
        >
          创建
        </PxButton>
      </template>
    </PxDialog>
  </div>
</template>
