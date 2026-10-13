<script setup lang="ts">
/** 像素图标：9×9 点阵 × scale 倍（默认 2 → 18px）。颜色跟随 currentColor。 */
import { iconPaths, PIXEL_ICONS, type PixelIconName } from "@/lib/pixel-icons";

const props = withDefaults(defineProps<{ name: PixelIconName; scale?: number }>(), {
  scale: 2,
});

const cache = new Map<string, { main: string; sub: string }>();

const paths = computed(() => {
  const hit = cache.get(props.name);
  if (hit) return hit;
  const rows = PIXEL_ICONS[props.name] ?? PIXEL_ICONS.question;
  const p = iconPaths(rows);
  cache.set(props.name, p);
  return p;
});

const px = computed(() => 9 * props.scale);
</script>

<template>
  <svg
    :width="px"
    :height="px"
    viewBox="0 0 9 9"
    shape-rendering="crispEdges"
    aria-hidden="true"
    class="inline-block shrink-0"
  >
    <!-- 属性值里不解析 var()，副色走 style -->
    <path
      :d="paths.sub"
      style="fill: var(--px-icon-2, currentColor); fill-opacity: var(--px-icon-2-alpha, 0.4)"
    />
    <path :d="paths.main" fill="currentColor" />
  </svg>
</template>
