<script setup lang="ts">
/**
 * 原料选择器：触发按钮 + 「选择原料」对话框（游戏里的道具栏）。
 * 搜索 169 个词表条目（id / 中文 / 英文 / 别名），按品类分组；
 * 键盘 ↑/↓ 移动光标、回车确认，鼠标悬停同步光标。
 */
import { computed, nextTick, ref, watch } from "vue";
import { CATEGORY_ZH } from "@/lib/labels";
import { CATEGORY_ICON } from "@/lib/game";

const props = defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const vocab = useVocabStore();
const { play } = useSfx();
const open = ref(false);
const q = ref("");
const search = ref<{ focus: () => void } | null>(null);
const listEl = ref<HTMLElement | null>(null);

const selected = computed(() =>
  props.modelValue ? vocab.ingMap.get(props.modelValue) : undefined,
);

function colorOf(viz: unknown): string {
  return (viz as { color?: string } | undefined)?.color ?? "var(--faint)";
}

const groups = computed(() => {
  const items = vocab.ingredients;
  const kw = q.value.trim().toLowerCase();
  const filtered = kw
    ? items.filter(
        (i) =>
          i.id.includes(kw) ||
          i.nameZh.includes(kw) ||
          (i.nameEn ?? "").toLowerCase().includes(kw) ||
          (i.aliases ?? []).some((a) => a.toLowerCase().includes(kw)),
      )
    : items;
  const byCat = new Map<string, typeof filtered>();
  for (const i of filtered) {
    const list = byCat.get(i.category) ?? [];
    list.push(i);
    byCat.set(i.category, list);
  }
  return [...byCat.entries()]
    .filter(([c]) => c !== "ice")
    .map(([c, list]) => ({
      key: c,
      label: CATEGORY_ZH[c] ?? c,
      icon: CATEGORY_ICON[c] ?? "question",
      items: list.slice(0, 40),
    }));
});

/** 扁平序列：键盘光标按它走，分组标题不占位。 */
const flat = computed(() => groups.value.flatMap((g) => g.items.map((i) => i.id)));
const cursor = ref(-1);

watch(q, () => {
  cursor.value = flat.value.length ? 0 : -1;
});

// 打开时清空搜索、光标落在当前已选项上并滚到可见处；
// 输入框聚焦放在宏任务里，排在 reka FocusScope 的自动聚焦（会落到 ✕ 关闭键）之后
watch(open, async (o) => {
  if (!o) return;
  q.value = "";
  await nextTick();
  const at = props.modelValue ? flat.value.indexOf(props.modelValue) : -1;
  cursor.value = at >= 0 ? at : flat.value.length ? 0 : -1;
  setTimeout(() => {
    search.value?.focus();
    scrollToCursor();
  }, 30);
});

function scrollToCursor(): void {
  const id = flat.value[cursor.value];
  if (!id || !listEl.value) return;
  listEl.value
    .querySelector<HTMLElement>(`[data-ing="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function move(dir: number): void {
  const n = flat.value.length;
  if (!n) return;
  cursor.value = (cursor.value + dir + n) % n;
  play("step");
  void nextTick(scrollToCursor);
}

function pick(id: string): void {
  emit("update:modelValue", id);
  play("confirm");
  open.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    move(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    move(-1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const id = flat.value[cursor.value];
    if (id) pick(id);
  }
}
</script>

<template>
  <button
    type="button"
    class="trigger"
    :class="{ empty: !selected }"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="open = true"
  >
    <span v-if="selected" class="min-w-0 flex-1 truncate text-left">
      <span class="text-fg">{{ selected.nameZh }}</span>
      <span class="ml-2 text-faint">{{ selected.nameEn }}</span>
    </span>
    <span v-else class="min-w-0 flex-1 truncate text-left">
      <span class="animate-blink text-amber">▶</span> 选择原料…
    </span>
    <PxIcon name="search" :scale="1" class="shrink-0 text-dim" />
  </button>

  <PxDialog v-model:open="open" title="选择原料" icon="bottle" size="lg">
    <div class="flex flex-col gap-3">
      <PxInput
        ref="search"
        v-model="q"
        icon="search"
        placeholder="搜原料名 / 别名 / ID…"
        autocomplete="off"
        @keydown="onKey"
      />
      <p class="flex flex-wrap items-center gap-x-3 text-faint">
        <span><PxKbd>↑</PxKbd><PxKbd>↓</PxKbd> 移动</span>
        <span><PxKbd>ENTER</PxKbd> 确认</span>
        <span class="ml-auto font-logo text-[8px]">{{ flat.length }} ITEMS</span>
      </p>

      <div ref="listEl" class="list px-sink" role="listbox" aria-label="原料">
        <template v-if="groups.length">
          <section v-for="g in groups" :key="g.key" class="mb-2">
            <h3 class="cat">
              <PxIcon :name="g.icon" :scale="1" />
              <span>{{ g.label }}</span>
              <span class="ml-auto font-logo text-[8px] text-faint">{{ g.items.length }}</span>
            </h3>
            <button
              v-for="i in g.items"
              :key="i.id"
              type="button"
              role="option"
              class="opt"
              :data-ing="i.id"
              :aria-selected="modelValue === i.id"
              :class="{ cur: flat[cursor] === i.id, on: modelValue === i.id }"
              @mousemove="cursor = flat.indexOf(i.id)"
              @click="pick(i.id)"
            >
              <span class="arrow" aria-hidden="true">▶</span>
              <span class="dot" :style="{ background: colorOf(i.viz) }" />
              <span class="min-w-0 flex-1 truncate">
                <span>{{ i.nameZh }}</span>
                <span class="ml-2 text-faint">{{ i.nameEn }}</span>
              </span>
              <PxIcon v-if="modelValue === i.id" name="check" :scale="1" class="text-amber" />
              <span v-else class="hidden truncate text-faint sm:inline">{{ i.id }}</span>
            </button>
          </section>
        </template>
        <PxEmpty v-else icon="search" title="没找到原料，换个关键词试试。" />
      </div>
    </div>
  </PxDialog>
</template>

<style scoped>
.trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - var(--p) * 2);
  height: 32px;
  margin: var(--p);
  padding: 0 10px;
  background: var(--panel-hi);
  color: var(--fg);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo);
}
.trigger:hover { background: color-mix(in srgb, var(--panel-hi) 85%, var(--fg) 15%); }
.trigger.empty { color: var(--dim); }
.list {
  max-height: min(56vh, 480px);
  overflow-y: auto;
  padding: 6px;
  margin: var(--p);
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.cat {
  position: sticky;
  top: -6px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: var(--panel-lo);
  color: var(--amber);
  border-bottom: var(--p) solid var(--ink);
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px 0 4px;
  text-align: left;
  color: var(--fg);
}
.opt .arrow { visibility: hidden; color: var(--amber); font-size: 10px; }
.opt.cur { background: var(--panel-hi); color: var(--amber); }
.opt.cur .arrow { visibility: visible; animation: px-blink 0.8s steps(1) infinite; }
.opt.on { color: var(--amber); box-shadow: inset calc(var(--p) * 2) 0 0 0 var(--amber); }
.dot {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  box-shadow: 0 0 0 var(--p) var(--ink);
}
</style>
