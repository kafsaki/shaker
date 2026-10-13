<script setup lang="ts">
/** PxMenu 的菜单项：to 则作为链接，否则触发 select。danger 为红色危险操作。 */
import { DropdownMenuItem } from "reka-ui";
import type { RouteLocationRaw } from "vue-router";
import type { PixelIconName } from "@/lib/pixel-icons";

defineProps<{ icon?: PixelIconName; to?: RouteLocationRaw; danger?: boolean }>();
const emit = defineEmits<{ select: [] }>();
const { play } = useSfx();
const NuxtLink = resolveComponent("NuxtLink");
</script>

<template>
  <DropdownMenuItem
    :as-child="!!to"
    class="px-menu-item"
    :class="{ danger }"
    @select="play('click'); emit('select')"
  >
    <component :is="to ? NuxtLink : 'div'" :to="to" class="px-menu-item-inner">
      <span class="cur" aria-hidden="true">▶</span>
      <PxIcon v-if="icon" :name="icon" :scale="1" />
      <span class="flex-1"><slot /></span>
    </component>
  </DropdownMenuItem>
</template>

<style>
.px-menu-item {
  outline: none;
  user-select: none;
}
.px-menu-item-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px 0 4px;
}
.px-menu-item .cur { visibility: hidden; color: var(--amber); font-size: 10px; }
.px-menu-item[data-highlighted],
.px-menu-item:hover { background: var(--panel-hi); color: var(--amber); }
.px-menu-item[data-highlighted] .cur,
.px-menu-item:hover .cur { visibility: visible; animation: px-blink 0.8s steps(1) infinite; }
.px-menu-item.danger { color: var(--red); }
.px-menu-item.danger[data-highlighted] { color: var(--red); }
</style>
