<script setup lang="ts">
/**
 * 结构化编辑器（ADR-001 创作区）：左表单 / 右实时预览 + 诊断。
 * 草稿宽松（错误不阻止保存），发布严格（本地完整校验通过才允许）。
 * 发布流程：保存 → 封面截帧 → 预签名三步直传（ADR-015）→ PATCH coverUrl → publish。
 */
import { useQuery } from "@tanstack/vue-query";
import { Plus, Save, Send } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { validateRecipeIR, type RecipeIR } from "@shaker/recipe-ir";
import { FAMILY_ZH, METHOD_ZH } from "@/lib/labels";
import { familySkeleton } from "@shaker/recipe-ir";
import IngredientRow from "@/components/editor/IngredientRow.vue";
import StepCard from "@/components/editor/StepCard.vue";
import VizPlayer from "@/components/VizPlayer.vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const router = useRouter();
const api = useApi();
const auth = useAuthStore();
const vocab = useVocabStore();
const player = ref<{ captureCover: () => Promise<Blob | null> } | null>(null);

const isNew = computed(() => route.params.id === "new");
const recipeId = computed(() => (isNew.value ? null : String(route.params.id)));

useHead({ title: "创作 · Shaker" });

/* ── 已有草稿载入 ── */
const { data: existing, isLoading } = useQuery({
  queryKey: computed(() => ["recipe", "edit", recipeId.value] as const),
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/recipes/{id}", {
      params: { path: { id: recipeId.value! } },
    });
    if (error) throw error;
    return data;
  },
  enabled: computed(() => recipeId.value !== null),
});

/* ── 编辑状态 ── */
const title = ref("");
const subtitle = ref("");
const descriptionMd = ref("");
const family = ref<string>("sour");
const method = ref<string>("shaken");
const difficulty = ref(2);
const taste = ref({ sweet: 2, sour: 2, bitter: 0, strength: 3 });
const glass = ref("coupe");
const servings = ref(1);

// 经典关联（社区变体归组依据，API 定义 §2.6）。从经典页「创作我的版本」
// 进入时由 query 自动带上：?classicKey=margarita&derivedFrom=<canonical uuid>
const classicKey = ref("");
const derivedFrom = ref("");
if (isNew.value) {
  const q = route.query;
  if (typeof q.classicKey === "string" && q.classicKey) classicKey.value = q.classicKey;
  if (typeof q.derivedFrom === "string" && q.derivedFrom) derivedFrom.value = q.derivedFrom;
}

// 关联经典下拉选项（第一页 50 条足够 v1 全量经典）
const { data: classicOptions } = useQuery({
  queryKey: ["classics-options"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/classics", {
      params: { query: { limit: 50 } },
    });
    if (error) throw error;
    return data;
  },
  staleTime: 5 * 60_000,
});

// 下拉数据收敛成非空 { key, title }（classics 列表条目理论上必有 classicKey）
const classicChoices = computed(() =>
  (classicOptions.value?.items ?? [])
    .filter((c) => c.classicKey)
    .map((c) => ({ key: c.classicKey as string, title: c.title })),
);

// reka 禁空串 value（「清除选择」保留值），用 none 哨兵表达「不关联」。
// 后端 PATCH 的 classicKey 为 nil 即「不更新」，所以已关联的配方不提供取消项
const classicSel = computed({
  get: () => classicKey.value || "none",
  set: (v: string) => {
    classicKey.value = v === "none" ? "" : v;
  },
});

const ir = ref<RecipeIR>({
  schemaVersion: 1,
  glass: "coupe",
  method: "shaken",
  servings: 1,
  ingredients: [],
  steps: [],
});

