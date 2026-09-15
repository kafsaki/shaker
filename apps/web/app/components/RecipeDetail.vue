<script setup lang="ts">
/**
 * 配方详情主体（/r/[slug] 与 /recipes/[id] 共用）。
 * 左：动画播放器（sticky）；右：原料卡 + 文字步骤（点击单步回看）+ 元信息。
 */
import type { components } from "@shaker/api-client";
import type { RecipeIR } from "@shaker/recipe-ir/core";
import { displayAmount } from "@shaker/recipe-ir/core";
import type { Timeline } from "@shaker/animator-core";
import { vizToVocab } from "@/lib/animation";
import { FAMILY_ZH, IBA_ZH, METHOD_ZH, SOURCE_ZH } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type Recipe = components["schemas"]["RecipeBody"];
type VizIngredient = NonNullable<Recipe["viz"]>["ingredients"][string];

const props = defineProps<{ recipe: Recipe }>();

const auth = useAuthStore();
const player = ref<{
  seekToStep: (i: number) => void;
  timeline: Timeline | null;
} | null>(null);

const ir = computed(() => props.recipe.ir as RecipeIR);

// viz 载荷优先（一次请求带全视觉数据）；没有时回退到全量词表
//（/classics/:key 返回不带 viz，但引用的原料/杯型都在 /vocab 里）。
const vocabStore = useVocabStore();
const vocab = computed(() =>
  props.recipe.viz
    ? vizToVocab(props.recipe.viz)
    : vocabStore.toVocabLookup(),
);

const unitPref = ref<"ml" | "oz">(
  auth.user?.unitPreference === "oz" ? "oz" : "ml",
);

const steps = computed(() => player.value?.timeline?.steps ?? []);
const activeStep = ref(-1);

function onProgress(stepIndex: number): void {
  activeStep.value = stepIndex;
}

function seekStep(i: number): void {
  player.value?.seekToStep(i);
  activeStep.value = i;
}

interface Row {
  slot: string;
  id: string;
  nameZh: string;
  nameEn: string;
  amount: string;
  approximate: boolean;
}

const rows = computed<Row[]>(() => {
  const vizIngs =
    (props.recipe.viz?.ingredients as Record<string, VizIngredient> | undefined) ?? {};
  return ir.value.ingredients.map((r) => {
    const meta = vizIngs[r.ingredientId];
    const d = displayAmount(r, unitPref.value);
    return {
      slot: r.slot,
      id: r.ingredientId,
      nameZh: meta?.nameZh ?? r.ingredientId,
      nameEn: meta?.nameEn ?? "",
      amount: d.text,
      approximate: d.approximate,
    };
  });
});

const taste = computed(() => {
  const t = props.recipe.tasteProfile;
  if (!t || t.sweet + t.sour + t.bitter + t.strength === 0) return null;
  return [
    { label: "甜", value: t.sweet },
    { label: "酸", value: t.sour },
    { label: "苦", value: t.bitter },
    { label: "烈", value: t.strength },
  ];
});

const published = computed(() => {
  const d = props.recipe.publishedAt;
  return d ? new Date(d).toLocaleDateString("zh-CN") : null;
});
</script>

