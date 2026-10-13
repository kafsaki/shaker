<script setup lang="ts">
/** 图鉴条目：权威配方 + 社区变体 + 规格分布图（IR 白拿的产品亮点，ADR-013）。
 *  hero 是金色「档案卡」：标题、IBA 徽章、摘要读数、迷你共识分布与创作入口，
 *  与 /r/{code} 的 UGC 页一眼可辨。经典配方的唯一地址是 /classics/{key}，只有这一种呈现。 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import type { RecipeIR } from "@shaker/recipe-ir/core";
import { FAMILY_ZH, IBA_ZH, METHOD_ZH } from "@/lib/labels";

type Recipe = components["schemas"]["RecipeBody"];
type Dist = components["schemas"]["DistributionOutputBody"];
type VariantPage = components["schemas"]["RecipeListOutputBody"];

const route = useRoute();
const api = useApi();
const vocab = useVocabStore();
const auth = useAuthStore();
const key = computed(() => String(route.params.classicKey ?? ""));
const tab = ref("variants");

// 权威条目不带 viz，RecipeDetail 回退到全量词表编译动画
onMounted(() => void vocab.ensure().catch(() => {}));

const { data: canonical, isLoading, error } = useQuery({
  queryKey: computed(() => ["classic", key.value] as const),
  queryFn: async (): Promise<Recipe> => {
    const { data, error } = await api.GET("/api/v1/classics/{classicKey}", {
      params: { path: { classicKey: key.value } },
    });
    if (error) throw error;
    return data;
  },
});

const { data: variants, isLoading: variantsLoading } = useQuery({
  queryKey: computed(() => ["classic-variants", key.value] as const),
  queryFn: async (): Promise<VariantPage> => {
    const { data, error } = await api.GET(
      "/api/v1/classics/{classicKey}/variants",
      { params: { path: { classicKey: key.value }, query: { sort: "hot" } } },
    );
    if (error) throw error;
    return data;
  },
  enabled: computed(() => tab.value === "variants"),
});

// hero 摘要需要分布数据（变体数 / ABV 中位 / 迷你区间条），进页即加载
const { data: dist } = useQuery({
  queryKey: computed(() => ["classic-dist", key.value] as const),
  queryFn: async (): Promise<Dist> => {
    const { data, error } = await api.GET(
      "/api/v1/classics/{classicKey}/distribution",
      { params: { path: { classicKey: key.value } } },
    );
    if (error) throw error;
    return data;
  },
});

useHead(() => ({ title: `${canonical.value?.title ?? key.value} · Shaker` }));

const ir = computed(() => canonical.value?.ir as RecipeIR | undefined);
const variantCount = computed(() => dist.value?.variantCount ?? 0);

/** hero 摘要的 ABV：优先社区中位，无变体时退回权威条目自己的估计。 */
const abv = computed(() => dist.value?.abvEst?.median ?? canonical.value?.abvEst ?? null);

/** 区间条的满刻度：所有原料 p90 的最大值（分布页底下的标尺也用它）。 */
const maxP90 = computed(() =>
  Math.max(1, ...(dist.value?.ingredients ?? []).map((i) => i.amountMl.p90 ?? 0)),
);

/** 分布图行：名字 + p10~p90 区间条 + median 刻度。 */
const distRows = computed(() => {
  const ings = dist.value?.ingredients ?? [];
  const max = maxP90.value;
  return ings
    .slice()
    .sort((a, b) => (b.amountMl.median ?? 0) - (a.amountMl.median ?? 0))
    .map((i) => {
      const m = vocab.ingMap.get(i.ingredientId);
      return {
        id: i.ingredientId,
        name: m ? `${m.nameZh}` : i.ingredientId,
        color: (m?.viz as { color?: string } | undefined)?.color,
        role: i.role,
        presentIn: i.presentIn,
        variantCount: dist.value?.variantCount ?? 1,
        p10: i.amountMl.p10,
        p25: i.amountMl.p25,
        median: i.amountMl.median,
        p75: i.amountMl.p75,
        p90: i.amountMl.p90,
        left: ((i.amountMl.p10 ?? 0) / max) * 100,
        width: (((i.amountMl.p90 ?? 0) - (i.amountMl.p10 ?? 0)) / max) * 100,
        medianLeft: ((i.amountMl.median ?? 0) / max) * 100,
      };
    });
});

