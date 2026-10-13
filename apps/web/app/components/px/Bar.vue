<script setup lang="ts">
/** 分格能量条（RPG 属性条）：value / max，按 cells 格渲染，满格亮、空格暗。 */
const props = withDefaults(
  defineProps<{
    value: number;
    max?: number;
    cells?: number;
    tone?: "amber" | "pink" | "cyan" | "green" | "red" | "gold";
    cellWidth?: number;
  }>(),
  { max: 5, tone: "amber", cellWidth: 10 },
);
const n = computed(() => props.cells ?? Math.min(props.max, 20));
const lit = computed(() => Math.round((Math.max(0, Math.min(props.value, props.max)) / props.max) * n.value));
</script>

<template>
  <span class="px-bar" :class="`t-${tone}`" role="meter" :aria-valuenow="value" :aria-valuemax="max">
    <i v-for="i in n" :key="i" :class="{ on: i <= lit }" :style="{ width: `${cellWidth}px` }" />
  </span>
</template>

<style scoped>
.px-bar {
  --c: var(--amber);
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--ink);
}
.t-pink { --c: var(--pink); }
.t-cyan { --c: var(--cyan); }
.t-green { --c: var(--green); }
.t-red { --c: var(--red); }
.t-gold { --c: var(--gold); }
.px-bar i {
  height: 10px;
  background: var(--panel-lo);
}
.px-bar i.on {
  background: var(--c);
  box-shadow: inset 0 2px 0 0 rgb(255 255 255 / 0.35), inset 0 -2px 0 0 rgb(0 0 0 / 0.25);
}
</style>
