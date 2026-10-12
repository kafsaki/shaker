<script setup lang="ts">
/**
 * 原料库（物品栏）：14 品类按键墙（ADR-009）+ 搜索 + 分页浏览。
 * 每个原料是一格物品：品类图标按原料颜色上色，右下角标 ABV。品类选择同步到地址栏 ?category=。
 */
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import type { PixelIconName } from "@/lib/pixel-icons";
import { CATEGORY_ZH } from "@/lib/labels";
import { CATEGORY_ICON } from "@/lib/game";

type Page = components["schemas"]["IngredientListOutputBody"];

useHead({ title: "原料库 · Shaker" });

const api = useApi();
const route = useRoute();
const router = useRouter();
const { play } = useSfx();

const category = ref<string>((route.query.category as string) || "");
const q = ref("");
const debouncedQ = ref("");

let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});

watch([category, debouncedQ], () => {
  router.replace({
    query: category.value ? { category: category.value } : {},
  });
});

/** 品类按键：「全部」用列表图标，其余取品类图标。 */
const KEYS: { value: string; label: string; icon: PixelIconName }[] = [
  { value: "", label: "全部", icon: "list" },
  ...Object.entries(CATEGORY_ZH).map(([value, label]) => ({
    value,
    label,
    icon: CATEGORY_ICON[value] ?? "question",
  })),
];
function pick(c: string): void {
  if (category.value === c) return;
  play("step");
  category.value = c;
}

const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useInfiniteQuery({
    queryKey: computed(
      () => ["ingredients", category.value, debouncedQ.value] as const,
    ),
    queryFn: async ({ pageParam }): Promise<Page> => {
      const { data, error } = await api.GET("/api/v1/ingredients", {
        params: {
          query: {
            category: category.value || undefined,
            q: debouncedQ.value || undefined,
            cursor: pageParam || undefined,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

const items = computed(() => data.value?.pages.flatMap((p) => p.items ?? []) ?? []);
const count = computed(() => `${items.value.length}${hasNextPage.value ? "+" : ""}`);
const currentLabel = computed(() => (category.value ? CATEGORY_ZH[category.value] ?? category.value : "全部物品"));

function colorOf(viz: unknown): string | null {
  return (viz as { color?: string } | undefined)?.color ?? null;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex items-center gap-3">
        <span class="emblem" aria-hidden="true"><PxIcon name="bottle" :scale="3" /></span>
        <div>
          <p class="font-logo text-[8px] tracking-[0.3em] text-amber">INVENTORY</p>
          <h1 class="text-2xl text-fg text-shadow-px">原料库</h1>
        </div>
      </div>
      <PxInput v-model="q" icon="search" placeholder="搜原料名 / 别名…" class="w-full max-w-sm" />
    </header>

    <!-- 品类按键墙 -->
    <nav class="keys" aria-label="原料品类">
      <button
        v-for="k in KEYS"
        :key="k.value || 'all'"
        type="button"
        class="key"
        :class="{ on: category === k.value }"
        :aria-pressed="category === k.value"
        @click="pick(k.value)"
      >
        <PxIcon :name="k.icon" :scale="2" />
        <span>{{ k.label }}</span>
      </button>
    </nav>

    <section class="bag">
      <header class="bag-bar">
        <span class="flex items-center gap-2 text-fg">
          <span class="mark" aria-hidden="true" />{{ currentLabel }}
        </span>
        <span class="text-faint">
          <span class="font-logo text-[8px] text-amber">{{ isLoading ? "---" : count }}</span> 件
        </span>
      </header>

      <div class="p-3">
        <div v-if="isLoading" class="slots">
          <PxSkeleton v-for="i in 12" :key="i" class="aspect-[3/4]" />
        </div>

        <PxEmpty v-else-if="isError && items.length === 0" icon="warn" tone="red" :title="apiErrorMessage(error)" />

        <PxEmpty v-else-if="items.length === 0" icon="bottle" title="没有匹配的原料" />

        <template v-else>
          <div class="slots">
            <NuxtLink
              v-for="i in items"
              :key="i.id"
              :to="`/ingredients/${i.id}`"
              class="item"
              :title="CATEGORY_ZH[i.category] ?? i.category"
              @click="play('click')"
            >
              <IngredientSlot
                :category="i.category"
                :color="colorOf(i.viz)"
                :scale="5"
                :corner="i.abv ? `${i.abv}%` : null"
              />
              <span class="name"><span class="cur" aria-hidden="true">▶</span><span class="truncate">{{ i.nameZh }}</span></span>
              <span class="en">{{ i.nameEn }}</span>
            </NuxtLink>
          </div>

          <InfiniteLoader
            :has-next-page="hasNextPage"
            :is-fetching-next-page="isFetchingNextPage"
            :error="isError"
            @load="fetchNextPage()"
          />
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.emblem {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  color: var(--amber);
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}

/* ── 品类按键墙：未选中是平按键，选中凸起 + 琥珀高亮 ── */
.keys { display: flex; flex-wrap: wrap; gap: 6px; }
.key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  margin: var(--p);
  padding: 0 10px 0 8px;
  background: var(--panel-lo);
  color: var(--dim);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo);
}
.key:hover { color: var(--fg); background: var(--panel); }
.key:active { transform: translateY(var(--p)); }
.key.on {
  background: var(--amber);
  color: var(--on-accent);
  transform: translateY(calc(var(--p) * -2));
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.4),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 rgb(0 0 0 / 0.25),
    0 calc(var(--p) * 3) 0 var(--p) var(--amber-lo),
    0 calc(var(--p) * 4) 0 var(--p) var(--ink);
}
/* 手机上 15 个键折成五六行太占地方，改成一行横滑 */
@media (max-width: 639px) {
  .keys { flex-wrap: nowrap; overflow-x: auto; padding: 4px 2px 12px; scrollbar-width: none; }
  .keys::-webkit-scrollbar { display: none; }
  .key { flex-shrink: 0; }
}

/* ── 背包面板 ── */
.bag {
  margin: var(--p);
  background: var(--panel);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 var(--lo),
    calc(var(--p) * 3) calc(var(--p) * 3) 0 0 var(--shadow);
}
.bag-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 6px 12px;
  background: var(--panel-hi);
  border-bottom: var(--p) solid var(--ink);
}
.mark { width: 6px; height: 14px; background: var(--amber); box-shadow: var(--p) var(--p) 0 0 var(--ink); }

.slots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (min-width: 640px) { .slots { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 768px) { .slots { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (min-width: 1024px) { .slots { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  align-items: center;
  padding: 8px 6px;
  text-align: center;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--hi);
}
.item :deep(.slot) { margin-bottom: 6px; }
.item:hover,
.item:focus-visible {
  outline: none;
  background: var(--panel-hi);
  transform: translateY(calc(var(--p) * -2));
  box-shadow:
    0 0 0 var(--p) var(--gold),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 2) calc(var(--p) * 3) 0 calc(var(--p) * 2) var(--shadow);
}
.item:active { transform: none; }
.name {
  display: flex;
  align-items: center;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  color: var(--fg);
}
.name .cur { width: 0; overflow: hidden; flex-shrink: 0; color: var(--gold); font-size: 10px; }
.item:hover .name { color: var(--gold); }
.item:hover .name .cur { width: 14px; animation: px-blink 0.8s steps(1) infinite; }
.en { max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--faint); }
</style>
