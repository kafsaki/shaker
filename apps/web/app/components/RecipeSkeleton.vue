<template>
  <!-- 配方页加载骨架：左电视 + 右名牌/面板 -->
  <div class="grid items-start gap-6 lg:grid-cols-[430px_minmax(0,1fr)]">
    <PxSkeleton class="aspect-[400/600]" />
    <div class="flex flex-col gap-4">
      <PxSkeleton class="h-36" />
      <PxSkeleton class="h-28" />
      <PxSkeleton class="h-64" />
    </div>
  </div>
</template>
