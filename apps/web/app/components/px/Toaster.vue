<script setup lang="ts">
/** 消息条容器：右下角堆叠，新消息从右侧步进滑入；按类型配图标、配色与音效。 */
import { dismissToast, toastState, type ToastKind } from "@/lib/toast";
import type { PixelIconName } from "@/lib/pixel-icons";
import type { SfxName } from "@/composables/useSfx";

const { play } = useSfx();
const META: Record<ToastKind, { icon: PixelIconName; tone: string; sfx: SfxName; tag: string }> = {
  success: { icon: "check", tone: "var(--green)", sfx: "coin", tag: "OK" },
  error: { icon: "warn", tone: "var(--red)", sfx: "error", tag: "!!" },
  info: { icon: "info", tone: "var(--cyan)", sfx: "open", tag: "i" },
};

let last = 0;
watch(
  () => toastState.items.length,
  () => {
    const newest = toastState.items[toastState.items.length - 1];
    if (newest && newest.id > last) {
      last = newest.id;
      play(META[newest.kind].sfx);
    }
  },
);
</script>

<template>
  <div
    class="pointer-events-none fixed bottom-20 right-3 z-[90] flex w-[min(340px,calc(100vw-24px))] flex-col gap-3 md:bottom-6 md:right-6"
    aria-live="polite"
  >
    <TransitionGroup name="px-toast">
      <div
        v-for="t in toastState.items"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-3 bg-panel p-3 px-ring-2 px-raise px-drop"
        :style="{ '--ring': META[t.kind].tone }"
        role="status"
        @click="dismissToast(t.id)"
      >
        <span
          class="grid size-7 shrink-0 place-items-center text-on-accent px-ring"
          :style="{ background: META[t.kind].tone }"
        >
          <PxIcon :name="META[t.kind].icon" :scale="1" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-fg">{{ t.title }}</p>
          <p v-if="t.description" class="mt-0.5 text-dim">{{ t.description }}</p>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style>
.px-toast-enter-active,
.px-toast-leave-active { transition: transform 0.18s steps(4), opacity 0.18s steps(4); }
.px-toast-enter-from { transform: translateX(110%); }
.px-toast-leave-to { transform: translateX(110%); opacity: 0; }
.px-toast-move { transition: transform 0.15s steps(3); }
</style>
