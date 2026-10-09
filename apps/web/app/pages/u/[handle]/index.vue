<script setup lang="ts">
/** /u/{handle} → 默认落到「配方」分栏。 */
definePageMeta({
  middleware: [(to) => navigateTo(`/u/${to.params.handle}/recipes`)],
});
</script>

<template>
  <div />
</template>