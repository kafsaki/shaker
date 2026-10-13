<script setup lang="ts">
/**
 * 像素头像：真实头像先缩到 res×res 的小画布（平滑缩小 = 取色块均值），
 * 再按 CSS 尺寸 pixelated 放大 —— 任何照片都变成像素立绘。
 * 没有头像或加载失败时，按 seed 生成 5×5 对称像素图腾（同一用户永远同一个）。
 * 跨域图片不设 crossOrigin：画布会被「污染」但照常显示，我们从不回读像素。
 */
const props = withDefaults(
  defineProps<{ src?: string | null; seed?: string; size?: number; res?: number }>(),
  { size: 32 },
);

const canvas = ref<HTMLCanvasElement | null>(null);
const resolution = computed(() => props.res ?? (props.size >= 64 ? 32 : 16));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TOTEM_COLORS = ["--amber", "--pink", "--cyan", "--green", "--gold"];

function drawTotem(ctx: CanvasRenderingContext2D, n: number): void {
  const css = getComputedStyle(canvas.value!);
  const v = (name: string) => css.getPropertyValue(name).trim() || "#888";
  const h = hash(props.seed || "?");
  ctx.fillStyle = v("--panel-lo");
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = v(TOTEM_COLORS[h % TOTEM_COLORS.length]!);
  const cell = n / 8; // 5×5 图腾 + 每边 1.5 格留白
  const off = cell * 1.5;
  let bits = h >>> 3;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (bits & 1) {
        ctx.fillRect(off + x * cell, off + y * cell, cell, cell);
        ctx.fillRect(off + (4 - x) * cell, off + y * cell, cell, cell);
      }
      bits >>>= 1;
    }
  }
}

function render(): void {
  const el = canvas.value;
  if (!el) return;
  const n = resolution.value;
  el.width = n;
  el.height = n;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  drawTotem(ctx, n);
  if (!props.src) return;
  const img = new Image();
  img.onload = () => {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      n,
      n,
    );
  };
  img.src = props.src;
}

onMounted(render);
watch(() => [props.src, props.seed, resolution.value], render);

// 主题切换后图腾底色要跟着换
const { theme } = useTheme();
watch(theme, () => nextTick(render));
</script>

<template>
  <span
    class="inline-block shrink-0 bg-panel-lo px-ring"
    :style="{ width: `${size}px`, height: `${size}px`, margin: '2px' }"
  >
    <canvas ref="canvas" class="block size-full" />
  </span>
</template>
