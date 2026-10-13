<script setup lang="ts">
/**
 * RPG 对白框：立绘 + 名牌 + 打字机逐字显示，打完后右下角 ▼ 闪烁。
 * 点击文本区可跳过打字；「减少动效」偏好开启时直接整句显示。
 * choices 插槽放选项按钮（打完字才出现，像游戏里的分支选项）。
 */
const props = withDefaults(defineProps<{ speaker: string; text: string; speed?: number }>(), {
  speed: 32,
});

const { prefs } = usePrefs();
const { play } = useSfx();
const shown = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

const done = computed(() => shown.value >= props.text.length);

function start(): void {
  clearInterval(timer);
  if (prefs.value.calm) {
    shown.value = props.text.length;
    return;
  }
  shown.value = 0;
  timer = setInterval(() => {
    shown.value++;
    if (shown.value % 3 === 0) play("step");
    if (shown.value >= props.text.length) clearInterval(timer);
  }, props.speed);
}

function skip(): void {
  if (done.value) return;
  clearInterval(timer);
  shown.value = props.text.length;
}

onMounted(start);
watch(() => props.text, start);
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="flex items-end gap-4">
    <div v-if="$slots.portrait" class="hidden shrink-0 sm:block">
      <div class="bg-deep p-1 px-ring-2 px-drop">
        <slot name="portrait" />
      </div>
    </div>
    <div class="relative min-w-0 flex-1">
      <span
        class="absolute -top-3 left-4 z-10 bg-pink px-2 py-0.5 text-white px-ring"
      >{{ speaker }}</span>
      <div
        class="relative min-h-28 bg-panel px-5 pb-5 pt-6 px-ring-2 px-raise px-drop-lg"
        role="button"
        tabindex="0"
        aria-label="跳过打字"
        @click="skip()"
        @keydown.enter="skip()"
      >
        <p class="whitespace-pre-wrap text-fg">
          {{ text.slice(0, shown) }}<span class="invisible">{{ text.slice(shown) }}</span>
        </p>
        <span v-if="done" class="absolute bottom-2 right-3 animate-blink text-amber">▼</span>
      </div>
      <div v-if="done && $slots.choices" class="mt-4 flex flex-wrap gap-2 animate-pop-in">
        <slot name="choices" />
      </div>
    </div>
  </div>
</template>
