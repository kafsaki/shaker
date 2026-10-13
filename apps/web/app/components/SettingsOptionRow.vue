<script setup lang="ts">
/** 游戏 OPTIONS 菜单的一行：左边选项名 + 一句说明，右边开关（默认插槽）。窄屏时开关落到下一行。 */
import type { PixelIconName } from "@/lib/pixel-icons";

defineProps<{ label: string; desc?: string; icon?: PixelIconName }>();
</script>

<template>
  <div class="opt-row flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
    <div class="flex min-w-0 flex-1 items-start gap-2">
      <PxIcon v-if="icon" :name="icon" :scale="2" class="mt-0.5 shrink-0 text-amber" />
      <div class="min-w-0">
        <p class="text-fg">{{ label }}</p>
        <p v-if="desc" class="text-faint">{{ desc }}</p>
      </div>
    </div>
    <div class="shrink-0"><slot /></div>
  </div>
</template>

<style scoped>
/* 行间用虚线隔开，最后一行不画 */
.opt-row + .opt-row {
  border-top: var(--p) dashed var(--line);
}
</style>