<template>
  <div class="grid items-start gap-8 lg:grid-cols-[400px_minmax(0,1fr)]">
    <div class="lg:sticky lg:top-20">
      <div
        v-if="!recipe.viz && !vocabStore.loaded"
        class="flex aspect-[400/520] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
      >
        词表加载中…
      </div>
      <VizPlayer v-else ref="player" :ir="ir" :vocab="vocab" @progress="onProgress" />
    </div>

    <div class="flex min-w-0 flex-col gap-6">
      <!-- 标题与作者 -->
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold">{{ recipe.title }}</h1>
        <p v-if="recipe.subtitle" class="text-sm text-muted-foreground">
          {{ recipe.subtitle }}
        </p>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <NuxtLink
            :to="`/u/${recipe.author.handle}`"
            class="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {{ recipe.author.displayName }}
          </NuxtLink>
          <span v-if="recipe.author.isOfficial" class="text-primary">官方</span>
          <span v-if="published">· {{ published }}</span>
        </div>
      </div>

      <!-- 徽章行 -->
      <div class="flex flex-wrap items-center gap-1.5">
        <Badge v-if="recipe.family && FAMILY_ZH[recipe.family]" variant="secondary">
          {{ FAMILY_ZH[recipe.family] }}
        </Badge>
        <Badge v-if="METHOD_ZH[ir.method]" variant="secondary">
          {{ METHOD_ZH[ir.method] }}
        </Badge>
        <Badge
          v-if="recipe.ibaCategory && IBA_ZH[recipe.ibaCategory]"
          class="border-primary/40 bg-primary/10 text-primary"
        >
          {{ IBA_ZH[recipe.ibaCategory] }}
        </Badge>
        <Badge v-if="recipe.isCanonical" variant="outline">权威条目</Badge>
        <Badge v-else-if="recipe.source && SOURCE_ZH[recipe.source]" variant="outline">
          {{ SOURCE_ZH[recipe.source] }}
        </Badge>
        <Separator orientation="vertical" class="!h-4" />
        <span v-if="recipe.abvEst !== null" class="text-sm text-muted-foreground">
          {{ recipe.abvEst.toFixed(1) }}% ABV
        </span>
        <span v-if="recipe.totalVolumeMl !== null" class="text-sm text-muted-foreground">
          {{ Math.round(recipe.totalVolumeMl) }} ml
        </span>
        <span class="text-sm text-muted-foreground">{{ recipe.servings }} 人份</span>
        <span v-if="recipe.difficulty" class="text-sm text-muted-foreground">
          难度 {{ "★".repeat(recipe.difficulty) }}
        </span>
      </div>

      <!-- 口味 -->
      <div v-if="taste" class="flex flex-wrap gap-4">
        <div
          v-for="t in taste"
          :key="t.label"
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span class="w-5">{{ t.label }}</span>
          <span class="flex h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
            <span class="bg-primary" :style="{ width: `${(t.value / 5) * 100}%` }" />
          </span>
        </div>
      </div>

      <!-- 描述 -->
      <p
        v-if="recipe.descriptionMd"
        class="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
      >
        {{ recipe.descriptionMd }}
      </p>

      <!-- 原料卡 -->
      <Card>
        <CardHeader class="flex-row items-center justify-between">
          <CardTitle class="text-base">原料</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            @click="unitPref = unitPref === 'ml' ? 'oz' : 'ml'"
          >
            {{ unitPref === "ml" ? "切到 oz" : "切到 ml" }}
          </Button>
        </CardHeader>
        <CardContent>
          <ul class="divide-y divide-border">
            <li
              v-for="r in rows"
              :key="r.slot"
              class="flex items-baseline justify-between gap-4 py-2"
            >
              <div class="min-w-0">
                <div class="truncate text-sm font-medium">{{ r.nameZh }}</div>
                <div v-if="r.nameEn" class="truncate text-xs text-muted-foreground">
                  {{ r.nameEn }}
                </div>
              </div>
              <div class="shrink-0 text-sm tabular-nums text-muted-foreground">
                {{ r.approximate ? "≈ " : "" }}{{ r.amount }}
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- 文字步骤（与动画单步联动） -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">步骤</CardTitle>
        </CardHeader>
        <CardContent>
          <ol v-if="steps.length" class="flex flex-col gap-1">
            <li v-for="(s, i) in steps" :key="s.stepId">
              <button
                class="w-full rounded-lg border px-3 py-2 text-left transition-colors"
                :class="
                  i === activeStep
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-transparent hover:bg-accent'
                "
                @click="seekStep(i)"
              >
                <div class="flex items-baseline justify-between gap-3">
                  <span class="text-sm">
                    <span class="mr-2 font-mono text-xs text-muted-foreground">
                      {{ i + 1 }}
                    </span>
                    {{ s.label.zh }}
                  </span>
                  <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {{ (s.durationMs / 1000).toFixed(1) }}s
                  </span>
                </div>
                <div class="pl-6 text-xs text-muted-foreground">{{ s.label.en }}</div>
              </button>
            </li>
          </ol>
          <div v-else class="flex flex-col gap-2">
            <Skeleton class="h-9 w-full" />
            <Skeleton class="h-9 w-full" />
            <Skeleton class="h-9 w-2/3" />
          </div>
          <p class="mt-3 text-xs text-muted-foreground">点击任一步骤可回看该步动画。</p>
        </CardContent>
      </Card>

      <!-- 互动条 -->
      <RecipeActions :recipe="recipe" />

      <!-- 评论 -->
      <CommentsSection :recipe-id="recipe.id" />
    </div>
  </div>
</template>
