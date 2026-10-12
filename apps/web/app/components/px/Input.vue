<script setup lang="ts">
/** 凹槽输入框：左侧可带图标，聚焦时描边变琥珀；其余属性透传给 <input>。 */
import type { PixelIconName } from "@/lib/pixel-icons";

defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ icon?: PixelIconName; size?: "sm" | "md" | "lg" }>(), {
  size: "md",
});
const model = defineModel<string | number | null>();
const el = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => el.value?.focus(), el });
</script>

<template>
  <label class="px-field" :class="`s-${size}`">
    <PxIcon v-if="icon" :name="icon" :scale="size === 'lg' ? 2 : 1" class="ic" />
    <input ref="el" v-model="model" v-bind="$attrs" class="inp" />
  </label>
</template>

<style scoped>
.px-field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  background: var(--deep);
  margin: var(--p);
  padding: 0 10px;
  cursor: text;
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ring, var(--ink)),
    0 var(--p) 0 0 var(--ring, var(--ink)),
    calc(var(--p) * -1) 0 0 0 var(--ring, var(--ink)),
    var(--p) 0 0 0 var(--ring, var(--ink)),
    inset var(--p) var(--p) 0 0 var(--lo);
}
.px-field:focus-within {
  --ring: var(--amber);
}
.s-sm { height: 24px; padding: 0 8px; }
.s-md { height: 32px; }
.s-lg { height: 44px; padding: 0 14px; }
.ic { color: var(--faint); }
.px-field:focus-within .ic { color: var(--amber); }
.inp {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  color: var(--fg);
  outline: none;
  caret-color: var(--amber);
  font: inherit;
}
.inp::placeholder { color: var(--faint); }
.inp:disabled { opacity: 0.5; }
/* 数字框去掉浏览器自带的上下箭头（不像素） */
.inp::-webkit-outer-spin-button,
.inp::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.inp[type="number"] { -moz-appearance: textfield; appearance: textfield; }
</style>
