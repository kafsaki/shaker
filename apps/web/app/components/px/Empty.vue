<script setup lang="ts">
/** 空态 / 错误态：大号图标 + 一句话 + 可选动作。 */
import type { PixelIconName } from "@/lib/pixel-icons";

withDefaults(
  defineProps<{ icon?: PixelIconName; title: string; tone?: "dim" | "red" }>(),
  { icon: "martini", tone: "dim" },
);
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-4 py-12 text-center">
    <PxIcon :name="icon" :scale="5" :class="tone === 'red' ? 'text-red' : 'text-faint'" />
    <p :class="tone === 'red' ? 'text-red' : 'text-dim'">{{ title }}</p>
    <div v-if="$slots.default" class="flex flex-wrap items-center justify-center gap-2 text-dim">
      <slot />
    </div>
  </div>
</template>
