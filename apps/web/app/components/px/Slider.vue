<script setup lang="ts">
/** 像素滑块（单值或区间，reka Slider）：凹槽轨道 + 方块滑钮。 */
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "reka-ui";

withDefaults(defineProps<{ min?: number; max?: number; step?: number; label?: string }>(), {
  min: 0,
  max: 100,
  step: 1,
});
const model = defineModel<number[]>({ required: true });
</script>

<template>
  <SliderRoot
    v-model="model"
    :min="min"
    :max="max"
    :step="step"
    class="px-slider"
  >
    <SliderTrack class="px-slider-track">
      <SliderRange class="px-slider-range" />
    </SliderTrack>
    <SliderThumb
      v-for="(_, i) in model"
      :key="i"
      class="px-slider-thumb"
      :aria-label="label"
    />
  </SliderRoot>
</template>

<style>
.px-slider {
  position: relative;
  display: flex;
  align-items: center;
  height: 20px;
  touch-action: none;
  user-select: none;
}
.px-slider-track {
  position: relative;
  flex: 1;
  height: 8px;
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.px-slider-range {
  position: absolute;
  height: 100%;
  background: var(--amber);
  background-image: repeating-linear-gradient(90deg, transparent 0 6px, rgb(0 0 0 / 0.25) 6px 8px);
}
.px-slider-thumb {
  display: block;
  width: 12px;
  height: 18px;
  background: var(--panel-hi);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo);
  outline: none;
}
.px-slider-thumb:hover,
.px-slider-thumb:focus-visible { background: var(--amber); }
</style>