const loadedExisting = ref(false);
watch(
  existing,
  (r) => {
    if (!r || loadedExisting.value) return;
    loadedExisting.value = true;
    title.value = r.title;
    subtitle.value = r.subtitle ?? "";
    descriptionMd.value = r.descriptionMd ?? "";
    family.value = r.family ?? "sour";
    method.value = (r.ir as RecipeIR).method ?? "shaken";
    difficulty.value = r.difficulty ?? 2;
    const t = r.tasteProfile;
    if (t) taste.value = { ...t };
    const loaded = r.ir as RecipeIR;
    glass.value = loaded.glass ?? "coupe";
    servings.value = loaded.servings ?? 1;
    classicKey.value = r.classicKey ?? "";
    derivedFrom.value = r.derivedFrom ?? "";
    ir.value = JSON.parse(JSON.stringify(loaded)) as RecipeIR;
  },
  { immediate: true },
);

onMounted(() => {
  void vocab.ensure().catch((e) => toast.error(apiErrorMessage(e)));
});

/* ── 家族预设 ── */
function applyFamily(): void {
  const sk = familySkeleton(family.value);
  if (sk.glass) {
    glass.value = sk.glass;
    ir.value.glass = sk.glass;
  }
  if (sk.method) {
    method.value = sk.method;
    ir.value.method = sk.method as RecipeIR["method"];
  }
  ir.value.steps = sk.steps.map((s, i) => ({
    ...s,
    id: `s${i + 1}`,
  })) as RecipeIR["steps"];
  toast.info(`已铺好「${FAMILY_ZH[family.value] ?? family.value}」的步骤骨架，选择原料即可`);
}

watch(glass, (g) => (ir.value.glass = g));
watch(method, (m) => (ir.value.method = m as RecipeIR["method"]));
watch(servings, (s) => (ir.value.servings = s));

/* ── 原料 / 步骤编辑 ── */
const slotLabels = computed(() =>
  ir.value.ingredients.map((i) => {
    const meta = vocab.ingMap.get(i.ingredientId);
    return {
      slot: i.slot,
      label: meta ? `${meta.nameZh} (${i.slot})` : `${i.slot}（未选原料）`,
    };
  }),
);

function addIngredient(): void {
  let n = ir.value.ingredients.length + 1;
  let slot = `i${n}`;
  const taken = new Set(ir.value.ingredients.map((i) => i.slot));
  while (taken.has(slot)) slot = `i${++n}`;
  ir.value.ingredients.push({
    slot,
    ingredientId: "",
    role: "base",
    unit: "ml",
    amount: 30,
  });
}

function removeIngredient(i: number): void {
  const removed = ir.value.ingredients[i];
  if (!removed) return;
  ir.value.ingredients.splice(i, 1);
  // 清掉步骤里对它的引用，避免悬空 slot
  for (const s of ir.value.steps) {
    const rec = s as unknown as Record<string, unknown>;
    if (Array.isArray(rec.items)) {
      rec.items = (rec.items as string[]).filter((x) => x !== removed.slot);
    }
  }
}

function addStep(): void {
  let n = ir.value.steps.length + 1;
  let id = `s${n}`;
  const taken = new Set(ir.value.steps.map((s) => s.id));
  while (taken.has(id)) id = `s${++n}`;
  ir.value.steps.push({ action: "ADD", id, target: "glass", items: [] } as never);
}

function moveStep(i: number, dir: number): void {
  const j = i + dir;
  if (j < 0 || j >= ir.value.steps.length) return;
  const steps = ir.value.steps;
  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
}

/* ── 诊断 ── */
const vocabLookup = computed(() => vocab.toVocabLookup());

const diagnosis = computed(() => {
  if (ir.value.ingredients.length === 0 && ir.value.steps.length === 0) {
    return { ok: true, errors: [], warnings: [] };
  }
  try {
    return validateRecipeIR(ir.value, vocabLookup.value);
  } catch {
    return {
      ok: false,
      errors: [{ code: "edit.incomplete", message: "配方结构不完整，继续填写", path: "" }],
      warnings: [],
    };
  }
});

