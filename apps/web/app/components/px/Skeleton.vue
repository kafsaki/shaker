<template>
  <!-- 骨架屏：抖动网点 + 步进闪烁（不做平滑 shimmer） -->
  <div class="px-skel px-dither" aria-hidden="true" />
</template>

<style scoped>
.px-skel {
  --dither: var(--line);
  background-color: var(--panel-lo);
  animation: skel 1.2s steps(2) infinite;
}
@keyframes skel {
  50% { opacity: 0.55; }
}
</style>
