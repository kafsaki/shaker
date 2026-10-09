<script setup lang="ts">
/** 星级选择器：鼠标滑过即填充预览，点击选中，再点同一颗清空（0 = 不限）。 */
import { Star } from "lucide-vue-next";

const model = defineModel<number>({ required: true });

const MAX = 5;
const hovered = ref(0);

/** 悬停优先，否则显示已选值。 */
const shown = computed(() => hovered.value || model.value);

function pick(n: number): void {
  model.value = model.value === n ? 0 : n;
}
</script>

<template>
  <div class="flex items-center gap-1" @mouseleave="hovered = 0">
    <button
      v-for="n in MAX"
      :key="n"
      type="button"
      class="cursor-pointer p-0.5 transition-transform hover:scale-110"
      :aria-label="`难度不高于 ${n} 星`"
      @mouseenter="hovered = n"
      @click="pick(n)"
    >
      <Star
        class="size-4 transition-colors"
        :class="n <= shown ? 'fill-primary text-primary' : 'text-muted-foreground'"
      />
    </button>
    <span class="ml-1 w-14 text-xs text-muted-foreground">
      {{ model > 0 ? `≤ ${model} 星` : "不限" }}
    </span>
  </div>
</template>