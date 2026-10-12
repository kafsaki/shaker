<script setup lang="ts">
/** 读条：摇酒壶上下颠 + NOW LOADING 跳点。 */
withDefaults(defineProps<{ text?: string }>(), { text: "NOW LOADING" });
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 py-10 text-dim" role="status">
    <PxIcon name="shaker" :scale="4" class="animate-bob text-amber" />
    <p class="font-logo text-[8px] tracking-[0.2em]">
      {{ text }}<span class="animate-blink">...</span>
    </p>
  </div>
</template>
