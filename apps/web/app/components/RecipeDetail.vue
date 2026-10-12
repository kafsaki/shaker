<script setup lang="ts">
/**
 * 配方详情主体（/r/[code] 与经典页共用）。
 * 左：吧台小电视（sticky）；右：名牌 + 属性面板 + 酒保手记 + 材料清单 + 调制流程（任务日志，
 * 与动画联动：已完成打勾、当前步闪 ▶，点击任一步回看）+ 互动 + 留言板。
 * hideHeader：经典页 hero 已承载标题/徽章，传 true 隐藏名牌里的标题与徽章行。
 */
import type { components } from "@shaker/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { RecipeIR } from "@shaker/recipe-ir/core";
import { displayAmount } from "@shaker/recipe-ir/core";
import type { Timeline } from "@shaker/animator-core";
import { vizToVocab } from "@/lib/animation";
import { FAMILY_ZH, IBA_ZH, METHOD_ZH } from "@/lib/labels";
import { rarityOf } from "@/lib/game";
import { toast } from "@/lib/toast";

type Recipe = components["schemas"]["RecipeBody"];
type VizIngredient = NonNullable<Recipe["viz"]>["ingredients"][string];

const props = withDefaults(defineProps<{ recipe: Recipe; hideHeader?: boolean }>(), {
  hideHeader: false,
});

const auth = useAuthStore();
const api = useApi();
const { play } = useSfx();
const player = ref<{
  seekToStep: (i: number) => void;
  captureCover: () => Promise<{ dark: Blob; light: Blob } | null>;
  timeline: Timeline | null;
} | null>(null);

// 封面截帧钩子：?__cover=1 时暴露给 Playwright 脚本（scripts/classic-covers），
// 与编辑器发布走同一条 captureCover 路径（ADR-015 同源逻辑）。正常访问零影响。
// 返回暗/亮两套 dataUrl（封面双版本），脚本各存一份。
if (useRoute().query.__cover === "1") {
  onMounted(() => {
    type Shot = { dataUrl: string; width: number; height: number };
    (window as unknown as {
      __shakerCover?: () => Promise<{ dark: Shot; light: Shot } | null>;
    }).__shakerCover = async () => {
      const toShot = async (blob: Blob): Promise<Shot> => {
        // 页面里还有背景画布，必须按 data-viz 精确取播放器那块
        const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-viz]");
        const dataUrl = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.readAsDataURL(blob);
        });
        return { dataUrl, width: canvas?.width ?? 0, height: canvas?.height ?? 0 };
      };
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const p = player.value;
        if (p?.timeline) {
          const covers = await p.captureCover();
          if (covers) {
            return { dark: await toShot(covers.dark), light: await toShot(covers.light) };
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    };
  });
}

const ir = computed(() => props.recipe.ir as RecipeIR);
const rarity = computed(() => rarityOf(props.recipe));

/* ── 经典关联（classicKey → 经典名，classics 第一页 50 条覆盖 v1 全量）── */
const { data: classics } = useQuery({
  queryKey: ["classics-options"] as const, // 与编辑器共享缓存
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/classics", { params: { query: { limit: 50 } } });
    if (error) throw error;
    return data;
  },
  enabled: computed(() => props.recipe.classicKey != null),
  staleTime: 5 * 60_000,
});
const classicTitle = computed(() => {
  const k = props.recipe.classicKey;
  if (!k) return "";
  return classics.value?.items?.find((c) => c.classicKey === k)?.title ?? k;
});

/* ── derivedFrom：改编自哪杯（目标可能已删/未发布，失败则静默）── */
const { data: derivedRecipe } = useQuery({
  queryKey: computed(() => ["recipe", "brief", props.recipe.derivedFrom] as const),
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/recipes/{id}", {
      params: { path: { id: props.recipe.derivedFrom! } },
    });
    if (error) throw error;
    return data;
  },
  enabled: computed(() => props.recipe.derivedFrom != null && !props.recipe.isCanonical),
  retry: false,
});
// 从经典页「创作我的版本」进来时 derivedFrom 指向同一经典的权威条目，
// 变体徽章已表达这层关系，改编行不重复展示
const derivedLink = computed(() => {
  const d = derivedRecipe.value;
  if (!d) return null;
  if (props.recipe.classicKey && d.isCanonical && d.classicKey === props.recipe.classicKey) return null;
  return d;
});

