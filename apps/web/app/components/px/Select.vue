<script setup lang="ts">
/**
 * 像素下拉选择（reka-ui Select，保留键盘与读屏可达性）。
 * options 扁平传入；带 group 的项按组插标题。选中项前面是闪烁的 ▶ 光标。
 * 注意：reka 不允许空串 value（空串是「清除选择」保留值），调用方用 all/none 之类哨兵。
 */
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemText,
  SelectLabel,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";
import type { PixelIconName } from "@/lib/pixel-icons";

export interface PxOption {
  value: string;
  label: string;
  group?: string;
}

const props = withDefaults(
  defineProps<{
    options: PxOption[];
    placeholder?: string;
    size?: "sm" | "md";
    icon?: PixelIconName;
    disabled?: boolean;
  }>(),
  { size: "md" },
);
const model = defineModel<string>();
// SelectRoot 不渲染 DOM，class / title 等属性要落到触发器上，调用方才能定宽
defineOptions({ inheritAttrs: false });
const { play } = useSfx();

const groups = computed(() => {
  const out: { label?: string; items: PxOption[] }[] = [];
  for (const o of props.options) {
    const last = out[out.length - 1];
    if (last && last.label === o.group) last.items.push(o);
    else out.push({ label: o.group, items: [o] });
  }
  return out;
});
</script>

<template>
  <SelectRoot
    v-model="model"
    :disabled="disabled"
    @update:open="(o) => play(o ? 'open' : 'close')"
  >
    <SelectTrigger v-bind="$attrs" class="px-sel-trigger" :class="`s-${size}`">
      <PxIcon v-if="icon" :name="icon" :scale="1" class="text-faint" />
      <span class="min-w-0 flex-1 truncate text-left">
        <SelectValue :placeholder="placeholder" />
      </span>
      <PxIcon name="chevron-down" :scale="1" class="text-dim" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent position="popper" :side-offset="6" class="px-sel-content">
        <SelectViewport class="p-1">
          <SelectGroup v-for="(g, gi) in groups" :key="gi">
            <SelectLabel v-if="g.label" class="px-2 pb-1 pt-2 text-faint">— {{ g.label }} —</SelectLabel>
            <SelectItem
              v-for="o in g.items"
              :key="o.value"
              :value="o.value"
              class="px-sel-item"
              @select="play('click')"
            >
              <span class="cur" aria-hidden="true">▶</span>
              <SelectItemText>{{ o.label }}</SelectItemText>
            </SelectItem>
          </SelectGroup>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
.px-sel-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: var(--p);
  padding: 0 10px;
  background: var(--panel-hi);
  color: var(--fg);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo);
}
.px-sel-trigger.s-sm { height: 24px; padding: 0 8px; }
.px-sel-trigger.s-md { height: 32px; }
.px-sel-trigger:hover { background: color-mix(in srgb, var(--panel-hi) 85%, var(--fg) 15%); }
.px-sel-trigger[data-state="open"] { color: var(--amber); }
.px-sel-trigger[data-placeholder] { color: var(--faint); }
.px-sel-trigger[data-disabled] { opacity: 0.5; }

.px-sel-content {
  z-index: 60;
  min-width: var(--reka-select-trigger-width);
  max-height: min(360px, var(--reka-select-content-available-height));
  overflow-y: auto;
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
  transform-origin: top;
}
.px-sel-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px 0 4px;
  outline: none;
  user-select: none;
}
.px-sel-item .cur { visibility: hidden; color: var(--amber); font-size: 10px; }
.px-sel-item[data-highlighted] { background: var(--panel-hi); color: var(--amber); }
.px-sel-item[data-highlighted] .cur { visibility: visible; animation: px-blink 0.8s steps(1) infinite; }
.px-sel-item[data-state="checked"] { color: var(--amber); }
.px-sel-item[data-state="checked"] .cur { visibility: visible; animation: none; }
</style>
