<script setup lang="ts">
/**
 * 吧台上睡觉的黑猫「煤球」。摸一下抬头、喵一声、冒颗心；连着摸会呼噜。
 * 彩蛋：一口气连摸 9 下，它会站起来把旁边的杯子推下吧台（emit prank，酒保接话），
 * 推杯数与累计摸猫数记在 localStorage（shaker_cat），首次推杯 / 摸满 99 下各解锁一个成就。
 * 「减少动效」时不换呼吸帧、不走动，状态照常切换。
 */
import { CAT, CAT_PALETTE, ROCKS_GLASS, ROCKS_PALETTE } from "@/lib/pixel-sprites";
import { toast } from "@/lib/toast";

const emit = defineEmits<{ prank: [glasses: number] }>();

type Pose = "sleep" | "awake" | "meow" | "stand";
const STORE_KEY = "shaker_cat";
const COMBO_MS = 1400;
const PRANK_AT = 9;

const { theme } = useTheme();
const { prefs } = usePrefs();
const { play } = useSfx();

const pose = ref<Pose>("sleep");
const breath = ref(false);
const walked = ref(false);
const bubble = ref("");
const hearts = ref<number[]>([]);
const glass = ref<"on" | "falling" | "gone">("on");
const crash = ref(false);
const busy = ref(false);

let combo = 0;
let lastPat = 0;
let heartId = 0;
let breathTimer: ReturnType<typeof setInterval> | undefined;
let napTimer: ReturnType<typeof setTimeout> | undefined;
const timers: ReturnType<typeof setTimeout>[] = [];

function later(ms: number, fn: () => void): void {
  timers.push(setTimeout(fn, ms));
}

function loadStore(): { pats: number; glasses: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return { pats: Number(raw.pats) || 0, glasses: Number(raw.glasses) || 0 };
  } catch {
    return { pats: 0, glasses: 0 };
  }
}
function saveStore(s: { pats: number; glasses: number }): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

const rows = computed(() => {
  if (pose.value === "sleep") return breath.value ? CAT.sleepB : CAT.sleepA;
  return CAT[pose.value];
});

const label = computed(() =>
  pose.value === "sleep" ? "吧台上睡着一只黑猫，摸一摸" : "黑猫煤球醒着，再摸一摸",
);

/** 一段时间没人理它就接着睡 */
function scheduleNap(ms = 2600): void {
  clearTimeout(napTimer);
  napTimer = setTimeout(() => {
    if (busy.value) return;
    pose.value = "sleep";
    bubble.value = "";
    combo = 0;
  }, ms);
}

function popHeart(): void {
  const id = ++heartId;
  hearts.value.push(id);
  later(700, () => (hearts.value = hearts.value.filter((h) => h !== id)));
}

const MEOWS = ["喵？", "喵～", "喵。", "……喵"];

function pat(): void {
  if (busy.value) return;
  const now = Date.now();
  combo = now - lastPat < COMBO_MS ? combo + 1 : 1;
  lastPat = now;

  const store = loadStore();
  store.pats++;
  saveStore(store);
  if (store.pats === 99) {
    toast.success("成就解锁 · 猫奴", { description: "你已经摸了煤球 99 下。它记住你的手了。" });
  }

  popHeart();
  if (combo >= PRANK_AT && glass.value === "on") {
    prank(store);
    return;
  }
  if (combo >= 3) {
    pose.value = "awake";
    bubble.value = "呼噜呼噜……";
    play("purr");
  } else {
    const woke = pose.value === "sleep";
    pose.value = combo % 2 ? "meow" : "awake";
    bubble.value = woke ? "喵？" : MEOWS[store.pats % MEOWS.length]!;
    play("meow");
  }
  scheduleNap();
}

/** 第 9 下：站起来 → 走到杯子边 → 一爪推下去 → CRASH → 若无其事坐回去 */
function prank(store: { pats: number; glasses: number }): void {
  busy.value = true;
  clearTimeout(napTimer);
  combo = 0;
  pose.value = "stand";
  bubble.value = "……";
  later(500, () => {
    walked.value = true;
    bubble.value = "";
  });
  later(1200, () => {
    glass.value = "falling";
  });
  later(1700, () => {
    glass.value = "gone";
    crash.value = true;
    play("crash");
    store.glasses++;
    saveStore(store);
    emit("prank", store.glasses);
    if (store.glasses === 1) {
      toast.success("成就解锁 · 九命猫", { description: "连摸煤球 9 下，它把杯子推下了吧台。" });
    }
  });
  later(2300, () => (walked.value = false));
  later(2900, () => (crash.value = false));
  later(3100, () => {
    pose.value = "meow";
    bubble.value = "喵。";
    play("meow");
  });
  later(5200, () => {
    busy.value = false;
    glass.value = "on";
    scheduleNap(400);
  });
}

