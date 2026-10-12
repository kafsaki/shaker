<script setup lang="ts">
/**
 * 游戏对话窗：网点遮罩 + 弹出窗口（steps 缩放入场）+ 标题栏 ✕ 关闭。
 * v-model:open 控制；footer 插槽放确认按钮。开关时播放音效。
 */
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import type { PixelIconName } from "@/lib/pixel-icons";

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    icon?: PixelIconName;
    size?: "sm" | "md" | "lg";
    tone?: "amber" | "pink" | "cyan" | "green" | "red";
  }>(),
  { size: "md", tone: "amber" },
);
const open = defineModel<boolean>("open", { default: false });
const { play } = useSfx();
watch(open, (o, prev) => {
  if (o !== prev) play(o ? "open" : "close");
});
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="px-dlg-overlay" />
      <DialogContent class="px-dlg" :class="[`s-${size}`, `t-${tone}`]">
        <header class="px-dlg-bar">
          <PxIcon v-if="icon" :name="icon" :scale="2" class="tone" />
          <DialogTitle class="px-dlg-title">{{ title }}</DialogTitle>
          <DialogClose class="px-dlg-x" aria-label="关闭">
            <PxIcon name="x" :scale="1" />
          </DialogClose>
        </header>
        <div class="px-dlg-body">
          <DialogDescription v-if="description" class="mb-3 text-dim">
            {{ description }}
          </DialogDescription>
          <slot />
        </div>
        <footer v-if="$slots.footer" class="px-dlg-foot">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.px-dlg-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background-color: rgb(6 3 11 / 0.55);
  background-image: conic-gradient(rgb(6 3 11 / 0.6) 25%, transparent 0 50%, rgb(6 3 11 / 0.6) 0 75%, transparent 0);
  background-size: 4px 4px;
}
.px-dlg {
  --tone: var(--amber);
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 81;
  width: calc(100vw - 32px);
  max-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
  translate: -50% -50%;
  background: var(--panel);
  color: var(--fg);
  font-family: var(--font-pixel);
  font-size: 12px;
  outline: none;
  box-shadow:
    0 calc(var(--p) * -2) 0 0 var(--ink),
    0 calc(var(--p) * 2) 0 0 var(--ink),
    calc(var(--p) * -2) 0 0 0 var(--ink),
    calc(var(--p) * 2) 0 0 0 var(--ink),
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    calc(var(--p) * 5) calc(var(--p) * 5) 0 0 var(--shadow);
  animation: px-pop-in 0.18s steps(4) both;
}
.px-dlg.s-sm { max-width: 380px; }
.px-dlg.s-md { max-width: 520px; }
.px-dlg.s-lg { max-width: 760px; }
.px-dlg.t-pink { --tone: var(--pink); }
.px-dlg.t-cyan { --tone: var(--cyan); }
.px-dlg.t-green { --tone: var(--green); }
.px-dlg.t-red { --tone: var(--red); }
.px-dlg-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 14px;
  background: var(--tone);
  color: var(--on-accent);
  border-bottom: var(--p) solid var(--ink);
  box-shadow: inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35);
}
.px-dlg-bar .tone { color: var(--on-accent); }
.px-dlg-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  letter-spacing: 0.12em;
}
.px-dlg-x {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  background: var(--panel);
  color: var(--fg);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--hi);
}
.px-dlg-x:hover { background: var(--red); color: #fff; }
.px-dlg-body {
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
.px-dlg-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px 14px;
  border-top: var(--p) dashed var(--line);
}
</style>
