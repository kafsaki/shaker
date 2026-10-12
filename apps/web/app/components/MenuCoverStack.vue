<script setup lang="ts">
/** 酒单堆叠封面（像一叠收藏卡）：position 前 3 条目的配方封面，横向平行堆叠（无旋转），
 *  最左边在最上层；偏移量按张数均分，保证整体恰好占满容器宽度。
 *  每张卡 ink 描边 + 硬投影；描边与投影画在盒外，所以内层留出边距，不被根节点的 overflow 裁掉。
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
  <div class="mcs relative aspect-square overflow-hidden">
    <div class="deck">
      <img
        v-for="(c, i) in list"
        :key="`${i}-${c}`"
        :src="c"
        alt=""
        loading="lazy"
        class="card"
        :style="styleFor(i, list.length)"
      >
      <div v-if="!list.length" class="empty px-dither">
        <PxIcon name="list" :scale="3" />
        <span>空酒单</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 上/左留 1 格给描边，右/下留 3 格给描边 + 硬投影 */
.deck {
  position: absolute;
  inset: var(--p) calc(var(--p) * 3) calc(var(--p) * 3) var(--p);
}
.card {
  position: absolute;
  top: 0;
  bottom: 0;
  height: 100%;
  object-fit: cover;
  object-position: 50% 100%;
  background: var(--panel-lo);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    calc(var(--p) * 2) calc(var(--p) * 2) 0 0 var(--shadow);
}
.empty {
  --dither: var(--line);
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background-color: var(--panel-lo);
  color: var(--faint);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.empty span {
  padding: 0 6px;
  background: var(--panel-lo);
  color: var(--dim);
}
</style>
