<script setup lang="ts">
/** 像素风滑块（reka-ui SliderRoot 封装，支持双滑块区间）。 */
import type { SliderRootEmits, SliderRootProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import {
  SliderRange,
  SliderRoot,
  SliderThumb,
  SliderTrack,
  useForwardPropsEmits,
} from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<SliderRootProps & { class?: HTMLAttributes["class"] }>();
const emits = defineEmits<SliderRootEmits>();

const delegatedProps = reactiveOmit(props, "class");
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <SliderRoot
    v-slot="{ modelValue }"
    data-slot="slider"
    :class="
      cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50',
        props.class,
      )
    "
    v-bind="forwarded"
  >
    <SliderTrack
      data-slot="slider-track"
      class="relative h-2.5 w-full grow overflow-hidden rounded-sm border-2 border-border bg-muted"
    >
      <SliderRange data-slot="slider-range" class="absolute h-full bg-primary" />
    </SliderTrack>
    <SliderThumb
      v-for="(_, key) in modelValue"
      :key="key"
      data-slot="slider-thumb"
      class="block size-4 shrink-0 cursor-ew-resize rounded-sm border-2 border-border bg-card pixel-shadow-sm outline-hidden ring-ring/50 transition-colors hover:bg-primary/20 focus-visible:ring-2 disabled:pointer-events-none"
    />
  </SliderRoot>
</template>