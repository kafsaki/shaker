<script setup lang="ts">
/**
 * 调酒动画播放器 —— 产品核心资产。
 *
 * 复用 prototype 已调好的渲染管线：compile → 80ms 量化 sample → renderScene。
 * 播放/暂停/重播、时间轴拖动（seek O(1)）、速度档、单步回看（点击步骤跳转）。
 * captureCover() 在 finalSceneMs 定格帧上 toBlob（ADR-015 前端截帧封面）。
 */
import { Pause, Play, RotateCcw } from "lucide-vue-next";
import { compile, sample, type Timeline } from "@shaker/animator-core";
import {
  DARK_THEME,
  LIGHT_THEME,
  renderScene,
} from "@shaker/animator-web";
import type { RecipeIR, VocabLookup } from "@shaker/recipe-ir/core";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const props = defineProps<{
  ir: RecipeIR;
  vocab: VocabLookup;
}>();

const emit = defineEmits<{
  /** 步骤推进（80ms 量化）—— 配方页用它高亮文字步骤。 */
  progress: [stepIndex: number, stepProgress: number];
}>();

const STAGE = { width: 400, height: 520 } as const;

const canvasEl = ref<HTMLCanvasElement | null>(null);
const playing = ref(true);
const speed = ref(1);
const tMs = ref(0);
const { theme } = useTheme();

const timeline = shallowRef<Timeline | null>(null);

function recompile(): void {
  try {
    timeline.value = compile(props.ir, props.vocab, { stage: STAGE });
    tMs.value = 0;
    playing.value = true;
  } catch (err) {
    console.error("动画编译失败", err);
    timeline.value = null;
  }
}

watch(
  () => [props.ir, props.vocab],
  () => recompile(),
  { immediate: true },
);

/* ── 画布 ── */
let ctx: CanvasRenderingContext2D | null = null;

function ensureCtx(): CanvasRenderingContext2D | null {
  if (!canvasEl.value) return null;
  if (!ctx) {
    ctx = canvasEl.value.getContext("2d", { alpha: false });
  }
  return ctx;
}

function resizeCanvas(): void {
  const el = canvasEl.value;
  if (!el) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  el.width = Math.round(STAGE.width * dpr);
  el.height = Math.round(STAGE.height * dpr);
  el.style.aspectRatio = `${STAGE.width} / ${STAGE.height}`;
  const c = ensureCtx();
  c?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

onMounted(() => resizeCanvas());

/* ── 绘制 ── */
let lastEmitKey = "";
/** 封面截帧中：renderScene 关掉闪烁类装饰（盐边闪光），让封面干净。 */
let stillCapture = false;

function draw(): void {
  const tl = timeline.value;
  const c = ensureCtx();
  if (!tl || !c) return;

  // 12fps 定格感：场景几何按 80ms 步进量化；液流条纹/水花/闪烁用原始时间
  const tQ = Math.floor(tMs.value / 80) * 80;
  const { scene, step, stepProgress } = sample(tl, tQ);
  renderScene(c, scene, {
    theme: theme.value === "dark" ? DARK_THEME : LIGHT_THEME,
    timeMs: tQ,
    fxMs: tMs.value,
    vessel: props.vocab.vessel,
    stage: STAGE,
    serveProgress: step.stepId === "__final" ? stepProgress : undefined,
    still: stillCapture || undefined,
  });

  // 步骤事件按量化节流：只在步骤切换或进度每 10% 时向父组件发一次
  const idx = tl.steps.findIndex((s) => s.stepId === step.stepId);
  const key = `${idx}:${Math.floor(stepProgress * 10)}`;
  if (key !== lastEmitKey) {
    lastEmitKey = key;
    emit("progress", idx, stepProgress);
  }
}

/* ── rAF 循环 ── */
let rafId = 0;
let lastFrame = 0;

function frame(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;

  if (playing.value && timeline.value) {
    tMs.value += dt * speed.value;
    if (tMs.value >= timeline.value.totalMs) {
      tMs.value = timeline.value.totalMs;
      playing.value = false;
    }
  }
  draw();
  rafId = requestAnimationFrame(frame);
}

onMounted(() => {
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
});

onBeforeUnmount(() => cancelAnimationFrame(rafId));

/* ── 暴露给父组件 ── */
function seekTo(ms: number): void {
  const tl = timeline.value;
  if (!tl) return;
  tMs.value = Math.max(0, Math.min(tl.totalMs, ms));
  draw();
}

/** 单步回看：跳到某一步的起点。index 超 __final 也安全（clamp）。 */
function seekToStep(index: number): void {
  const tl = timeline.value;
  if (!tl) return;
  const s = tl.steps[Math.max(0, Math.min(tl.steps.length - 1, index))];
  if (!s) return;
  seekTo(s.startMs);
}

function togglePlay(): void {
  const tl = timeline.value;
  if (!tl) return;
  if (!playing.value && tMs.value >= tl.totalMs) {
    tMs.value = 0; // 播到底后按播放 = 重播
  }
  playing.value = !playing.value;
}

/** 成品定格帧截图（ADR-015：封面图 = finalSceneMs 上的 toBlob）。 */
async function captureCover(): Promise<Blob | null> {
  const tl = timeline.value;
  const el = canvasEl.value;
  if (!tl || !el) return null;
  const wasPlaying = playing.value;
  playing.value = false;
  const restore = tMs.value;
  tMs.value = tl.finalSceneMs;
  stillCapture = true; // 封面帧：关闭盐边闪光等闪烁装饰
  try {
    draw();
  } finally {
    stillCapture = false;
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    el.toBlob((b) => resolve(b), "image/png"),
  );
  tMs.value = restore;
  playing.value = wasPlaying;
  return blob;
}

defineExpose({
  seekTo,
  seekToStep,
  togglePlay,
  captureCover,
  timeline,
});

/* ── 控件辅助 ── */
const speedOptions = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
];

const scrubMax = 1000;

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const totalMs = computed(() => timeline.value?.totalMs ?? 0);

/** range 0..1000 ⇄ tMs 0..totalMs */
const tMsProxy = computed({
  get: () =>
    totalMs.value > 0 ? Math.round((tMs.value / totalMs.value) * scrubMax) : 0,
  set: (v: number) => {
    seekTo((v / scrubMax) * totalMs.value);
  },
});

const speedProxy = computed({
  get: () => String(speed.value),
  set: (v: string) => {
    speed.value = Number(v);
  },
});
</script>

<template>
  <div v-if="timeline" class="flex flex-col gap-3">
    <div class="relative overflow-hidden rounded-xl border border-border bg-card">
      <canvas ref="canvasEl" class="block w-full" />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="icon" variant="outline" :title="playing ? '暂停' : '播放'" @click="togglePlay()">
        <Pause v-if="playing" class="size-4" />
        <Play v-else class="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title="重播"
        @click="seekTo(0); playing = true"
      >
        <RotateCcw class="size-4" />
      </Button>

      <input
        v-model.number="tMsProxy"
        type="range"
        :max="scrubMax"
        :min="0"
        step="1"
        class="h-1.5 min-w-32 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
        aria-label="时间轴"
      />

      <span class="w-20 text-right text-xs tabular-nums text-muted-foreground">
        {{ fmt(tMs) }} / {{ fmt(totalMs) }}
      </span>

      <Select v-model="speedProxy">
        <SelectTrigger class="h-8 w-16 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="o in speedOptions"
            :key="o.value"
            :value="String(o.value)"
          >
            {{ o.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
  <div
    v-else
    class="flex aspect-[400/520] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
  >
    动画不可用（配方数据不完整）
  </div>
</template>
