<script setup lang="ts">
/**
 * 物品格：背包里的一格凹槽，中间放大号品类图标。
 * 图标的副色（瓶身里的液体、果肉）用原料自己的 viz.color 上色，同一品类也能一眼分出是哪瓶；
 * 没有颜色的原料（冰、装饰）保留默认的半透明副色。corner 是右下角的读数角标（ABV 之类）。
 */
import { CATEGORY_ICON } from "@/lib/game";

// size：格子边长（px），默认是图标的 2 倍宽，图标占满半格——太空的格子读起来不像物品栏
const props = withDefaults(
  defineProps<{ category: string; color?: string | null; scale?: number; size?: number; corner?: string | null }>(),
  { color: null, scale: 4, size: undefined, corner: null },
);

const icon = computed(() => CATEGORY_ICON[props.category] ?? "question");
const box = computed(() => `${props.size ?? 9 * props.scale * 2}px`);
const tint = computed(() =>
  props.color ? { "--px-icon-2": props.color, "--px-icon-2-alpha": "1" } : undefined,
);
</script>

<template>
  <span class="slot" :style="{ width: box }">
    <span class="grid-bg" aria-hidden="true" />
    <span class="ic" :style="tint"><PxIcon :name="icon" :scale="scale" /></span>
    <span v-if="corner" class="corner">{{ corner }}</span>
  </span>
</template>

<style scoped>
.slot {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  aspect-ratio: 1;
  background: var(--deep);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset calc(var(--p) * 2) calc(var(--p) * 2) 0 0 var(--lo),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--hi);
}
/* 槽底的十字定位点（像物品栏的格子底纹），硬边小方块 */
.grid-bg {
  position: absolute;
  inset: 6px;
  background:
    linear-gradient(var(--line), var(--line)) left top / 4px var(--p) no-repeat,
    linear-gradient(var(--line), var(--line)) left top / var(--p) 4px no-repeat,
    linear-gradient(var(--line), var(--line)) right top / 4px var(--p) no-repeat,
    linear-gradient(var(--line), var(--line)) right top / var(--p) 4px no-repeat,
    linear-gradient(var(--line), var(--line)) left bottom / 4px var(--p) no-repeat,
    linear-gradient(var(--line), var(--line)) left bottom / var(--p) 4px no-repeat,
    linear-gradient(var(--line), var(--line)) right bottom / 4px var(--p) no-repeat,
    linear-gradient(var(--line), var(--line)) right bottom / var(--p) 4px no-repeat;
}
.ic {
  position: relative;
  display: grid;
  color: var(--fg);
  filter: drop-shadow(var(--p) var(--p) 0 var(--ink));
}
.corner {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 3px 4px;
  background: var(--ink);
  color: var(--amber-hi);
  font-family: var(--font-logo);
  font-size: 8px;
  line-height: 1;
}
</style>
