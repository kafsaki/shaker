<script setup lang="ts">
/** 配方封面（本身就是动画定格帧的像素图）：按主题取暗/亮版本，缺图时画空杯占位。 */
const props = defineProps<{ dark?: string | null; light?: string | null; alt?: string }>();
const { pickCover } = useCover();
const src = computed(() => pickCover(props.dark, props.light));
const failed = ref(false);
watch(src, () => (failed.value = false));
</script>

<template>
  <div class="relative overflow-hidden bg-deep">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt ?? ''"
      loading="lazy"
      draggable="false"
      class="block size-full object-cover"
      @error="failed = true"
    >
    <div v-else class="grid size-full place-items-center px-dither" style="--dither: var(--panel-lo)">
      <PxIcon name="martini" :scale="5" class="text-line" />
    </div>
  </div>
</template>
