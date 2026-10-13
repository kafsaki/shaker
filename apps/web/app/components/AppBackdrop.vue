<script setup lang="ts">
/**
 * 全站背景：1/4 分辨率画布 + pixelated 放大。
 * 夜班：Bayer 抖动的夜空分层 + 闪烁星星 + 两层城市剪影（近景窗户随机亮灯、偶尔闪烁）。
 * 日班：暖色天空 + 方块云 + 浅色剪影。
 * 所有「随机」都是坐标的确定性 hash，闪烁只看 tick —— 与动画器同一条纪律，重绘结果可复现。
 * 天空与剪影是静态层（只在尺寸/主题变化时重画），每个 tick 只贴静态层再画星星与窗户。
 */
const SCALE = 4;
const canvas = ref<HTMLCanvasElement | null>(null);
const { theme } = useTheme();
const { prefs } = usePrefs();
let tick = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function h32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
const rnd = (n: number) => h32(n) / 4294967296;

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

interface Pal {
  sky: [number, number, number][];
  star: string;
  far: string;
  near: string;
  win: string[];
  moon: string;
  cloud?: string;
}

const NIGHT: Pal = {
  sky: [
    [11, 7, 20],
    [18, 11, 34],
    [27, 16, 48],
    [38, 20, 60],
  ],
  star: "#f4ead5",
  far: "#1c1330",
  near: "#0f0a1a",
  win: ["#ffb547", "#ff5c8a", "#52d8e8", "#ffe08a"],
  moon: "#ffe9c2",
};
const DAY: Pal = {
  sky: [
    [243, 233, 210],
    [238, 226, 200],
    [233, 218, 187],
    [227, 209, 173],
  ],
  star: "#fffaf0",
  far: "#ddc9a3",
  near: "#d3bc92",
  win: ["#f0e2c4", "#e9d7b3"],
  moon: "#ffd88a",
  cloud: "#fbf5e6",
};

interface Building {
  x: number;
  top: number;
  w: number;
}

let layer: HTMLCanvasElement | null = null;
let nearBuildings: Building[] = [];

function buildStatic(W: number, H: number, P: Pal, night: boolean): void {
  layer ??= document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const ctx = layer.getContext("2d")!;

  // 天空：逐像素写 ImageData，色带后半段按 Bayer 阈值抖到下一色
  const img = ctx.createImageData(W, H);
  const band = H / P.sky.length;
  for (let y = 0; y < H; y++) {
    const f = y / band;
    const i = Math.min(P.sky.length - 1, Math.floor(f));
    const t = f - i;
    for (let x = 0; x < W; x++) {
      const thr = BAYER[y & 3]![x & 3]! / 16;
      const c = P.sky[i + 1 < P.sky.length && t > 0.5 && (t - 0.5) * 2 > thr ? i + 1 : i]!;
      const o = (y * W + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 月亮（夜，挖成月牙）/ 太阳（日）
  const mx = Math.floor(W * 0.82);
  const my = Math.floor(H * 0.16);
  ctx.fillStyle = P.moon;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dy * dy <= 26) ctx.fillRect(mx + dx, my + dy, 1, 1);
    }
  }
  if (night) {
    const [r, g, b] = P.sky[0]!;
    ctx.fillStyle = `rgb(${r} ${g} ${b})`;
    for (let dy = -6; dy <= 4; dy++) {
      for (let dx = -2; dx <= 8; dx++) {
        if ((dx - 3) * (dx - 3) + (dy + 1) * (dy + 1) <= 22) ctx.fillRect(mx + dx, my + dy, 1, 1);
      }
    }
  } else if (P.cloud) {
    ctx.fillStyle = P.cloud;
    for (let i = 0; i < 6; i++) {
      const cx = Math.floor(rnd(i * 13 + 1) * W);
      const cy = Math.floor(H * 0.08 + rnd(i * 13 + 2) * H * 0.35);
      const cw = 14 + Math.floor(rnd(i * 13 + 3) * 22);
      ctx.fillRect(cx, cy, cw, 3);
      ctx.fillRect(cx + 3, cy - 2, cw - 8, 2);
      ctx.fillRect(cx + 6, cy - 4, Math.max(4, cw - 16), 2);
    }
  }

  // 城市剪影：远景一层，近景一层（记下几何，窗户在动态层画）
  const layerOf = (seed: number, base: number, vary: number, minW: number, color: string): Building[] => {
    const out: Building[] = [];
    let x = -2;
    let k = 0;
    while (x < W) {
      const bw = minW + Math.floor(rnd(seed + k * 3) * minW);
      const bh = base + Math.floor(rnd(seed + k * 3 + 1) * vary);
      const top = H - bh;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, bw, bh);
      if (h32(seed + k * 3 + 2) % 4 === 0) ctx.fillRect(x + Math.floor(bw / 2), top - 3, 1, 3);
      out.push({ x, top, w: bw });
      x += bw + (rnd(seed + k * 3 + 5) > 0.7 ? 1 : 0);
      k++;
    }
    return out;
  };
  layerOf(1000, Math.floor(H * 0.12), Math.floor(H * 0.16), 8, P.far);
  nearBuildings = layerOf(5000, Math.floor(H * 0.05), Math.floor(H * 0.12), 6, P.near);
}

