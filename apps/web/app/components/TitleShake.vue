<script setup lang="ts">
/**
 * 失败抖动容器：trigger 每变一次，内容就横向抖一下（读档失败 / 创建角色失败）。
 * 同一个 class 连续挂两次不会重播动画，所以先摘掉、强制回流、再挂上——每次失败都能抖。
 */
const props = defineProps<{ trigger: number }>();
const el = ref<HTMLElement | null>(null);

watch(
  () => props.trigger,
  () => {
    const node = el.value;
    if (!node) return;
    node.classList.remove("animate-shake");
    void node.offsetWidth;
    node.classList.add("animate-shake");
  },
);

// 子元素的动画结束事件也会冒泡上来，只认自己的
function onEnd(e: AnimationEvent): void {
  if (e.target === e.currentTarget) el.value?.classList.remove("animate-shake");
}
</script>

<template>
  <div ref="el" @animationend="onEnd">
    <slot />
  </div>
</template>
