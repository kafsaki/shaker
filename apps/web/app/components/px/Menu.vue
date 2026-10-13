<script setup lang="ts">
/**
 * 像素弹出菜单（reka DropdownMenu）：trigger 插槽放触发器，默认插槽放 PxMenuItem。
 * 菜单项高亮时左侧出现 ▶ 光标（经典 RPG 指令菜单）。
 */
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";

withDefaults(defineProps<{ align?: "start" | "center" | "end" }>(), { align: "end" });
const open = defineModel<boolean>("open", { default: false });
const { play } = useSfx();
watch(open, (o) => play(o ? "open" : "close"));
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent :align="align" :side-offset="10" class="px-menu">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
.px-menu {
  z-index: 70;
  min-width: 200px;
  padding: 4px;
  background: var(--panel);
  color: var(--fg);
  font-family: var(--font-pixel);
  font-size: 12px;
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 0 0 calc(var(--p) * 2) var(--line),
    calc(var(--p) * 3) calc(var(--p) * 3) 0 var(--p) var(--shadow);
  animation: px-pop-in 0.12s steps(3) both;
  transform-origin: top right;
}
.px-menu-sep {
  height: 0;
  margin: 4px 2px;
  border-top: var(--p) dashed var(--line);
}
</style>
