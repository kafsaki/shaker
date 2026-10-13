<script setup lang="ts">
/** 像素徽章 / 标签牌。solid 实色底，outline 描边底（受控词表标签、筛选 chip）。 */
import type { PixelIconName } from "@/lib/pixel-icons";

withDefaults(
  defineProps<{
    tone?: "amber" | "pink" | "cyan" | "green" | "red" | "gold" | "plain";
    variant?: "solid" | "outline";
    icon?: PixelIconName;
  }>(),
  { tone: "plain", variant: "outline" },
);
</script>

<template>
  <span class="px-badge" :class="[`t-${tone}`, `v-${variant}`]">
    <PxIcon v-if="icon" :name="icon" :scale="1" />
    <slot />
  </span>
</template>

<style scoped>
.px-badge {
  --c: var(--dim);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  margin: var(--p);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  color: var(--c);
  background: var(--panel-lo);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--c),
    0 var(--p) 0 0 var(--c),
    calc(var(--p) * -1) 0 0 0 var(--c),
    var(--p) 0 0 0 var(--c);
}
.t-amber { --c: var(--amber); }
.t-pink { --c: var(--pink); }
.t-cyan { --c: var(--cyan); }
.t-green { --c: var(--green); }
.t-red { --c: var(--red); }
.t-gold { --c: var(--gold); }
.v-solid {
  background: var(--c);
  color: var(--on-accent);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.3);
}
.v-solid.t-plain { background: var(--panel-hi); color: var(--fg); }
</style>