/* ── 实时预览（debounce 后快照，改引用触发重编译） ── */
const previewIr = ref<RecipeIR>(ir.value);

function snapshotPreview(): void {
  previewIr.value = JSON.parse(JSON.stringify(ir.value)) as RecipeIR;
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  ir,
  () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (vocab.loaded) snapshotPreview();
    }, 250);
  },
  { deep: true },
);

// 词表就绪前编译必然失败（杯型剖面查不到），等 loaded 再出第一帧
watch(
  () => vocab.loaded,
  (l) => {
    if (l) snapshotPreview();
  },
  { immediate: true },
);

/* ── 保存 / 发布 ── */
const saving = ref(false);
const publishing = ref(false);
const savedId = ref<string | null>(null);
const savedVersion = ref<number | null>(null);

watch(existing, (r) => {
  if (r) {
    savedId.value = r.id;
    savedVersion.value = r.irVersion;
  }
});

function metaBody() {
  return {
    title: title.value.trim(),
    subtitle: subtitle.value.trim() || undefined,
    descriptionMd: descriptionMd.value.trim() || undefined,
    family: family.value,
    lang: "zh" as const,
    difficulty: difficulty.value,
    tasteProfile: { ...taste.value },
    classicKey: classicKey.value || undefined,
    derivedFrom: derivedFrom.value || undefined,
  };
}

/** 返回 (id, irVersion)；409 时提示已被他人修改。 */
async function saveDraft(): Promise<{ id: string; version: number } | null> {
  if (!title.value.trim()) {
    toast.error("先给这杯酒起个名字");
    return null;
  }
  const body = { ...metaBody(), ir: ir.value };
  if (savedId.value) {
    const { data, error } = await api.PATCH("/api/v1/recipes/{id}", {
      params: {
        path: { id: savedId.value },
        header: { "If-Match": String(savedVersion.value ?? 0) },
      },
      body,
    });
    if (error) {
      toast.error(apiErrorMessage(error));
      return null;
    }
    savedVersion.value = data.recipe.irVersion;
    return { id: data.recipe.id, version: data.recipe.irVersion };
  }
  const { data, error } = await api.POST("/api/v1/recipes", { body });
  if (error) {
    toast.error(apiErrorMessage(error));
    return null;
  }
  savedId.value = data.recipe.id;
  savedVersion.value = data.recipe.irVersion;
  if (isNew.value) {
    await router.replace({ params: { id: data.recipe.id } });
  }
  return { id: data.recipe.id, version: data.recipe.irVersion };
}

async function onSave(): Promise<void> {
  saving.value = true;
  try {
    const r = await saveDraft();
    if (r) toast.success("草稿已保存");
  } finally {
    saving.value = false;
  }
}

