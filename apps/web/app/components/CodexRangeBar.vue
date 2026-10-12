<script setup lang="ts">
/**
 * 图鉴区间条（经典条目的社区共识分布）：深色凹槽 + p10~p90 实色块 + 中位刻度。
 * 全部硬边方块：槽内每 10% 一道刻线当「格子」，读起来像 RPG 属性槽而不是网页进度条。
 * left / width / median 都是 0~100 的百分比，由页面按最大 p90 归一化后传入。
 */
// empty：该原料没有 ml 用量（盐边、装饰），只画空槽
const props = withDefaults(
  defineProps<{ left: number; width: number; median: number; size?: "sm" | "lg"; empty?: boolean }>(),
  { size: "sm", empty: false },
);

// 区间极窄（所有变体用量一致）时也要看得见，最少给 1.5% 宽
const fillStyle = computed(() => ({
  left: `${Math.min(props.left, 98.5)}%`,
  width: `${Math.max(props.width, 1.5)}%`,
}));
const tickStyle = computed(() => ({ left: `${Math.min(Math.max(props.median, 0), 100)}%` }));
</script>

<template>
  <div class="trough" :class="`s-${size}`" role="presentation">
    <template v-if="!empty">
      <span class="fill" :style="fillStyle" />
      <span class="tick" :style="tickStyle" />
    </template>
  </div>
</template>

<style scoped>
.trough {
  position: relative;
  height: 10px;
  margin: var(--p) 0;
  background-color: var(--deep);
  /* 每 10% 一道刻线（硬边色标，不是渐变过渡） */
  background-image: repeating-linear-gradient(
    to right,
    transparent 0 calc(10% - var(--p)),
    var(--line) calc(10% - var(--p)) 10%
  );
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--lo);
}
.s-lg { height: 18px; }
.fill {
  position: absolute;
  top: var(--p);
  bottom: var(--p);
  background: var(--amber);
  box-shadow:
    inset 0 var(--p) 0 0 var(--amber-hi),
    inset 0 calc(var(--p) * -1) 0 0 var(--amber-lo);
}
.tick {
  position: absolute;
  top: calc(var(--p) * -2);
  bottom: calc(var(--p) * -2);
  width: calc(var(--p) * 2);
  translate: calc(var(--p) * -1) 0;
  background: var(--fg);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.s-lg .tick { top: calc(var(--p) * -3); bottom: calc(var(--p) * -3); }
</style>
