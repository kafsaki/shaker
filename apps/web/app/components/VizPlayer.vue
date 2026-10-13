<script setup lang="ts">
/**
 * 调酒动画播放器 —— 产品核心资产，外观是一台吧台小电视。
 *
 * 管线：compile → sample(t) → renderScene，60fps 连续取样（ADR-031；坐标仍吸附像素格）。
 * 控制：播放/暂停、上一步/下一步、重播、倍速；时间轴按步骤分段（段长 = 步骤时长），
 * 点击或拖动任意位置即 seek。键盘：空格 播放/暂停，←/→ 上/下一步，R 重播。
 * captureCover() 在 finalSceneMs 定格帧上 toBlob（ADR-015 前端截帧封面）。
 */
import { compile, sample, type Timeline } from "@shaker/animator-core";
import { DARK_THEME, LIGHT_THEME, renderScene } from "@shaker/animator-web";
import type { RecipeIR, VocabLookup } from "@shaker/recipe-ir/core";

const props = withDefaults(
  defineProps<{
    ir: RecipeIR;
    vocab: VocabLookup;
    /** 全局键盘快捷键（编辑器里关掉，避免和表单输入抢键） */
    hotkeys?: boolean;
  }>(),
  { hotkeys: true },
);

const emit = defineEmits<{
  /** 步骤推进 —— 配方页用它高亮文字步骤（按 10% 进度节流）。 */
  progress: [stepIndex: number, stepProgress: number];
}>();

const STAGE = { width: 400, height: 520 } as const;

const canvasEl = ref<HTMLCanvasElement | null>(null);
const playing = ref(true);
const speed = ref("1");
const tMs = ref(0);
const { theme } = useTheme();
const { play: sfx } = useSfx();

const timeline = shallowRef<Timeline | null>(null);
// 注意：recompile() 经 watch immediate 在 setup 早期就会跑，这两个必须先声明（TDZ）
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
let lastBannerStep = -1;

