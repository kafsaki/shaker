<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="mx-auto w-full max-w-6xl px-4 py-6">
      <NuxtPage />
    </main>
  </div>
  <Toaster close-button />
</template>

<script setup lang="ts">
import { Toaster } from "@/components/ui/sonner";

const { theme } = useTheme();
useHead({
  htmlAttrs: { class: computed(() => (theme.value === "dark" ? "dark" : "")) },
});
</script>
