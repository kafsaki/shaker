<script setup lang="ts">
/**
 * 像素按钮：凸起斜面 + 硬投影，按下时整体下沉 1 格、投影消失（实体按键手感）。
 * 传 to 渲染成 NuxtLink，其余情况是 <button>。点击播放音效（偏好里开了才响）。
 */
import type { RouteLocationRaw } from "vue-router";
import type { PixelIconName } from "@/lib/pixel-icons";
import type { SfxName } from "@/composables/useSfx";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger" | "accent" | "success";
    size?: "sm" | "md" | "lg";
    icon?: PixelIconName;
    iconRight?: PixelIconName;
    to?: RouteLocationRaw;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
    /** 只有图标的方形按钮 */
    square?: boolean;
    /** 选中/按下态（切换类按钮） */
    active?: boolean;
    sfx?: SfxName | false;
  }>(),
  { variant: "secondary", size: "md", type: "button", sfx: "click" },
);

const emit = defineEmits<{ click: [e: MouseEvent] }>();
const { play } = useSfx();
const NuxtLink = resolveComponent("NuxtLink");

function onClick(e: MouseEvent): void {
  if (props.disabled || props.loading) {
    e.preventDefault();
    return;
  }
  if (props.sfx) play(props.sfx);
  emit("click", e);
}

const iconScale = computed(() => (props.size === "lg" ? 2 : props.size === "sm" ? 1 : 2));
</script>

<template>
  <component
    :is="to && !disabled ? NuxtLink : 'button'"
    :to="to && !disabled ? to : undefined"
    :type="to ? undefined : type"
    :disabled="to ? undefined : disabled || loading"
    :aria-disabled="disabled || undefined"
    :aria-pressed="active === undefined ? undefined : active"
    class="px-btn"
    :class="[`v-${variant}`, `s-${size}`, { block, square, active, busy: loading }]"
    @click="onClick"
  >
    <span v-if="loading" class="dots" aria-label="处理中"><i /><i /><i /></span>
    <PxIcon v-else-if="icon" :name="icon" :scale="iconScale" />
    <span v-if="$slots.default" class="label"><slot /></span>
    <PxIcon v-if="iconRight && !loading" :name="iconRight" :scale="iconScale" />
  </component>
</template>

<style scoped>
.px-btn {
  --bg: var(--panel-hi);
  --bg-hover: color-mix(in srgb, var(--panel-hi) 80%, var(--fg) 20%);
  --fg-c: var(--fg);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
  user-select: none;
  background: var(--bg);
  color: var(--fg-c);
  margin: var(--p);
  --px-ring: 0 calc(var(--p) * -1) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink), var(--p) 0 0 0 var(--ink);
  --px-bevel: inset var(--p) var(--p) 0 0 var(--hi), inset calc(var(--p) * -1) calc(var(--p) * -2) 0 0 var(--lo);
  --px-drop: var(--p) calc(var(--p) * 2) 0 0 var(--shadow);
  box-shadow: var(--px-ring), var(--px-bevel), var(--px-drop);
  transition: none;
}
.px-btn:hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--bg-hover);
}
.px-btn:active:not(:disabled):not([aria-disabled="true"]),
.px-btn.active {
  transform: translateY(var(--p));
  --px-bevel: inset var(--p) var(--p) 0 0 var(--lo);
  --px-drop: 0 0 0 0 transparent;
}
.px-btn:disabled,
.px-btn[aria-disabled="true"] {
  opacity: 0.5;
  filter: saturate(0.4);
}
.px-btn:focus-visible {
  outline: var(--p) solid var(--amber);
  outline-offset: calc(var(--p) * 3);
}

.s-sm { height: 24px; padding: 0 8px; gap: 6px; }
.s-md { height: 32px; padding: 0 12px; }
.s-lg { height: 44px; padding: 0 20px; }
.square.s-sm { width: 24px; padding: 0; }
.square.s-md { width: 32px; padding: 0; }
.square.s-lg { width: 44px; padding: 0; }
.block { display: flex; width: calc(100% - var(--p) * 2); }

.v-primary {
  --bg: var(--amber);
  --bg-hover: var(--amber-hi);
  --fg-c: var(--on-accent);
}
.v-accent {
  --bg: var(--pink);
  --bg-hover: color-mix(in srgb, var(--pink) 75%, white 25%);
  --fg-c: #fff;
}
.v-success {
  --bg: var(--green);
  --bg-hover: color-mix(in srgb, var(--green) 75%, white 25%);
  --fg-c: var(--on-accent);
}
.v-danger {
  --bg: var(--red);
  --bg-hover: color-mix(in srgb, var(--red) 75%, white 25%);
  --fg-c: #fff;
}
.v-ghost {
  --bg: transparent;
  --bg-hover: var(--panel-hi);
  --fg-c: var(--dim);
  --px-ring: 0 0 #0000;
  --px-bevel: 0 0 #0000;
  --px-drop: 0 0 #0000;
}
.v-ghost:hover:not(:disabled) { color: var(--fg); }
.v-ghost.active { color: var(--amber); background: var(--panel-hi); }
.v-ghost:active:not(:disabled) { --px-bevel: 0 0 #0000; }
.v-secondary.active { --bg: var(--panel-lo); color: var(--amber); }

.label { line-height: 1; }

.dots { display: inline-flex; gap: 3px; }
.dots i {
  width: 4px;
  height: 4px;
  background: currentColor;
  animation: px-blink 0.9s steps(1) infinite;
}
.dots i:nth-child(2) { animation-delay: 0.3s; }
.dots i:nth-child(3) { animation-delay: 0.6s; }
</style>