function recompile(): void {
  try {
    timeline.value = compile(props.ir, props.vocab, { stage: STAGE });
    tMs.value = 0;
    playing.value = true;
    lastBannerStep = -1; // 让 STEP 1 横幅重新弹出
    clearTimeout(bannerTimer);
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
  ctx ??= canvasEl.value.getContext("2d", { alpha: false });
  return ctx;
}

function resizeCanvas(): void {
  const el = canvasEl.value;
  if (!el) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  el.width = Math.round(STAGE.width * dpr);
  el.height = Math.round(STAGE.height * dpr);
  el.style.aspectRatio = `${STAGE.width} / ${STAGE.height}`;
  ensureCtx()?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

onMounted(() => resizeCanvas());

/* ── 绘制 ── */
let lastEmitKey = "";
/** 步骤横幅：切换步骤时在屏幕顶部短暂弹出（移植自原型的像素风过场提示）。 */
const bannerText = ref("");
const bannerOn = ref(false);

/**
 * 按指定主题在给定时刻渲染一帧，返回该帧的采样结果。
 * 与播放器当前主题解耦——封面需要在同一时刻分别渲染暗/亮两套（ADR-015）。
 */
function renderSceneAt(c: CanvasRenderingContext2D, themeName: "dark" | "light", ms: number) {
  const tl = timeline.value;
  if (!tl) return null;
  const s = sample(tl, ms);
  renderScene(c, s.scene, { theme: themeName === "dark" ? DARK_THEME : LIGHT_THEME });
  return s;
}

function draw(): void {
  const tl = timeline.value;
  const c = ensureCtx();
  if (!tl || !c) return;

  const sampled = renderSceneAt(c, theme.value, tMs.value);
  if (!sampled) return;
  const { step, stepProgress } = sampled;

  const idx = tl.steps.findIndex((s) => s.stepId === step.stepId);
  if (idx !== lastBannerStep) {
    lastBannerStep = idx;
    const s = tl.steps[idx];
    if (s) {
      const isFinal = s.stepId === "__final";
      bannerText.value = isFinal ? "★ SERVE! ★" : `STEP ${idx + 1} · ${s.label.zh}`;
      bannerOn.value = true;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => (bannerOn.value = false), isFinal ? 1800 : 1100);
      if (playing.value) sfx(isFinal ? "coin" : "step");
    }
  }
  // 步骤事件按量化节流：只在步骤切换或进度每 10% 时向父组件发一次
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
    tMs.value += dt * Number(speed.value);
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

/* ── 控制 ── */
const totalMs = computed(() => timeline.value?.totalMs ?? 0);
const steps = computed(() => timeline.value?.steps ?? []);
const atEnd = computed(() => totalMs.value > 0 && tMs.value >= totalMs.value);

/** 当前步骤下标（与 sample 同口径：落在 [startMs, startMs + durationMs) 的那一步）。 */
const current = computed(() => {
  const list = steps.value;
  for (let i = list.length - 1; i >= 0; i--) {
    if (tMs.value >= list[i]!.startMs) return i;
  }
  return 0;
});

function seekTo(ms: number): void {
  if (!timeline.value) return;
  tMs.value = Math.max(0, Math.min(totalMs.value, ms));
  draw();
}

/** 单步回看：跳到某一步的起点。index 超 __final 也安全（clamp）。 */
function seekToStep(index: number): void {
  const list = steps.value;
  const s = list[Math.max(0, Math.min(list.length - 1, index))];
  if (s) seekTo(s.startMs);
}

function togglePlay(): void {
  if (!timeline.value) return;
  if (!playing.value && atEnd.value) tMs.value = 0; // 播到底后按播放 = 重播
  playing.value = !playing.value;
  sfx(playing.value ? "confirm" : "cancel");
}

function replay(): void {
  seekTo(0);
  lastBannerStep = -1;
  playing.value = true;
  sfx("start");
}

/** 上一步：本步已播超过 0.4s 时先回到本步开头（与音乐播放器一致），否则退到上一步。 */
function prevStep(): void {
  const s = steps.value[current.value];
  const back = s && tMs.value - s.startMs > 400 ? current.value : current.value - 1;
  seekToStep(back);
  sfx("step");
}

function nextStep(): void {
  if (current.value >= steps.value.length - 1) seekTo(totalMs.value);
  else seekToStep(current.value + 1);
  sfx("step");
}

/* ── 分段时间轴：点击 / 拖动 seek ── */
const track = ref<HTMLElement | null>(null);
let scrubbing = false;
let wasPlaying = false;

function seekFromPointer(e: PointerEvent): void {
  const el = track.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  seekTo(ratio * totalMs.value);
}
function onTrackDown(e: PointerEvent): void {
  scrubbing = true;
  wasPlaying = playing.value;
  playing.value = false;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  seekFromPointer(e);
}
function onTrackMove(e: PointerEvent): void {
  if (scrubbing) seekFromPointer(e);
}
function onTrackUp(): void {
  if (!scrubbing) return;
  scrubbing = false;
  if (wasPlaying && !atEnd.value) playing.value = true;
}

/** 每段的填充比例 0..1。 */
function segFill(i: number): number {
  const s = steps.value[i];
  if (!s) return 0;
  if (i < current.value) return 1;
  if (i > current.value) return 0;
  return s.durationMs > 0 ? Math.min(1, (tMs.value - s.startMs) / s.durationMs) : 1;
}

/* ── 键盘 ── */
function onKey(e: KeyboardEvent): void {
  if (!props.hotkeys || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (document.querySelector("[role='dialog']")) return;
  if (e.key === " ") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    prevStep();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    nextStep();
  } else if (e.key === "r" || e.key === "R") {
    replay();
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

/** 成品定格帧截图：暗/亮两套主题各截一帧（ADR-015：封面 = finalSceneMs 定格帧 toBlob）。 */
async function captureCover(): Promise<{ dark: Blob; light: Blob } | null> {
  const tl = timeline.value;
  const el = canvasEl.value;
  const c = ensureCtx();
  if (!tl || !el || !c) return null;
  const was = playing.value;
  playing.value = false;
  const restore = tMs.value;
  tMs.value = tl.finalSceneMs;

  const grab = (): Promise<Blob | null> =>
    new Promise((resolve) => el.toBlob((b) => resolve(b), "image/png"));

  renderSceneAt(c, "dark", tMs.value);
  const dark = await grab();
  renderSceneAt(c, "light", tMs.value);
  const light = await grab();

  tMs.value = restore;
  playing.value = was;
  draw(); // 立即把画布恢复成当前主题的帧（rAF 下一帧也会重绘，这里避免闪一瞬）
  if (!dark || !light) return null;
  return { dark, light };
}

defineExpose({ seekTo, seekToStep, togglePlay, captureCover, timeline });

const SPEEDS = [
  { value: "0.5", label: "0.5×" },
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
];

/** 读数：秒数补零到 3 位整数（像街机计时器）。 */
function fmt(ms: number): string {
  return (ms / 1000).toFixed(1).padStart(5, "0");
}
</script>

<template>
  <div v-if="timeline" class="tv">
    <div class="screen">
      <canvas ref="canvasEl" data-viz class="block w-full" />
      <div class="banner" :class="{ show: bannerOn }">{{ bannerText }}</div>
      <span v-if="!playing && !atEnd" class="osd animate-blink">❚❚ PAUSE</span>
    </div>

    <div class="deck">
      <!-- 分段时间轴 -->
      <div
        ref="track"
        class="track"
        role="slider"
        aria-label="时间轴"
        :aria-valuemin="0"
        :aria-valuemax="Math.round(totalMs)"
        :aria-valuenow="Math.round(tMs)"
        @pointerdown="onTrackDown"
        @pointermove="onTrackMove"
        @pointerup="onTrackUp"
        @pointercancel="onTrackUp"
      >
        <span
          v-for="(s, i) in steps"
          :key="s.stepId"
          class="seg"
          :class="{ now: i === current, fin: s.stepId === '__final' }"
          :style="{ flexGrow: Math.max(1, s.durationMs) }"
          :title="s.stepId === '__final' ? '成品' : `${i + 1}. ${s.label.zh}`"
        >
          <i :style="{ width: `${segFill(i) * 100}%` }" />
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-x-2 gap-y-2">
        <PxButton square size="sm" icon="prev" title="上一步（←）" :sfx="false" @click="prevStep()" />
        <PxButton
          variant="primary"
          square
          :icon="playing ? 'pause' : 'play'"
          :title="playing ? '暂停（空格）' : '播放（空格）'"
          :sfx="false"
          @click="togglePlay()"
        />
        <PxButton square size="sm" icon="next" title="下一步（→）" :sfx="false" @click="nextStep()" />
        <PxButton square size="sm" icon="replay" title="重播（R）" :sfx="false" @click="replay()" />
        <span class="clock font-logo">
          <span class="text-amber">{{ fmt(tMs) }}</span><span class="text-faint">/{{ fmt(totalMs) }}</span>
        </span>
        <PxSegmented v-model="speed" :items="SPEEDS" size="sm" class="ml-auto" />
      </div>

      <div class="flex items-center justify-between text-faint">
        <span class="flex items-center gap-2">
          <i class="led" :class="{ on: playing }" />
          <span class="font-logo text-[8px] tracking-[0.2em]">SHAKER·VISION</span>
        </span>
        <span v-if="hotkeys" class="hidden items-center gap-1 sm:flex">
          <PxKbd>SPACE</PxKbd><PxKbd>←</PxKbd><PxKbd>→</PxKbd><PxKbd>R</PxKbd>
        </span>
      </div>
    </div>
  </div>
  <div v-else class="tv">
    <div class="screen grid aspect-[400/520] place-items-center px-dither" style="--dither: var(--panel-lo)">
      <div class="flex flex-col items-center gap-3 text-faint">
        <PxIcon name="warn" :scale="4" />
        <p>NO SIGNAL · 配方数据不完整</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tv {
  margin: calc(var(--p) * 2);
  padding: 10px 10px 8px;
  background: var(--panel-hi);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    0 0 0 calc(var(--p) * 2) var(--line),
    0 0 0 calc(var(--p) * 3) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -2) 0 0 var(--lo),
    calc(var(--p) * 5) calc(var(--p) * 5) 0 0 var(--shadow);
}
.screen {
  position: relative;
  overflow: hidden;
  background: var(--deep);
  box-shadow: 0 0 0 calc(var(--p) * 2) var(--ink);
}
.banner {
  position: absolute;
  top: 14px;
  left: 50%;
  max-width: calc(100% - 24px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  translate: -50% 0;
  padding: 6px 12px;
  background: var(--panel);
  color: var(--amber-hi);
  font-size: 12px;
  letter-spacing: 0.1em;
  box-shadow: 0 0 0 var(--p) var(--ink), 0 0 0 calc(var(--p) * 2) var(--amber), calc(var(--p) * 3) calc(var(--p) * 3) 0 var(--p) var(--shadow);
  opacity: 0;
  transition: opacity 0.12s steps(2);
  pointer-events: none;
}
:root:not(.dark) .banner { color: var(--amber-lo); }
.banner.show { opacity: 1; }
.osd {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 2px 6px;
  background: var(--ink);
  color: var(--fg);
  font-family: var(--font-logo);
  font-size: 8px;
}
.deck { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
.track {
  display: flex;
  gap: 2px;
  height: 16px;
  padding: 2px;
  background: var(--ink);
  touch-action: none;
  cursor: var(--cursor-hand);
}
.seg {
  position: relative;
  flex-basis: 0;
  min-width: 4px;
  background: var(--panel-lo);
}
.seg i {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--amber-lo);
}
.seg.now i { background: var(--amber); box-shadow: inset 0 2px 0 0 rgb(255 255 255 / 0.35); }
.seg.fin { background: color-mix(in srgb, var(--gold) 25%, var(--panel-lo)); }
.seg.fin i { background: var(--gold); }
.seg:hover { background: var(--line); }
.clock { margin-left: 6px; font-size: 8px; letter-spacing: 0.08em; }
.led {
  width: 6px;
  height: 6px;
  background: var(--faint);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.led.on { background: var(--green); box-shadow: 0 0 0 var(--p) var(--ink), 0 0 6px var(--green); }
</style>
