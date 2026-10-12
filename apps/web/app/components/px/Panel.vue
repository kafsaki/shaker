<script setup lang="ts">
/**
 * 游戏窗口：缺角描边 + 凸起斜面 + 硬投影；可选标题栏（色条 + 图标 + 右侧动作槽）。
 * variant：window 普通窗口 | inset 凹槽（嵌在窗口里的分区）| glow 高亮（当前任务/选中）
 */
import type { PixelIconName } from "@/lib/pixel-icons";

withDefaults(
  defineProps<{
    title?: string;
    icon?: PixelIconName;
    tone?: "amber" | "pink" | "cyan" | "green" | "plain";
    variant?: "window" | "inset" | "glow";
    padded?: boolean;
    as?: string;
  }>(),
  { tone: "amber", variant: "window", padded: true, as: "section" },
);
</script>

<template>
  <component :is="as" class="px-panel" :class="[`v-${variant}`, `t-${tone}`]">
    <header v-if="title || $slots.title || $slots.actions" class="bar">
      <span class="mark" aria-hidden="true" />
      <PxIcon v-if="icon" :name="icon" :scale="2" class="tone" />
      <h2 class="title"><slot name="title">{{ title }}</slot></h2>
      <div class="ml-auto flex items-center gap-1"><slot name="actions" /></div>
    </header>
    <div :class="padded ? 'p-4' : ''"><slot /></div>
  </component>
</template>

<style scoped>
.px-panel {
  --tone: var(--amber);
  position: relative;
  background: var(--panel);
  margin: var(--p);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    calc(var(--p) * 3) calc(var(--p) * 3) 0 0 var(--shadow);
}
.t-pink { --tone: var(--pink); }
.t-cyan { --tone: var(--cyan); }
.t-green { --tone: var(--green); }
.t-plain { --tone: var(--dim); }

.v-inset {
  background: var(--panel-lo);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(var(--p) * -1) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    inset var(--p) var(--p) 0 0 var(--lo),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--hi);
}
.v-glow {
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--tone),
    0 var(--p) 0 0 var(--tone),
    calc(var(--p) * -1) 0 0 0 var(--tone),
    var(--p) 0 0 0 var(--tone),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 3) calc(var(--p) * 3) 0 var(--p) var(--shadow),
    0 0 24px color-mix(in srgb, var(--tone) 25%, transparent);
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 6px 10px 6px 12px;
  background: var(--panel-hi);
  border-bottom: var(--p) solid var(--ink);
  box-shadow: inset var(--p) var(--p) 0 0 var(--hi);
}
.mark {
  width: 6px;
  height: 14px;
  background: var(--tone);
  box-shadow: var(--p) var(--p) 0 0 var(--ink);
}
.tone { color: var(--tone); }
.title {
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.12em;
  color: var(--fg);
}
</style>
