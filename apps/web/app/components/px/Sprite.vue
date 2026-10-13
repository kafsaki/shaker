<script setup lang="ts">
/** 通用调色板 sprite：字符点阵 + 字符→颜色映射，按 scale 整数倍放大（立绘、招牌、装饰）。 */
const props = withDefaults(
  defineProps<{ rows: readonly string[]; palette: Record<string, string>; scale?: number }>(),
  { scale: 4 },
);

const layers = computed(() => {
  const byColor = new Map<string, string>();
  props.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      const color = props.palette[c];
      if (!color) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === c) w++;
      byColor.set(color, (byColor.get(color) ?? "") + `M${x} ${y}h${w}v1h-${w}z`);
      x += w;
    }
  });
  return [...byColor.entries()].map(([fill, d]) => ({ fill, d }));
});

const w = computed(() => (props.rows[0]?.length ?? 0));
const h = computed(() => props.rows.length);
</script>

<template>
  <svg
    :width="w * scale"
    :height="h * scale"
    :viewBox="`0 0 ${w} ${h}`"
    shape-rendering="crispEdges"
    aria-hidden="true"
    class="block shrink-0"
  >
    <path v-for="l in layers" :key="l.fill" :d="l.d" :fill="l.fill" />
  </svg>
</template>
