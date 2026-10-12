<script setup lang="ts">
/**
 * 星级：只读展示（readonly）或选择器（滑过预览、点击选中、再点同一颗清零）。
 */
const props = withDefaults(defineProps<{ max?: number; readonly?: boolean; label?: string }>(), {
  max: 5,
});
const model = defineModel<number>({ default: 0 });
const hovered = ref(0);
const shown = computed(() => hovered.value || model.value);
const { play } = useSfx();

function pick(n: number): void {
  if (props.readonly) return;
  model.value = model.value === n ? 0 : n;
  play("click");
}
</script>

<template>
  <span class="inline-flex items-center gap-0.5" @mouseleave="hovered = 0">
    <component
      :is="readonly ? 'span' : 'button'"
      v-for="n in max"
      :key="n"
      :type="readonly ? undefined : 'button'"
      :aria-label="readonly ? undefined : `${label ?? '星级'} ${n}`"
      :class="n <= shown ? 'text-gold' : 'text-line'"
      @mouseenter="!readonly && (hovered = n)"
      @click="pick(n)"
    >
      <PxIcon name="star" :scale="readonly ? 1 : 2" />
    </component>
  </span>
</template>
