<template>
  <AppBackdrop />
  <div class="relative z-10 flex min-h-dvh flex-col">
    <AppHud />
    <main class="mx-auto w-full max-w-6xl flex-1 px-3 pb-28 pt-6 md:px-4 md:pb-16">
      <NuxtPage />
    </main>
    <footer class="relative hidden border-t-2 border-ink bg-deep/80 py-3 md:block">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 text-faint">
        <span class="font-logo text-[8px] tracking-[0.25em]">© SHAKER PIXEL BAR · AGPL-3.0</span>
        <span class="flex items-center gap-2">
          <PxKbd>/</PxKbd> 搜索
          <span class="animate-blink text-amber">■</span> INSERT COIN
        </span>
      </div>
    </footer>
  </div>
  <PxToaster />
</template>

<script setup lang="ts">
const { theme } = useTheme();
const { prefs } = usePrefs();
// html 上的 class 统一由 head 管：主题 / CRT 氛围 / 减少动效（插件里也会立即写一次，避免首帧闪）
useHead({
  htmlAttrs: {
    class: computed(() =>
      [theme.value === "dark" ? "dark" : "", prefs.value.crt ? "crt" : "", prefs.value.calm ? "calm" : ""]
        .filter(Boolean)
        .join(" "),
    ),
  },
});
</script>
