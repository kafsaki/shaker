<script setup lang="ts">
/** 无限滚动哨兵：滚动接近底部时自动拉取下一页，底部显示读条 / 到底提示。
 *  用 watch 而非 IntersectionObserver 回调：哨兵停在同一屏内且上一页刚结束时，
 *  交集状态不会再次变化，靠 watch 才能继续补齐（内容不满一屏的常见情况）。 */
import { useElementVisibility } from "@vueuse/core";

const props = withDefaults(
  defineProps<{
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    /** 请求出错时置 true：暂停自动加载（避免失败后无限重试），改为点击重试。 */
    error?: boolean;
    /** 到底后的提示文案；传 null 则什么都不显示。 */
    endedText?: string | null;
  }>(),
  { error: false, endedText: "THE END" },
);

const emit = defineEmits<{ load: [] }>();

const sentinel = ref<HTMLElement | null>(null);
// 提前 240px 开始加载，滚动到底前内容已就位
const isIntersecting = useElementVisibility(sentinel, { rootMargin: "240px 0px" });

watch(
  [isIntersecting, () => props.isFetchingNextPage, () => props.hasNextPage, () => props.error],
  () => {
    if (!isIntersecting.value || props.error) return;
    if (!props.hasNextPage || props.isFetchingNextPage) return;
    emit("load");
  },
  { immediate: true },
);
</script>

<template>
  <div ref="sentinel" class="flex items-center justify-center py-6">
    <p v-if="isFetchingNextPage" class="flex items-center gap-2 text-dim">
      <PxIcon name="shaker" :scale="2" class="animate-bob text-amber" />
      <span class="font-logo text-[8px] tracking-[0.2em]">LOADING<span class="animate-blink">...</span></span>
    </p>
    <PxButton v-else-if="error" size="sm" icon="replay" variant="danger" @click="emit('load')">
      加载失败，再试一次
    </PxButton>
    <p v-else-if="!hasNextPage && endedText" class="flex items-center gap-3 text-faint">
      <span class="h-0.5 w-10 bg-line" />
      <span class="font-logo text-[8px] tracking-[0.25em]">{{ endedText }}</span>
      <span class="h-0.5 w-10 bg-line" />
    </p>
  </div>
</template>