// viz 载荷优先（一次请求带全视觉数据）；没有时回退到全量词表
//（/classics/:key 返回不带 viz，但引用的原料/杯型都在 /vocab 里）。
const vocabStore = useVocabStore();
const vocab = computed(() => (props.recipe.viz ? vizToVocab(props.recipe.viz) : vocabStore.toVocabLookup()));
onMounted(() => {
  void vocabStore.ensure().catch(() => {});
});

const unitPref = ref<string>(auth.user?.unitPreference === "oz" ? "oz" : "ml");

/** 配方标签（recipe_tags）展示名；词表未加载时回落原始 id。 */
const recipeTags = computed(() =>
  (props.recipe.tags ?? []).map((id) => ({
    id,
    label: vocabStore.tags.find((t) => t.id === id)?.nameZh ?? id,
  })),
);

const steps = computed(() => player.value?.timeline?.steps ?? []);
const activeStep = ref(-1);

function onProgress(stepIndex: number): void {
  activeStep.value = stepIndex;
}
function seekStep(i: number): void {
  player.value?.seekToStep(i);
  activeStep.value = i;
  play("click");
}

interface Row {
  slot: string;
  id: string;
  nameZh: string;
  nameEn: string;
  amount: string;
  approximate: boolean;
  color: string;
  optional: boolean;
}

const rows = computed<Row[]>(() => {
  const vizIngs = (props.recipe.viz?.ingredients as Record<string, VizIngredient> | undefined) ?? {};
  return ir.value.ingredients.map((r) => {
    // 经典条目接口不带 viz，回退全量词表取中英名（否则只剩 ingredientId 裸值）
    const meta = vizIngs[r.ingredientId] ?? vocabStore.ingMap.get(r.ingredientId);
    const d = displayAmount(r, unitPref.value as "ml" | "oz");
    const color = (meta?.viz as { color?: string } | undefined)?.color ?? "var(--dim)";
    return {
      slot: r.slot,
      id: r.ingredientId,
      nameZh: meta?.nameZh ?? r.ingredientId,
      nameEn: meta?.nameEn ?? "",
      amount: d.text,
      approximate: d.approximate,
      color,
      optional: r.optional ?? false,
    };
  });
});

const TASTE = [
  { key: "sweet", label: "甜", tone: "pink" },
  { key: "sour", label: "酸", tone: "green" },
  { key: "bitter", label: "苦", tone: "cyan" },
  { key: "strength", label: "烈", tone: "red" },
] as const;
const taste = computed(() => {
  const t = props.recipe.tasteProfile;
  if (!t || t.sweet + t.sour + t.bitter + t.strength === 0) return null;
  return TASTE.map((x) => ({ ...x, value: t[x.key] }));
});

const published = computed(() => {
  const d = props.recipe.publishedAt;
  return d ? new Date(d).toLocaleDateString("zh-CN") : null;
});

/* ── 删除（仅作者本人，软删）── */
const isAuthor = computed(() => auth.user?.id === props.recipe.author.id);
const qc = useQueryClient();
const deleteOpen = ref(false);
const deleteMutation = useMutation({
  mutationFn: async () => {
    const { error } = await api.DELETE("/api/v1/recipes/{id}", { params: { path: { id: props.recipe.id } } });
    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("配方已删除");
    qc.invalidateQueries();
    navigateTo("/");
  },
  onError: (err) => toast.error(apiErrorMessage(err)),
});
</script>