/** 用量读数；盐边、装饰之类不计 ml 的原料没有中位数。 */
function ml(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}ml`;
}

/** hero 迷你共识：用量中位前 3 的原料。 */
const heroDistRows = computed(() => distRows.value.slice(0, 3));

const tabs = computed(() => [
  { value: "variants", label: "社区变体", icon: "branch" as const, count: variantCount.value },
  { value: "distribution", label: "规格分布", icon: "list" as const },
]);

const createTo = computed(() =>
  canonical.value ? `/editor/new?classicKey=${key.value}&derivedFrom=${canonical.value.id}` : "",
);

/** hero「查看完整分布」：切 Tab 并平滑滚到分布区。 */
async function goDistribution(): Promise<void> {
  tab.value = "distribution";
  await nextTick();
  document
    .getElementById("classic-tabs")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <div>
    <div v-if="isLoading" class="flex flex-col gap-6">
      <PxSkeleton class="h-56 w-full" />
      <div class="grid items-start gap-6 lg:grid-cols-[430px_minmax(0,1fr)]">
        <PxSkeleton class="aspect-[400/520] w-full" />
        <div class="flex flex-col gap-4">
          <PxSkeleton class="h-6 w-1/2" />
          <PxSkeleton class="h-40 w-full" />
        </div>
      </div>
    </div>

    <PxEmpty v-else-if="error" icon="warn" tone="red" :title="apiErrorMessage(error)">
      <PxButton icon="book" to="/classics">回经典图鉴</PxButton>
    </PxEmpty>

    <div v-else-if="canonical" class="flex flex-col gap-8">
      <!-- 档案卡 hero -->
      <PxPanel variant="glow" tone="amber" :padded="false" class="hero">
        <div class="hero-in px-stripes">
          <div class="flex min-w-0 flex-col gap-3">
            <p class="font-logo text-[8px] tracking-[0.3em] text-gold">★ CLASSIC ARCHIVE ★</p>
            <div>
              <h1 class="text-3xl text-fg text-shadow-px">{{ canonical.title }}</h1>
              <p v-if="canonical.subtitle" class="text-dim">{{ canonical.subtitle }}</p>
            </div>

            <!-- IBA 分档（金）· 家族 · 做法 -->
            <div class="flex flex-wrap items-center gap-1">
              <PxBadge
                v-if="canonical.ibaCategory && IBA_ZH[canonical.ibaCategory]"
                tone="gold"
                variant="solid"
                icon="crown"
              >
                {{ IBA_ZH[canonical.ibaCategory] }}
              </PxBadge>
              <PxBadge v-if="canonical.family && FAMILY_ZH[canonical.family]">{{ FAMILY_ZH[canonical.family] }}</PxBadge>
              <PxBadge v-if="ir && METHOD_ZH[ir.method]">{{ METHOD_ZH[ir.method] }}</PxBadge>
              <span class="ml-1 font-logo text-[8px] tracking-[0.15em] text-faint" title="配方 ID">No.{{ canonical.code }}</span>
            </div>

            <!-- 摘要读数 -->
            <div class="grid grid-cols-3 gap-2">
              <div class="read">
                <span class="text-faint">社区变体</span>
                <span class="val">{{ variantCount }}</span>
              </div>
              <div class="read">
                <span class="text-faint">ABV 中位</span>
                <span class="val">{{ abv !== null ? `${abv.toFixed(1)}%` : "—" }}</span>
              </div>
              <div class="read">
                <span class="text-faint">难度</span>
                <PxStars v-if="canonical.difficulty" :model-value="canonical.difficulty" :max="5" readonly />
                <span v-else class="val">—</span>
              </div>
            </div>

            <!-- 从经典进入创作：编辑器据此自动关联 classicKey + derivedFrom，
                 发布后就会出现在下面的「社区变体」里 -->
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <PxButton variant="primary" size="lg" icon="shaker" :to="createTo" sfx="start">
                创作我的版本
              </PxButton>
              <!-- 百科条目（ADR-027）：编辑可直接修订，所有人都能翻修订历史 -->
              <PxButton v-if="auth.isEditor" icon="pencil" :to="'/editor/' + canonical.id">编辑词条</PxButton>
              <PxButton variant="ghost" icon="clock" :to="'/wiki/history/recipe/' + canonical.id">修订历史</PxButton>
            </div>
          </div>

          <!-- 迷你共识分布：主原料用量中位前 3 的 p10~p90 区间 -->
          <div class="consensus">
            <p class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-2 text-fg"><PxIcon name="users" :scale="1" class="text-gold" />社区共识</span>
              <span class="font-logo text-[8px] text-faint">TOP 3</span>
            </p>
            <template v-if="heroDistRows.length">
              <div v-for="r in heroDistRows" :key="r.id" class="flex flex-col gap-1">
                <p class="flex items-baseline justify-between gap-3">
                  <span class="truncate text-dim">{{ r.name }}</span>
                  <span class="shrink-0 font-logo text-[8px] text-amber">{{ ml(r.median) }}</span>
                </p>
                <CodexRangeBar :left="r.left" :width="r.width" :median="r.medianLeft" :empty="r.median === null" />
              </div>
              <PxButton size="sm" variant="ghost" class="self-start" @click="goDistribution">
                查看完整分布 ↓
              </PxButton>
            </template>
            <p v-else class="py-3 text-faint">还没有社区变体，共识数据等你来写第一笔。</p>
          </div>
        </div>
      </PxPanel>

      <!-- 权威配方本体（动画 + 原料 + 步骤）；hero 已承载标题与徽章 -->
      <RecipeDetail :recipe="canonical" hide-header />

      <!-- 变体 / 分布 -->
      <section id="classic-tabs" class="flex scroll-mt-20 flex-col gap-4">
        <PxSegmented v-model="tab" variant="tabs" :items="tabs" />

        <template v-if="tab === 'variants'">
          <div v-if="variantsLoading" class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            <PxSkeleton v-for="i in 4" :key="i" class="aspect-[3/4]" />
          </div>
          <div v-else-if="(variants?.items ?? []).length" class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            <RecipeCard v-for="r in variants?.items ?? []" :key="r.id" :recipe="r" />
          </div>
          <PxEmpty v-else icon="branch" title="还没有社区变体 —— 照着经典调一杯，写下你的版本，它就是这里的第一张卡。">
            <PxButton variant="primary" icon="shaker" :to="createTo" sfx="start">创作我的版本</PxButton>
          </PxEmpty>
        </template>

        <PxPanel v-else title="社区共识落点" icon="list" tone="amber">
          <p class="mb-5 text-dim">
            {{ variantCount }} 个变体的用量分布（色块为 p10~p90 区间，竖刻度为中位数）—— 看看你的配方偏甜还是偏酸。
          </p>

          <div v-if="distRows.length" class="flex flex-col gap-5">
            <div v-for="r in distRows" :key="r.id" class="flex flex-col gap-2">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <NuxtLink :to="`/ingredients/${r.id}`" class="flex min-w-0 items-center gap-2 text-fg hover:text-amber">
                  <span class="swatch" :style="r.color ? { background: r.color } : undefined" />
                  <span class="truncate">{{ r.name }}</span>
                </NuxtLink>
                <span class="flex shrink-0 items-baseline gap-3">
                  <span class="text-faint">
                    <span class="font-logo text-[8px] text-dim">{{ r.presentIn }}/{{ r.variantCount }}</span> 变体在用
                  </span>
                  <span class="text-faint">中位 <span class="font-logo text-[8px] text-amber">{{ ml(r.median) }}</span></span>
                </span>
              </div>
              <CodexRangeBar :left="r.left" :width="r.width" :median="r.medianLeft" :empty="r.median === null" size="lg" />
            </div>
            <p class="flex justify-between font-logo text-[8px] text-faint" aria-hidden="true">
              <span>0</span><span>{{ (maxP90 / 2).toFixed(0) }}</span><span>{{ maxP90.toFixed(0) }}ml</span>
            </p>
          </div>
          <PxEmpty v-else icon="list" title="暂无分布数据" />

          <div v-if="dist?.abvEst?.median" class="abv">
            <PxIcon name="fire" :scale="2" class="text-pink" />
            <span class="text-dim">ABV 估计</span>
            <span class="text-faint">中位 <span class="font-logo text-[8px] text-amber">{{ dist.abvEst.median.toFixed(1) }}%</span></span>
            <span v-if="dist.abvEst.p10 !== null && dist.abvEst.p90 !== null" class="font-logo text-[8px] text-faint">
              {{ dist.abvEst.p10.toFixed(1) }}% ~ {{ dist.abvEst.p90.toFixed(1) }}%
            </span>
          </div>
        </PxPanel>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hero { --stripe: color-mix(in srgb, var(--gold) 6%, transparent); }
.hero-in {
  display: grid;
  gap: 20px;
  padding: 20px;
}
@media (min-width: 1024px) {
  .hero-in { grid-template-columns: minmax(0, 1fr) 340px; align-items: start; padding: 24px; }
}
.read {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.read .val { font-family: var(--font-logo); font-size: 16px; line-height: 24px; color: var(--amber); }
.consensus {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  margin: var(--p);
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.swatch {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  background: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.abv {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
  padding-top: 14px;
  border-top: var(--p) dashed var(--line);
}
</style>
