<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
  <Toaster close-button />
</template>

<script setup lang="ts">
import { Toaster } from "@/components/ui/sonner";

const { theme } = useTheme();
useHead({
  htmlAttrs: { class: computed(() => (theme.value === "dark" ? "dark" : "")) },
});
</script>