let builtFor = "";

function draw(): void {
  const el = canvas.value;
  if (!el) return;
  const W = Math.ceil(window.innerWidth / SCALE);
  const H = Math.ceil(window.innerHeight / SCALE);
  const night = theme.value === "dark";
  const P = night ? NIGHT : DAY;
  const key = `${W}x${H}:${theme.value}`;
  if (key !== builtFor) {
    el.width = W;
    el.height = H;
    buildStatic(W, H, P, night);
    builtFor = key;
  }
  const ctx = el.getContext("2d");
  if (!ctx || !layer) return;
  ctx.drawImage(layer, 0, 0);

  if (night) {
    const n = Math.floor((W * H) / 260);
    ctx.fillStyle = P.star;
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rnd(i * 7 + 1) * W);
      const y = Math.floor(rnd(i * 7 + 2) * H * 0.62);
      if ((tick + (h32(i * 7 + 3) % 5)) % 5 === 0) continue; // 每颗星 1/5 的时间熄灭
      ctx.globalAlpha = 0.35 + rnd(i * 7 + 4) * 0.65;
      ctx.fillRect(x, y, 1, 1);
      if (h32(i * 7 + 5) % 23 === 0) {
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  for (const b of nearBuildings) {
    for (let wy = b.top + 2; wy < H - 1; wy += 3) {
      for (let wx = b.x + 1; wx < b.x + b.w - 1; wx += 2) {
        const id = wx * 131 + wy * 977;
        if (h32(id) % 100 > (night ? 22 : 30)) continue;
        if (night && h32(id + 1) % 9 === 0 && (tick + (h32(id) % 4)) % 4 === 0) continue;
        ctx.fillStyle = P.win[h32(id + 2) % P.win.length]!;
        ctx.globalAlpha = night ? 0.85 : 1;
        ctx.fillRect(wx, wy, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function restartTimer(): void {
  clearInterval(timer);
  if (prefs.value.calm) return;
  timer = setInterval(() => {
    tick++;
    draw();
  }, 900);
}

let raf = 0;
function onResize(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}

onMounted(() => {
  draw();
  restartTimer();
  window.addEventListener("resize", onResize);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  cancelAnimationFrame(raf);
  window.removeEventListener("resize", onResize);
});
watch(theme, () => nextTick(draw));
watch(() => prefs.value.calm, restartTimer);
</script>

<template>
  <canvas
    ref="canvas"
    aria-hidden="true"
    class="pointer-events-none fixed inset-0 z-0 h-dvh w-screen"
  />
</template>