onMounted(() => {
  if (!prefs.value.calm) {
    breathTimer = setInterval(() => {
      if (pose.value === "sleep") breath.value = !breath.value;
    }, 1100);
  }
});
onBeforeUnmount(() => {
  clearInterval(breathTimer);
  clearTimeout(napTimer);
  timers.forEach(clearTimeout);
});
</script>

<template>
  <div class="cat-spot">
    <button
      type="button"
      class="cat"
      :class="{ walked }"
      :aria-label="label"
      :title="pose === 'sleep' ? '嘘——它在睡觉' : '煤球'"
      @click="pat()"
    >
      <span v-if="pose === 'sleep'" class="zzz font-logo" aria-hidden="true">
        <span>z</span><span>z</span><span>Z</span>
      </span>
      <span v-if="bubble" :key="bubble" class="bubble animate-pop-in">{{ bubble }}</span>
      <span v-for="h in hearts" :key="h" class="heart" aria-hidden="true">
        <PxIcon name="heart" class="text-pink" />
      </span>
      <PxSprite :rows="rows" :palette="CAT_PALETTE" :scale="4" />
    </button>

    <div v-if="glass !== 'gone'" class="glass" :class="{ falling: glass === 'falling' }" aria-hidden="true">
      <PxSprite :rows="ROCKS_GLASS" :palette="ROCKS_PALETTE[theme]" :scale="4" />
    </div>
    <span v-if="crash" class="crash font-logo animate-pop-in" aria-hidden="true">CRASH!</span>
  </div>
</template>

<style scoped>
/* 定位交给父组件；这里只排猫、杯子与气泡。不设 z-index（不建层叠上下文），
   这样杯子掉下去时能钻到台面后面。 */
.cat-spot {
  width: 144px;
  height: 60px;
}
.cat {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  align-items: flex-end;
  transition: left 0.5s steps(3);
}
.cat.walked { left: 26px; }
.cat:hover :deep(svg) { filter: brightness(1.25); }
.glass {
  position: absolute;
  left: 116px;
  bottom: 0;
  z-index: 1;
}
.glass.falling { animation: glass-fall 0.5s steps(5) forwards; }
@keyframes glass-fall {
  0% { transform: translate(0, 0) rotate(0); }
  30% { transform: translate(8px, -2px) rotate(20deg); }
  100% { transform: translate(22px, 56px) rotate(100deg); }
}
.crash {
  position: absolute;
  left: 92px;
  bottom: 40px;
  z-index: 4;
  font-size: 16px;
  color: var(--amber);
  text-shadow: 2px 2px 0 var(--ink);
  white-space: nowrap;
}
.bubble {
  position: absolute;
  left: -6px;
  bottom: 54px;
  z-index: 4;
  padding: 0 6px;
  white-space: nowrap;
  background: var(--panel-hi);
  color: var(--fg);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink);
}
/* 气泡尾巴：一格一格往下收 */
.bubble::after {
  content: "";
  position: absolute;
  left: 12px;
  top: 100%;
  width: 6px;
  height: 4px;
  margin-top: var(--p);
  background: var(--ink);
  clip-path: polygon(0 0, 100% 0, 0 100%);
}
.heart {
  position: absolute;
  left: 56px;
  bottom: 36px;
  z-index: 4;
  animation: px-float-up 0.7s steps(6) forwards;
}
.zzz {
  position: absolute;
  left: 8px;
  bottom: 40px;
  font-size: 8px;
  color: var(--dim);
  pointer-events: none;
}
.zzz span {
  position: absolute;
  opacity: 0;
  animation: zzz 3s steps(6) infinite;
}
.zzz span:nth-child(1) { left: 0; animation-delay: 0s; }
.zzz span:nth-child(2) { left: 8px; animation-delay: 1s; }
.zzz span:nth-child(3) { left: 16px; animation-delay: 2s; }
@keyframes zzz {
  0% { transform: translateY(0); opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateY(-18px); opacity: 0; }
}
html.calm .zzz span { opacity: 1; animation: none; }
</style>
