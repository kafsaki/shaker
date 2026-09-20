<script setup lang="ts">
/** 酒单堆叠封面：position 前 3 条目的配方封面，横向平行堆叠（无旋转），
 *  最左边在最上层；偏移量按张数均分，保证整体恰好占满容器宽度。
 *  注意：根节点不写宽度类，宽度由调用方传入（w-full 会与 w-20 等同优先级冲突且后者可能输掉）。 */
const props = withDefaults(defineProps<{ covers?: string[] | null }>(), { covers: () => [] });

const list = computed(() => (props.covers ?? []).slice(0, 3));

function styleFor(i: number, n: number) {
  if (n === 1) return { left: "0%", width: "100%", zIndex: 1 };
  const w = 62; // 单张宽度占比
  const step = (100 - w) / (n - 1); // n=2 → 38%，n=3 → 19%，最右一张右缘顶到 100%
  return { left: `${i * step}%`, width: `${w}%`, zIndex: n - i };
}
</script>

<template>
  <div class="relative aspect-square overflow-hidden rounded-lg">
    <img
      v-for="(c, i) in list"
      :key="`${i}-${c}`"
      :src="c"
      alt=""
      loading="lazy"
      class="absolute inset-y-0 h-full rounded-md border border-border bg-card object-cover shadow-md"
      :style="styleFor(i, list.length)"
    >
    <div
      v-if="!list.length"
      class="absolute inset-0 flex items-center justify-center border border-dashed border-border bg-gradient-to-br from-primary/15 via-primary/5 to-accent/40"
    >
      <span class="text-xs text-muted-foreground">空酒单</span>
    </div>
  </div>
</template>
