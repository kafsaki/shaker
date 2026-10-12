<script setup lang="ts">
/**
 * 酒单行（搜索结果 / 用户主页酒单分栏 / 酒单广场共用）：左侧卡叠封面，右侧标题 · 杯数 · 精选 · 收藏数 · 主人 · 描述，
 * 下方是酒单里配方的窄卡货架（横向滚动），「查看酒单」进详情页。
 * showOwner：用户主页里主人就是页面本人，不重复显示；showVisibility：本人视角才有私密酒单。
 */
import type { components } from "@shaker/api-client";

type Menu = components["schemas"]["MenuBody"];

const props = withDefaults(
  defineProps<{ menu: Menu; showOwner?: boolean; showVisibility?: boolean }>(),
  { showOwner: true, showVisibility: false },
);

const { pickCovers } = useCover();
const cards = computed(() => props.menu.recipeCards ?? []);
const isPublic = computed(() => props.menu.visibility === "public");
</script>

<template>
  <PxPanel :padded="false">
    <div class="flex flex-col gap-4 p-4 sm:flex-row">
      <NuxtLink :to="`/menus/${menu.id}`" class="sleeve w-28 shrink-0 sm:w-36" :aria-label="menu.title">
        <MenuCoverStack :covers="pickCovers(menu.coverUrls, menu.coverUrlsLight)" />
      </NuxtLink>

      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/menus/${menu.id}`" class="title block truncate text-lg text-fg text-shadow-px">
              <span class="cur" aria-hidden="true">▶</span>{{ menu.title }}
            </NuxtLink>
            <p class="mt-1 flex flex-wrap items-center gap-1">
              <PxBadge tone="amber" icon="martini">
                <span class="font-logo text-[8px]">{{ menu.itemCount }}</span> 杯
              </PxBadge>
              <PxBadge v-if="menu.featured" tone="gold" icon="crown">精选</PxBadge>
              <PxBadge v-if="menu.saveCount" icon="bookmark" :title="`${menu.saveCount} 人收藏`">
                <span class="font-logo text-[8px]">{{ menu.saveCount }}</span>
              </PxBadge>
              <PxBadge v-if="showVisibility" :tone="isPublic ? 'green' : 'plain'" :icon="isPublic ? 'globe' : 'lock'">
                {{ isPublic ? "公开" : "私密" }}
              </PxBadge>
            </p>
          </div>
          <PxButton size="sm" icon-right="chevron-right" :to="`/menus/${menu.id}`" class="shrink-0 max-sm:!hidden">
            查看酒单
          </PxButton>
        </div>

        <NuxtLink
          v-if="showOwner && menu.owner"
          :to="`/u/${menu.owner.handle}`"
          class="flex w-fit items-center gap-2 text-dim hover:text-amber"
        >
          <PxAvatar :src="menu.owner.avatarUrl" :seed="menu.owner.handle" :size="20" />
          <span class="text-fg">{{ menu.owner.displayName }}</span>
          <span class="text-faint">@{{ menu.owner.handle }}</span>
        </NuxtLink>

        <p v-if="menu.description" class="line-clamp-2 text-dim">{{ menu.description }}</p>

        <div v-if="cards.length" class="shelf">
          <RecipeCard v-for="c in cards" :key="c.id" :recipe="c" :disabled="c.deleted" slim class="w-28 shrink-0" />
        </div>
        <p v-else class="text-faint">这个酒单还没有配方</p>

        <PxButton size="sm" icon-right="chevron-right" :to="`/menus/${menu.id}`" block class="sm:!hidden">
          查看酒单
        </PxButton>
      </div>
    </div>
  </PxPanel>
</template>

<style scoped>
.sleeve:hover { filter: brightness(1.08); }
.title .cur {
  display: inline-block;
  width: 0;
  overflow: hidden;
  color: var(--amber);
  font-size: 12px;
  vertical-align: middle;
}
.title:hover { color: var(--amber); }
.title:hover .cur { width: 18px; animation: px-blink 0.8s steps(1) infinite; }
/* 货架：凹槽里一排窄卡，留出上方空间给卡片悬浮抬起 */
.shelf {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 8px 6px 6px;
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
  margin: var(--p);
}
</style>
