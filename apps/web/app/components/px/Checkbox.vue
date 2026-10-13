<script setup lang="ts">
/** 像素复选框：方形凹槽 + 勾。默认插槽是标签文字（整行可点）。 */
const model = defineModel<boolean>({ default: false });
defineProps<{ disabled?: boolean }>();
const { play } = useSfx();

function toggle(): void {
  model.value = !model.value;
  play("click");
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="model"
    :disabled="disabled"
    class="inline-flex items-center gap-2 text-left disabled:opacity-50"
    @click="toggle()"
  >
    <span
      class="grid size-4 shrink-0 place-items-center bg-deep px-ring px-sink"
      :class="model ? 'text-amber' : 'text-transparent'"
    >
      <PxIcon name="check" :scale="1" />
    </span>
    <span v-if="$slots.default"><slot /></span>
  </button>
</template>