<template>
  <div class="grid items-start gap-6 lg:grid-cols-[430px_minmax(0,1fr)]">
    <div class="lg:sticky lg:top-20">
      <div v-if="!recipe.viz && !vocabStore.loaded" class="aspect-[400/520]">
        <PxLoader text="TUNING" />
      </div>
      <VizPlayer v-else ref="player" :ir="ir" :vocab="vocab" @progress="onProgress" />
    </div>

    <div class="flex min-w-0 flex-col gap-5">
      <!-- 名牌 -->
      <PxPanel :padded="false">
        <div class="flex flex-col gap-3 p-4">
          <div v-if="!hideHeader" class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-2">
                <PxBadge :tone="rarity.tone === 'plain' ? 'plain' : rarity.tone" variant="solid" :icon="rarity.icon">
                  {{ rarity.label }}
                </PxBadge>
                <span class="font-logo text-[8px] tracking-[0.15em] text-faint" title="配方 ID">No.{{ recipe.code }}</span>
              </p>
              <h1 class="mt-2 text-2xl text-fg text-shadow-px">{{ recipe.title }}</h1>
              <p v-if="recipe.subtitle" class="text-dim">{{ recipe.subtitle }}</p>
            </div>
            <PxButton v-if="isAuthor" square size="sm" variant="ghost" icon="trash" title="删除配方" @click="deleteOpen = true" />
          </div>

          <NuxtLink v-if="!hideHeader" :to="`/u/${recipe.author.handle}`" class="flex w-fit items-center gap-2 text-dim hover:text-amber">
            <PxAvatar :src="recipe.author.avatarUrl" :seed="recipe.author.handle" :size="24" />
            <span class="text-fg">{{ recipe.author.displayName }}</span>
            <PxBadge v-if="recipe.author.isOfficial" tone="amber" icon="crown">官方</PxBadge>
            <span v-if="published" class="text-faint">· {{ published }}</span>
          </NuxtLink>

          <div v-if="!hideHeader" class="flex flex-wrap items-center gap-1">
            <PxBadge v-if="recipe.family && FAMILY_ZH[recipe.family]">{{ FAMILY_ZH[recipe.family] }}</PxBadge>
            <PxBadge v-if="METHOD_ZH[ir.method]">{{ METHOD_ZH[ir.method] }}</PxBadge>
            <PxBadge v-if="recipe.ibaCategory && IBA_ZH[recipe.ibaCategory]" tone="gold">{{ IBA_ZH[recipe.ibaCategory] }}</PxBadge>
            <NuxtLink v-if="recipe.classicKey" :to="`/classics/${recipe.classicKey}`" class="hover:brightness-125">
              <PxBadge v-if="recipe.isCanonical" tone="gold" icon="book">图鉴条目 ›</PxBadge>
              <PxBadge v-else tone="green" icon="branch">{{ classicTitle }} 的变体 ›</PxBadge>
            </NuxtLink>
            <span v-if="derivedLink" class="ml-1 text-faint">
              改编自
              <NuxtLink :to="`/r/${derivedLink.code}`" class="text-amber hover:underline">{{ derivedLink.title }}</NuxtLink>
            </span>
            <span v-if="recipe.derivedCount > 0" class="ml-1 text-faint">· {{ recipe.derivedCount }} 个改编</span>
          </div>
        </div>
        <div class="border-t-2 border-dashed border-line px-4 py-3">
          <RecipeActions :recipe="recipe" />
        </div>
      </PxPanel>

      <!-- 属性面板 -->
      <PxPanel title="属性" icon="trophy" tone="pink">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="stat">
            <span class="text-faint">酒精度</span>
            <span class="val">{{ recipe.abvEst !== null ? `${recipe.abvEst.toFixed(1)}%` : "—" }}</span>
          </div>
          <div class="stat">
            <span class="text-faint">容量</span>
            <span class="val">{{ recipe.totalVolumeMl !== null ? `${Math.round(recipe.totalVolumeMl)}ml` : "—" }}</span>
          </div>
          <div class="stat">
            <span class="text-faint">份数</span>
            <span class="val">×{{ recipe.servings }}</span>
          </div>
          <div class="stat">
            <span class="text-faint">难度</span>
            <PxStars v-if="recipe.difficulty" :model-value="recipe.difficulty" :max="5" readonly />
            <span v-else class="val">—</span>
          </div>
        </div>
        <div v-if="taste" class="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div v-for="t in taste" :key="t.key" class="flex items-center gap-3">
            <span class="w-4 text-dim">{{ t.label }}</span>
            <PxBar :value="t.value" :max="5" :tone="t.tone" :cell-width="18" />
            <span class="font-logo text-[8px] text-faint">{{ t.value }}/5</span>
          </div>
        </div>
        <div v-if="recipeTags.length" class="mt-4 flex flex-wrap items-center gap-1">
          <NuxtLink v-for="t in recipeTags" :key="t.id" :to="`/search?type=recipe&tag=${t.id}`" class="hover:brightness-125">
            <PxBadge tone="cyan">#{{ t.label }}</PxBadge>
          </NuxtLink>
        </div>
      </PxPanel>

      <!-- 酒保手记 -->
      <PxPanel v-if="recipe.descriptionMd" title="调酒师手记" icon="pencil" tone="plain" variant="inset">
        <p class="whitespace-pre-wrap leading-[2] text-fg">{{ recipe.descriptionMd }}</p>
      </PxPanel>

      <!-- 材料清单 -->
      <PxPanel title="材料" icon="bottle" tone="green" :padded="false">
        <template #actions>
          <PxSegmented v-model="unitPref" size="sm" :items="[{ value: 'ml', label: 'ML' }, { value: 'oz', label: 'OZ' }]" />
        </template>
        <ul class="flex flex-col p-2">
          <li v-for="r in rows" :key="r.slot">
            <NuxtLink :to="`/ingredients/${r.id}`" class="ing">
              <span class="vial" :style="{ '--px-icon-2': r.color }"><PxIcon name="bottle" :scale="2" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-fg">
                  {{ r.nameZh }}<span v-if="r.optional" class="ml-1 text-faint">（可选）</span>
                </span>
                <span v-if="r.nameEn" class="block truncate text-faint">{{ r.nameEn }}</span>
              </span>
              <span class="amt">{{ r.approximate ? "≈" : "" }}{{ r.amount }}</span>
            </NuxtLink>
          </li>
        </ul>
      </PxPanel>

      <!-- 调制流程（任务日志） -->
      <PxPanel title="调制流程" icon="list" tone="amber" :padded="false">
        <template #actions>
          <span class="text-faint">点击任一步回看</span>
        </template>
        <ol v-if="steps.length" class="flex flex-col gap-1 p-2">
          <li v-for="(s, i) in steps" :key="s.stepId">
            <button
              type="button"
              class="quest"
              :class="{ now: i === activeStep, done: i < activeStep }"
              @click="seekStep(i)"
            >
              <span class="num">
                <PxIcon v-if="i < activeStep" name="check" :scale="1" />
                <span v-else-if="i === activeStep" class="animate-blink">▶</span>
                <span v-else class="font-logo text-[8px]">{{ i + 1 }}</span>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-fg">{{ s.stepId === "__final" ? "★ 成品出杯" : s.label.zh }}</span>
                <span class="block truncate text-faint">{{ s.label.en }}</span>
              </span>
              <span class="font-logo text-[8px] text-faint">{{ (s.durationMs / 1000).toFixed(1) }}s</span>
            </button>
          </li>
        </ol>
        <div v-else class="flex flex-col gap-2 p-3">
          <PxSkeleton v-for="i in 3" :key="i" class="h-10" />
        </div>
      </PxPanel>

      <CommentsSection :recipe-id="recipe.id" />
    </div>

    <PxDialog v-model:open="deleteOpen" :title="`删除「${recipe.title}」？`" icon="trash" tone="red" size="sm">
      <p class="text-dim">删除后链接将失效且不可恢复，酒单与点赞中的条目会标记为已删除。</p>
      <template #footer>
        <PxButton :disabled="deleteMutation.isPending.value" @click="deleteOpen = false">取消</PxButton>
        <PxButton variant="danger" icon="trash" :loading="deleteMutation.isPending.value" @click="deleteMutation.mutate()">
          确认删除
        </PxButton>
      </template>
    </PxDialog>
  </div>
</template>

<style scoped>
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.stat .val { font-family: var(--font-logo); font-size: 12px; color: var(--amber); line-height: 18px; }
.ing {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
}
.ing:hover { background: var(--panel-hi); }
.ing:hover .amt { color: var(--amber-hi); }
.vial {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  background: var(--deep);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
  color: var(--dim);
  --px-icon-2-alpha: 1;
}
.amt { font-family: var(--font-logo); font-size: 8px; color: var(--amber); white-space: nowrap; }
.quest {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
}
.quest:hover { background: var(--panel-hi); }
.quest .num {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  background: var(--panel-lo);
  color: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.quest.done .num { background: var(--green); color: var(--on-accent); }
.quest.done { opacity: 0.7; }
.quest.now {
  background: color-mix(in srgb, var(--amber) 14%, transparent);
  box-shadow: inset calc(var(--p) * 2) 0 0 0 var(--amber);
}
.quest.now .num { background: var(--amber); color: var(--on-accent); }
</style>
