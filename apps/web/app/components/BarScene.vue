<script setup lang="ts">
/**
 * 大厅吧台场景：护墙板后墙 + 两层酒架（瓶型/酒色按下标确定性挑选）+ 霓虹招牌 +
 * 站在吧台后的酒保 + 木质台面。纯装饰，默认插槽叠在台面上（放对白框）。
 */
import { BARTENDER, BARTENDER_PALETTE, BOTTLES, LIQUORS } from "@/lib/pixel-sprites";

const { theme } = useTheme();
const SHAPES = ["tall", "squat", "flask", "tall", "squat"] as const;

function bottle(i: number) {
  const shape = SHAPES[(i * 7 + 3) % SHAPES.length]!;
  const liq = LIQUORS[(i * 5 + 1) % LIQUORS.length]!;
  const ink = theme.value === "dark" ? "#06030b" : "#3a2a1e";
  return {
    rows: BOTTLES[shape],
    palette: { k: ink, g: liq.g, h: liq.h, c: i % 3 ? "#5a4a3a" : "#c9a24a", l: "#efe2c4" },
  };
}
const shelves = [Array.from({ length: 24 }, (_, i) => i), Array.from({ length: 24 }, (_, i) => i + 24)];
</script>

<template>
  <div class="scene">
    <div class="wall" aria-hidden="true">
      <div class="neon font-logo">
        <span>SHAKER</span><span class="flick">·</span><span>BAR</span>
      </div>
      <div v-for="(row, r) in shelves" :key="r" class="shelf" :style="{ top: `${r === 0 ? 34 : 104}px` }">
        <div class="bottles">
          <PxSprite
            v-for="i in row"
            :key="i"
            :rows="bottle(i).rows"
            :palette="bottle(i).palette"
            :scale="3"
          />
        </div>
        <div class="plank" />
      </div>
      <div class="tender">
        <PxSprite :rows="BARTENDER" :palette="BARTENDER_PALETTE[theme]" :scale="8" />
      </div>
    </div>
    <div class="counter" aria-hidden="true" />
    <div class="relative z-10 -mt-6 px-3 sm:px-8">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.scene { position: relative; }
.wall {
  position: relative;
  height: 230px;
  overflow: hidden;
  background-color: var(--panel-lo);
  /* 护墙板竖纹 */
  background-image: repeating-linear-gradient(90deg, transparent 0 46px, var(--lo) 46px 48px);
  box-shadow: 0 0 0 var(--p) var(--ink), inset 0 calc(var(--p) * 2) 0 0 var(--hi);
}
.neon {
  position: absolute;
  right: 24px;
  top: 12px;
  z-index: 2;
  display: flex;
  gap: 8px;
  font-size: 16px;
  color: var(--pink);
  text-shadow: 0 0 6px var(--pink), 0 0 14px color-mix(in srgb, var(--pink) 60%, transparent);
}
:root:not(.dark) .neon { text-shadow: 2px 2px 0 var(--ink); }
.flick { animation: neon-flick 3.6s steps(1) infinite; }
@keyframes neon-flick {
  0%, 62%, 66%, 100% { opacity: 1; }
  63%, 65% { opacity: 0.15; }
}
.shelf { position: absolute; left: 0; right: 0; }
.bottles {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 14px;
  height: 52px;
  padding: 0 12px;
}
.plank {
  height: 8px;
  background: #5c3c24;
  box-shadow: inset 0 2px 0 0 #c9986a, 0 2px 0 0 var(--ink), 0 6px 0 0 rgb(0 0 0 / 0.25);
}
.tender {
  position: absolute;
  bottom: 0;
  left: 12%;
  z-index: 1;
}
.counter {
  position: relative;
  z-index: 2;
  height: 56px;
  margin-top: -18px;
  background: #7a4a2a;
  background-image: repeating-linear-gradient(90deg, transparent 0 62px, rgb(0 0 0 / 0.18) 62px 64px);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset 0 calc(var(--p) * 2) 0 0 #e8b880,
    inset 0 calc(var(--p) * 4) 0 0 #a8683e,
    inset 0 calc(var(--p) * -3) 0 0 rgb(0 0 0 / 0.3);
}
@media (max-width: 640px) {
  .tender { left: 4%; }
  .neon { font-size: 8px; }
}
</style>
