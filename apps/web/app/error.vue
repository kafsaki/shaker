<script setup lang="ts">
/** 错误页：街机 GAME OVER + CONTINUE 倒计时（倒数到 0 变成 INSERT COIN，不自动跳走）。 */
import type { NuxtError } from "#app";

const props = defineProps<{ error: NuxtError }>();
const { theme } = useTheme();
const left = ref(9);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    if (left.value > 0) left.value--;
    else clearInterval(timer);
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));

const is404 = computed(() => props.error.statusCode === 404);
useHead({
  title: is404.value ? "迷路了 · Shaker" : "出错了 · Shaker",
  htmlAttrs: { class: computed(() => (theme.value === "dark" ? "dark crt" : "crt")) },
});

function retry(): void {
  void clearError({ redirect: "/" });
}
</script>

<template>
  <AppBackdrop />
  <div class="relative z-10 grid min-h-dvh place-items-center p-6">
    <div class="flex max-w-lg flex-col items-center gap-6 text-center">
      <p class="font-logo text-[48px] leading-none text-red text-shadow-px sm:text-[64px]">GAME<br>OVER</p>
      <PxPanel :title="`ERROR ${error.statusCode}`" icon="warn" tone="pink" class="w-full">
        <p class="text-fg">
          {{ is404 ? "这条路通往的酒馆已经打烊了（页面不存在）。" : "吧台出了点意外。" }}
        </p>
        <p v-if="!is404 && error.message" class="mt-2 break-all text-faint">{{ error.message }}</p>
      </PxPanel>
      <div class="flex flex-col items-center gap-3">
        <p v-if="left > 0" class="font-logo text-[16px] text-amber">
          CONTINUE? <span class="text-fg">{{ left }}</span>
        </p>
        <p v-else class="animate-blink font-logo text-[16px] text-amber">INSERT COIN</p>
        <PxButton variant="primary" size="lg" icon="coin" sfx="start" @click="retry()">投币续关 · 回酒馆</PxButton>
      </div>
    </div>
  </div>
</template>
