<script setup lang="ts">
/** 名册（粉丝 / 关注分栏共用）：一行一个调酒师，悬浮出 ▶ 光标；右侧是配方数 / 粉丝数读数。 */
import type { components } from "@shaker/api-client";
import type { PixelIconName } from "@/lib/pixel-icons";
import { compact } from "@/lib/game";

type UserCard = components["schemas"]["UserCardBody"];

defineProps<{
  users: UserCard[];
  title: string;
  icon: PixelIconName;
  emptyText: string;
  loading?: boolean;
}>();
</script>

<template>
  <PxPanel :title="title" :icon="icon" tone="cyan" :padded="false">
    <template #actions>
      <span v-if="users.length" class="font-logo text-[8px] text-faint">{{ users.length }}</span>
    </template>

    <div v-if="loading" class="flex flex-col gap-2 p-3">
      <PxSkeleton v-for="i in 3" :key="i" class="h-12" />
    </div>

    <ul v-else-if="users.length" class="flex flex-col p-2">
      <li v-for="(u, i) in users" :key="u.id">
        <NuxtLink :to="`/u/${u.handle}`" class="row">
          <span class="cur" aria-hidden="true">▶</span>
          <span class="no font-logo">{{ String(i + 1).padStart(2, "0") }}</span>
          <PxAvatar :src="u.avatarUrl" :seed="u.handle" :size="32" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1">
              <span class="name truncate text-fg">{{ u.displayName }}</span>
              <PxBadge v-if="u.isOfficial" tone="gold" icon="crown">官方</PxBadge>
            </span>
            <span class="block truncate text-faint">@{{ u.handle }}</span>
          </span>
          <span class="stat" title="配方"><PxIcon name="martini" :scale="1" class="text-amber" />{{ compact(u.recipeCount) }}</span>
          <span class="stat max-sm:!hidden" title="粉丝"><PxIcon name="heart" :scale="1" class="text-pink" />{{ compact(u.followerCount) }}</span>
        </NuxtLink>
      </li>
    </ul>

    <PxEmpty v-else icon="users" :title="emptyText" />
  </PxPanel>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 6px 4px;
}
.row:hover,
.row:focus-visible {
  background: var(--panel-hi);
  box-shadow: inset calc(var(--p) * 2) 0 0 0 var(--amber);
  outline: none;
}
.row:hover .name { color: var(--amber); }
.cur { width: 10px; visibility: hidden; color: var(--amber); font-size: 10px; flex-shrink: 0; }
.row:hover .cur,
.row:focus-visible .cur { visibility: visible; animation: px-blink 0.8s steps(1) infinite; }
.no { width: 20px; flex-shrink: 0; font-size: 8px; color: var(--faint); }
.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  min-width: 44px;
  font-family: var(--font-logo);
  font-size: 8px;
  color: var(--dim);
}
</style>
