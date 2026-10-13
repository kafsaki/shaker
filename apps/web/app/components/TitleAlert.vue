<script setup lang="ts">
/** 标题画面的红色报错框（读档 / 建档失败）：红描边 + 警示图标，正文用前景色保证可读。 */
withDefaults(defineProps<{ message: string; title?: string }>(), { title: "ERROR" });
</script>

<template>
  <div role="alert" class="flex items-start gap-2 bg-red/15 px-3 py-2 px-ring [--ring:var(--red)]">
    <PxIcon name="warn" :scale="2" class="mt-0.5 shrink-0 text-red" />
    <div class="min-w-0">
      <p class="font-logo text-[8px] tracking-[0.2em] text-red">{{ title }}</p>
      <p class="break-words text-fg">{{ message }}</p>
    </div>
  </div>
</template>