async function onPublish(): Promise<void> {
  // 发布严格：本地完整校验通过才继续（服务端还会再跑一遍）
  if (!diagnosis.value.ok) {
    toast.error("还有未解决的错误，不能发布", {
      description: diagnosis.value.errors[0]?.message,
    });
    return;
  }
  publishing.value = true;
  try {
    const saved = await saveDraft();
    if (!saved) return;

    // 封面：预览定格帧 → 预签名直传（ADR-015）
    const blob = await player.value?.captureCover();
    if (blob) {
      const up = await api.POST("/api/v1/media/upload-url", {
        body: {
          purpose: "recipe_cover" as const,
          entityId: saved.id,
          mimeType: "image/png" as const,
          byteSize: blob.size,
        },
      });
      if (up.error) throw up.error;
      const put = await fetch(up.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      if (!put.ok) throw new Error(`封面上传失败（${put.status}）`);
      const commit = await api.POST("/api/v1/media/{assetId}/commit", {
        params: { path: { assetId: up.data.assetId } },
      });
      if (commit.error) throw commit.error;
      await api.PATCH("/api/v1/recipes/{id}", {
        params: {
          path: { id: saved.id },
          header: { "If-Match": String(saved.version) },
        },
        body: { coverUrl: commit.data.url },
      });
    }

    const pub = await api.POST("/api/v1/recipes/{id}/publish", {
      params: { path: { id: saved.id } },
    });
    if (pub.error) {
      toast.error("发布未通过校验", { description: apiErrorMessage(pub.error) });
      return;
    }
    toast.success("已发布！");
    await router.replace(`/r/${pub.data.code}`);
  } catch (err) {
    toast.error(apiErrorMessage(err));
  } finally {
    publishing.value = false;
  }
}

const tasteKeys: Array<{ key: keyof typeof taste.value; label: string }> = [
  { key: "sweet", label: "甜" },
  { key: "sour", label: "酸" },
  { key: "bitter", label: "苦" },
  { key: "strength", label: "烈" },
];
</script>

<template>
  <div v-if="!isNew && isLoading" class="flex flex-col gap-4">
    <Skeleton class="h-10 w-64" />
    <Skeleton class="h-96 w-full" />
  </div>

  <div v-else class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
    <!-- 左：表单 -->
    <div class="flex min-w-0 flex-col gap-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-bold">{{ isNew ? "写一杯新酒" : "编辑配方" }}</h1>
        <div class="flex items-center gap-2">
          <Button variant="outline" :disabled="saving" @click="onSave()">
            <Save class="size-4" /> {{ saving ? "保存中…" : "保存草稿" }}
          </Button>
          <Button :disabled="publishing" @click="onPublish()">
            <Send class="size-4" /> {{ publishing ? "发布中…" : "发布" }}
          </Button>
        </div>
      </div>

      <!-- 基本信息 -->
      <Card>
        <CardHeader><CardTitle class="text-base">基本信息</CardTitle></CardHeader>
        <CardContent class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5 sm:col-span-2">
            <Label for="title">标题 *</Label>
            <Input id="title" v-model="title" maxlength="80" placeholder="Daiquiri" />
          </div>
          <div class="flex flex-col gap-1.5 sm:col-span-2">
            <Label for="subtitle">副标题</Label>
            <Input id="subtitle" v-model="subtitle" maxlength="120" placeholder="白朗姆 · 青柠 · 糖浆" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>家族（决定步骤骨架）</Label>
            <div class="flex gap-2">
              <Select v-model="family">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="(zh, f) in FAMILY_ZH" :key="f" :value="f">
                    {{ zh }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" class="shrink-0" @click="applyFamily()">
                铺骨架
              </Button>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="method">手法标记</Label>
            <Select id="method" v-model="method">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(zh, m) in METHOD_ZH" :key="m" :value="m">{{ zh }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="glass">成品杯型</Label>
            <Select id="glass" v-model="glass">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="g in vocab.glassware" :key="g.id" :value="g.id">
                  {{ g.nameZh }}（{{ g.capacityMl }}ml）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="servings">份</Label>
            <Input id="servings" v-model.number="servings" type="number" min="1" max="50" class="tabular-nums" />
          </div>
          <div class="flex flex-col gap-1.5 sm:col-span-2">
            <Label>关联经典</Label>
            <Select v-model="classicSel">
              <SelectTrigger><SelectValue placeholder="不关联" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-if="!classicKey" value="none">不关联</SelectItem>
                <SelectItem
                  v-for="c in classicChoices"
                  :key="c.key"
                  :value="c.key"
                >
                  {{ c.title }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              关联后这杯酒会出现在该经典的「社区变体」列表；从经典页「创作我的版本」进入时自动关联。
            </p>
          </div>
          <div class="flex flex-col gap-1.5 sm:col-span-2">
            <Label>难度（{{ difficulty }}/3）与口味</Label>
            <div class="flex flex-wrap items-center gap-4">
              <input
                type="range" min="1" max="3" step="1"
                class="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                v-model.number="difficulty"
              />
              <div v-for="t in tasteKeys" :key="t.key" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span class="w-4">{{ t.label }}</span>
                <input
                  type="range" min="0" max="5" step="1"
                  class="h-1.5 w-16 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                  :value="taste[t.key]"
                  @input="taste[t.key] = Number(($event.target as HTMLInputElement).value)"
                />
                <span class="w-3 tabular-nums">{{ taste[t.key] }}</span>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-1.5 sm:col-span-2">
            <Label for="desc">描述</Label>
            <Textarea id="desc" v-model="descriptionMd" :maxlength="4000" class="min-h-20" placeholder="这杯酒的故事、灵感、风味……" />
          </div>
        </CardContent>
      </Card>

      <!-- 原料 -->
      <Card>
        <CardHeader class="flex-row items-center justify-between">
          <CardTitle class="text-base">原料（{{ ir.ingredients.length }}）</CardTitle>
          <Button variant="outline" size="sm" @click="addIngredient()">
            <Plus class="size-3.5" /> 加原料
          </Button>
        </CardHeader>
        <CardContent class="flex flex-col gap-2.5">
          <Alert v-if="ir.ingredients.length === 0" variant="default">
            <AlertDescription>还没有原料。先加基酒、酸、甜。</AlertDescription>
          </Alert>
          <IngredientRow
            v-for="(ing, i) in ir.ingredients"
            :key="ing.slot"
            :model-value="ing"
            @update:model-value="ir.ingredients[i] = $event"
            @remove="removeIngredient(i)"
          />
        </CardContent>
      </Card>

      <!-- 步骤 -->
      <Card>
        <CardHeader class="flex-row items-center justify-between">
          <CardTitle class="text-base">步骤（{{ ir.steps.length }}）</CardTitle>
          <Button variant="outline" size="sm" @click="addStep()">
            <Plus class="size-3.5" /> 加步骤
          </Button>
        </CardHeader>
        <CardContent class="flex flex-col gap-2.5">
          <StepCard
            v-for="(s, i) in ir.steps"
            :key="s.id"
            :model-value="s"
            :index="i"
            :slots="slotLabels"
            @update:model-value="ir.steps[i] = $event"
            @remove="ir.steps.splice(i, 1)"
            @move="moveStep(i, $event)"
          />
        </CardContent>
      </Card>
    </div>

    <!-- 右：预览 + 诊断（sticky） -->
    <div class="flex flex-col gap-4 lg:sticky lg:top-20">
      <div>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-medium">实时预览</h2>
          <Badge variant="secondary" class="text-xs">
            {{ diagnosis.ok ? "结构合法" : `${diagnosis.errors.length} 个错误` }}
          </Badge>
        </div>
        <div
          v-if="!vocab.loaded"
          class="flex aspect-[400/520] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
        >
          词表加载中…
        </div>
        <VizPlayer v-else ref="player" :ir="previewIr" :vocab="vocabLookup" />
      </div>

      <Card v-if="diagnosis.errors.length || diagnosis.warnings.length">
        <CardHeader><CardTitle class="text-base">诊断</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-1.5">
          <Alert v-for="d in diagnosis.errors" :key="d.code + d.path" variant="destructive" class="py-2">
            <AlertTitle class="text-xs">{{ d.code }}</AlertTitle>
            <AlertDescription class="text-xs">
              {{ d.message }}<code v-if="d.path" class="ml-1 opacity-70">{{ d.path }}</code>
            </AlertDescription>
          </Alert>
          <Alert v-for="d in diagnosis.warnings.slice(0, 6)" :key="d.code + d.path" class="py-2">
            <AlertDescription class="text-xs">
              ⚠ {{ d.message }}<code v-if="d.path" class="ml-1 opacity-70">{{ d.path }}</code>
            </AlertDescription>
          </Alert>
          <p class="text-xs text-muted-foreground">
            草稿阶段错误不阻止保存；发布前必须清掉全部错误。
          </p>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
