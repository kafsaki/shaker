<script setup lang="ts">
/**
 * 分段选择 / 游戏菜单页签。
 * - segment：一排连体按键（倍速、时间窗、ml/oz）
 * - tabs：带图标与计数的页签条，选中项凸起且下沿与内容区相连
 * item.to 存在时渲染成 NuxtLink（真实路由的分栏），选中态由 v-model 决定。
 */
import type { RouteLocationRaw } from "vue-router";
import type { PixelIconName } from "@/lib/pixel-icons";

export interface SegItem {
  value: string;
  label: string;
  icon?: PixelIconName;
  count?: number;
  to?: RouteLocationRaw;
}

withDefaults(defineProps<{ items: SegItem[]; variant?: "segment" | "tabs"; size?: "sm" | "md" }>(), {
  variant: "segment",
  size: "md",
});
const model = defineModel<string>();
const { play } = useSfx();
const NuxtLink = resolveComponent("NuxtLink");

function pick(v: string): void {
  if (model.value === v) return;
  play("step");
  model.value = v;
}
</script>

<template>
  <div
    :role="variant === 'tabs' ? 'tablist' : 'radiogroup'"
    class="px-seg"
    :class="[`v-${variant}`, `s-${size}`]"
  >
    <component
      :is="it.to ? NuxtLink : 'button'"
      v-for="it in items"
      :key="it.value"
      :to="it.to"
      :type="it.to ? undefined : 'button'"
      :role="variant === 'tabs' ? 'tab' : 'radio'"
      :aria-selected="variant === 'tabs' ? model === it.value : undefined"
      :aria-checked="variant === 'segment' ? model === it.value : undefined"
      class="seg"
      :class="{ on: model === it.value }"
      @click="pick(it.value)"
    >
      <span v-if="variant === 'tabs'" class="cur" aria-hidden="true">▶</span>
      <PxIcon v-if="it.icon" :name="it.icon" :scale="size === 'sm' ? 1 : 2" />
      <span>{{ it.label }}</span>
      <span v-if="it.count !== undefined" class="cnt">{{ it.count }}</span>
    </component>
  </div>
</template>

<style scoped>
.px-seg { display: inline-flex; flex-wrap: wrap; }

/* ── segment ── */
.v-segment {
  gap: 0;
  margin: var(--p);
  background: var(--ink);
  padding: var(--p);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.v-segment .seg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  background: var(--panel-lo);
  color: var(--dim);
  margin-right: var(--p);
}
.v-segment .seg:last-child { margin-right: 0; }
.v-segment.s-sm .seg { height: 22px; padding: 0 8px; }
.v-segment .seg:hover { color: var(--fg); background: var(--panel); }
.v-segment .seg.on {
  background: var(--amber);
  color: var(--on-accent);
  box-shadow: inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35), inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 rgb(0 0 0 / 0.2);
}

/* ── tabs ── */
.v-tabs {
  gap: 6px;
  align-items: flex-end;
  border-bottom: var(--p) solid var(--ink);
  padding: 0 4px;
}
.v-tabs .seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px 0 8px;
  margin-bottom: calc(var(--p) * -1);
  background: var(--panel-lo);
  color: var(--dim);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink);
}
.v-tabs .seg:hover { color: var(--fg); }
.v-tabs .seg .cur { visibility: hidden; color: var(--amber); font-size: 10px; }
.v-tabs .seg.on {
  height: 40px;
  background: var(--panel);
  color: var(--amber);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    inset 0 var(--p) 0 0 var(--hi),
    inset 0 calc(var(--p) * 2) 0 0 var(--amber);
}
.v-tabs .seg.on .cur { visibility: visible; animation: px-blink 0.8s steps(1) infinite; }
.cnt {
  min-width: 18px;
  padding: 0 4px;
  background: var(--ink);
  color: var(--dim);
  font-family: var(--font-logo);
  font-size: 8px;
  line-height: 16px;
  text-align: center;
}
.seg.on .cnt { color: var(--amber); }
</style>
