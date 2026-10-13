<script setup lang="ts">
/**
 * 可点击的 RPG 属性条（口味 0..max）：点第 n 格设为 n；再点当前最高那格减一格
 * （点第 1 格时即清零）。滑过预览，配色同详情页属性条。
 */
const props = withDefaults(
  defineProps<{
    label: string;
    max?: number;
    tone?: "amber" | "pink" | "cyan" | "green" | "red";
  }>(),
  { max: 5, tone: "amber" },
);
const model = defineModel<number>({ default: 0 });
const hovered = ref(0);
const { play } = useSfx();

function next(n: number): number {
  return model.value === n ? n - 1 : n;
}

function pick(n: number): void {
  model.value = next(n);
  play("click");
}

/** 滑过时预览点下去的结果：-1 表示没在预览。 */
const preview = computed(() => (hovered.value > 0 ? next(hovered.value) : -1));

function onKey(e: KeyboardEvent): void {
  if (e.key === "ArrowRight" || e.key === "ArrowUp") {
    e.preventDefault();
    model.value = Math.min(props.max, model.value + 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
    e.preventDefault();
    model.value = Math.max(0, model.value - 1);
  }
}
</script>

<template>
  <div class="meter" :class="`t-${tone}`">
    <span class="w-4 shrink-0 text-dim">{{ label }}</span>
    <span
      class="cells"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuemin="0"
      :aria-valuemax="max"
      :aria-valuenow="model"
      @keydown="onKey"
      @mouseleave="hovered = 0"
    >
      <button
        v-for="n in max"
        :key="n"
        type="button"
        tabindex="-1"
        :aria-label="`${label} ${n}`"
        :class="{ on: n <= model, ghost: preview >= 0 && n <= preview && n > model, dim: preview >= 0 && n > preview && n <= model }"
        @mouseenter="hovered = n"
        @click="pick(n)"
      />
    </span>
    <span class="w-8 shrink-0 font-logo text-[8px] text-faint">{{ model }}/{{ max }}</span>
  </div>
</template>

<style scoped>
.meter {
  --c: var(--amber);
  display: flex;
  align-items: center;
  gap: 10px;
}
.t-pink { --c: var(--pink); }
.t-cyan { --c: var(--cyan); }
.t-green { --c: var(--green); }
.t-red { --c: var(--red); }
.cells {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--ink);
  outline-offset: 2px;
}
.cells button {
  width: 22px;
  height: 14px;
  background: var(--panel-lo);
}
.cells button.on {
  background: var(--c);
  box-shadow: inset 0 2px 0 0 rgb(255 255 255 / 0.35), inset 0 -2px 0 0 rgb(0 0 0 / 0.25);
}
/* 滑过预览：将要点亮的格子半亮，将要熄灭的格子变暗 */
.cells button.ghost { background: color-mix(in srgb, var(--c) 45%, var(--panel-lo)); }
.cells button.on.dim { opacity: 0.45; }
</style>
