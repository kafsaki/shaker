<script setup lang="ts">
/**
 * 结构化编辑器（ADR-001 创作区）——「调酒工坊」：左配方卡 / 材料 / 工序，右试饮预览 + 诊断。
 * 草稿宽松（错误不阻止保存），发布严格（本地完整校验通过才允许）。
 * 发布流程：保存 → 封面截帧 → 预签名三步直传（ADR-015）→ PATCH coverUrl → publish。
 * 百科修订（ADR-027）：载入的是经典条目时进入修订模式——没有草稿与发布，只有「提交修订」，
 * 每次提交在修订历史里记一版；?from=<版本号> 以历史版本为底稿。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "@/lib/toast";
import type { components } from "@shaker/api-client";
import { validateRecipeIR, type RecipeIR } from "@shaker/recipe-ir";
import { FAMILY_ZH, METHOD_ZH } from "@/lib/labels";
import { familySkeleton } from "@shaker/recipe-ir";
import IngredientRow from "@/components/editor/IngredientRow.vue";
import StepCard from "@/components/editor/StepCard.vue";
import TasteMeter from "@/components/editor/TasteMeter.vue";
import VizPlayer from "@/components/VizPlayer.vue";
import BartenderAgent from "@/components/editor/BartenderAgent.vue";

type DraftPage = components["schemas"]["RecipeListOutputBody"];
type AgentDraft = components["schemas"]["AgentDraftOutputBody"];

definePageMeta({ middleware: "auth" });

const route = useRoute();
const router = useRouter();
const api = useApi();
const qc = useQueryClient();
const auth = useAuthStore();
const vocab = useVocabStore();
const player = ref<{ captureCover: () => Promise<{ dark: Blob; light: Blob } | null> } | null>(null);

const isNew = computed(() => route.params.id === "new");
const recipeId = computed(() => (isNew.value ? null : String(route.params.id)));

useHead({ title: "调酒工坊 · Shaker" });

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

/** 修订经典条目（百科模式）：经典本身就是锚点，不能再关联别的经典 */
const wikiMode = computed(() => existing.value?.isCanonical === true);
const wikiNote = ref("");

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

/** 标签（受控词表 tag_id，多选；对应后端 recipe_tags）。 */
const tags = ref<string[]>([]);

function toggleTag(id: string): void {
  tags.value = tags.value.includes(id)
    ? tags.value.filter((t) => t !== id)
    : [...tags.value, id];
}

const ir = ref<RecipeIR>({
  schemaVersion: 1,
  glass: "coupe",
  method: "shaken",
  servings: 1,
  ingredients: [],
  steps: [],
});

// 已载入表单内容对应的配方 id（用于判断是否需要把服务器数据灌进表单，
// 同时避免保存后 refetch 回包覆盖用户正在输入的内容）
const loadedId = ref<string | null>(null);
watch(
  existing,
  (r) => {
    if (!r || loadedId.value === r.id) return;
    loadedId.value = r.id;
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
    tags.value = [...(r.tags ?? [])];
    ir.value = JSON.parse(JSON.stringify(loaded)) as RecipeIR;
    if (r.isCanonical && typeof route.query.from === "string") void loadRevision(r.id, Number(route.query.from));
  },
  { immediate: true },
);

/** 以历史版本为底稿：IR 与元数据快照覆盖表单（早期版本没有快照，只回滚 IR）。 */
async function loadRevision(id: string, version: number): Promise<void> {
  if (!Number.isInteger(version) || version < 1) return;
  const { data, error } = await api.GET("/api/v1/recipes/{id}/revisions/{version}", {
    params: { path: { id, version } },
  });
  if (error) {
    toast.error(apiErrorMessage(error));
    return;
  }
  const old = data.ir as RecipeIR;
  title.value = data.title;
  ir.value = JSON.parse(JSON.stringify(old)) as RecipeIR;
  glass.value = old.glass ?? glass.value;
  method.value = old.method ?? method.value;
  servings.value = old.servings ?? servings.value;
  const m = data.meta;
  if (m) {
    subtitle.value = m.subtitle ?? "";
    descriptionMd.value = m.descriptionMd ?? "";
    if (m.family) family.value = m.family;
    if (m.difficulty) difficulty.value = m.difficulty;
    if (m.tasteProfile) taste.value = { ...m.tasteProfile };
    tags.value = [...(m.tags ?? [])];
  }
  wikiNote.value = `回退到第 ${version} 版`;
  toast.info(`已载入第 ${version} 版作为底稿，确认后提交修订`);
}

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
      // 工序卡材料 chip 的色点（纯展示）
      color: (meta?.viz as { color?: string } | undefined)?.color,
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
  const base = {
    title: title.value.trim(),
    subtitle: subtitle.value.trim() || undefined,
    descriptionMd: descriptionMd.value.trim() || undefined,
    family: family.value,
    lang: "zh" as const,
    difficulty: difficulty.value,
    tasteProfile: { ...taste.value },
    tags: tags.value,
  };
  if (wikiMode.value) return { ...base, note: wikiNote.value.trim() || undefined };
  return {
    ...base,
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
    void qc.invalidateQueries({ queryKey: ["my-drafts"] });
    return { id: data.recipe.id, version: data.recipe.irVersion };
  }
  const { data, error } = await api.POST("/api/v1/recipes", { body });
  if (error) {
    toast.error(apiErrorMessage(error));
    return null;
  }
  savedId.value = data.recipe.id;
  savedVersion.value = data.recipe.irVersion;
  loadedId.value = data.recipe.id; // 表单内容即这份配方，防止 refetch 回包覆盖
  void qc.invalidateQueries({ queryKey: ["my-drafts"] });
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
    // 封面必须在 saveDraft 之前截帧：新建配方保存时会 router.replace 改路由参数，
    // 期间播放器可能被替换掉，之后再取 player 会拿到 null，截帧就被静默跳过（于是没有封面）。
    // 先 snapshotPreview + nextTick，保证截的是当前编辑状态而非 debounce 前的旧帧。
    snapshotPreview();
    await nextTick();
    const covers = player.value ? await player.value.captureCover() : null;

    const saved = await saveDraft();
    if (!saved) return;

    if (!covers) {
      toast.error("封面生成失败，本次发布不带封面");
    } else {
      // 预签名三步直传（ADR-015）：签发 → PUT 直传 MinIO → commit → 落库 coverUrl。
      // 暗/亮两个 variant 走固定对象键（cover-dark / cover-light），互不冲突可并发。
      const uploadCover = async (variant: "dark" | "light", blob: Blob): Promise<string> => {
        const up = await api.POST("/api/v1/media/upload-url", {
          body: {
            purpose: "recipe_cover" as const,
            entityId: saved.id,
            mimeType: "image/png" as const,
            byteSize: blob.size,
            variant,
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
        return commit.data.url;
      };

      const [coverUrl, coverUrlLight] = await Promise.all([
        uploadCover("dark", covers.dark),
        uploadCover("light", covers.light),
      ]);
      const patch = await api.PATCH("/api/v1/recipes/{id}", {
        params: {
          path: { id: saved.id },
          header: { "If-Match": String(saved.version) },
        },
        body: { coverUrl, coverUrlLight },
      });
      if (patch.error) throw patch.error;
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

/** 百科修订：经典条目是已发布状态，服务端会跑完整校验，这里先在本地拦一道。 */
async function onSubmitRevision(): Promise<void> {
  if (!diagnosis.value.ok) {
    toast.error("还有未解决的错误，不能提交", { description: diagnosis.value.errors[0]?.message });
    return;
  }
  saving.value = true;
  try {
    const r = await saveDraft();
    if (!r) return;
    toast.success(`修订已提交（第 ${r.version} 版）`);
    const key = existing.value?.classicKey;
    await qc.invalidateQueries({ queryKey: ["classic", key] });
    await qc.invalidateQueries({ queryKey: ["wiki-changes"] });
    void qc.invalidateQueries({ queryKey: ["recipe-revisions", r.id] });
    void qc.invalidateQueries({ queryKey: ["wiki-target", "recipe", r.id] });
    await router.push(key ? `/classics/${key}` : `/wiki/history/recipe/${r.id}`);
  } finally {
    saving.value = false;
  }
}

/* ── 读取草稿：列出我的草稿，可载入编辑器或删除 ── */
const draftsOpen = ref(false);

// HUD 玩家菜单的「草稿箱」入口是 /editor/new?drafts=1：进来即打开对话框。
// 打开后把 drafts 从地址栏摘掉（只改 query 不会重建页面），这样关掉后再点菜单还能再次打开
watch(
  () => route.query.drafts,
  (d) => {
    if (d !== "1") return;
    draftsOpen.value = true;
    void router.replace({ query: { ...route.query, drafts: undefined } });
  },
  { immediate: true },
);

const { data: drafts, isLoading: draftsLoading } = useQuery({
  queryKey: ["my-drafts"] as const,
  queryFn: async (): Promise<DraftPage> => {
    const { data, error } = await api.GET("/api/v1/me/drafts", {
      params: { query: { limit: 50 } },
    });
    if (error) throw error;
    return data;
  },
});

/** 载入某份草稿：改路由参数，useQuery 重新取详情后由 loadedId 判断灌入表单。 */
async function loadDraft(draftId: string): Promise<void> {
  draftsOpen.value = false;
  if (draftId === recipeId.value) return;
  await router.push(`/editor/${draftId}`);
}

/** 清空表单（删除当前草稿后回到「写新酒」状态）。 */
function resetForm(): void {
  title.value = "";
  subtitle.value = "";
  descriptionMd.value = "";
  family.value = "sour";
  method.value = "shaken";
  difficulty.value = 2;
  taste.value = { sweet: 2, sour: 2, bitter: 0, strength: 3 };
  glass.value = "coupe";
  servings.value = 1;
  classicKey.value = "";
  derivedFrom.value = "";
  tags.value = [];
  ir.value = {
    schemaVersion: 1,
    glass: "coupe",
    method: "shaken",
    servings: 1,
    ingredients: [],
    steps: [],
  };
  loadedId.value = null;
  savedId.value = null;
  savedVersion.value = null;
  snapshotPreview();
}

const deleteDraft = useMutation({
  mutationFn: async (draftId: string) => {
    const { error } = await api.DELETE("/api/v1/recipes/{id}", {
      params: { path: { id: draftId } },
    });
    if (error) throw error;
    return draftId;
  },
  onSuccess: async (draftId) => {
    toast.success("草稿已删除");
    await qc.invalidateQueries({ queryKey: ["my-drafts"] });
    // 删的就是当前正在编辑的这份 → 清空表单回到新建
    if (savedId.value === draftId) {
      draftsOpen.value = false;
      await router.replace("/editor/new");
      resetForm();
    }
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

function formatDraftTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── 酒保助手（ADR-028）：自然语言生成草稿，过目后填入表单 ── */
const agentOpen = ref(false);

const agentEnabled = useAgentStatus();

// HUD 菜单入口 /editor/new?agent=1，与 ?drafts=1 同样的打开即摘掉
watch(
  () => route.query.agent,
  (a) => {
    if (a !== "1") return;
    agentOpen.value = true;
    void router.replace({ query: { ...route.query, agent: undefined } });
  },
  { immediate: true },
);

/** 表单为空时不带 current，助手就从零写 */
const agentCurrent = computed(() => {
  if (!title.value.trim() && ir.value.ingredients.length === 0) return null;
  return {
    title: title.value,
    subtitle: subtitle.value,
    descriptionMd: descriptionMd.value,
    family: family.value,
    difficulty: difficulty.value,
    tasteProfile: { ...taste.value },
    tags: tags.value,
    ir: ir.value,
  };
});

function applyAgentDraft(d: AgentDraft): void {
  const next = JSON.parse(JSON.stringify(d.ir)) as RecipeIR;
  title.value = d.title;
  subtitle.value = d.subtitle;
  descriptionMd.value = d.descriptionMd;
  if (d.family) family.value = d.family;
  difficulty.value = Math.min(3, Math.max(1, d.difficulty));
  taste.value = { ...d.tasteProfile };
  tags.value = [...(d.tags ?? [])];
  ir.value = next;
  glass.value = next.glass;
  method.value = next.method ?? method.value;
  servings.value = next.servings ?? 1;
  snapshotPreview();
  toast.success(`「${d.title}」已填入工坊，检查一下再保存`);
}

const tasteKeys: Array<{
  key: keyof typeof taste.value;
  label: string;
  tone: "pink" | "green" | "cyan" | "red";
}> = [
  { key: "sweet", label: "甜", tone: "pink" },
  { key: "sour", label: "酸", tone: "green" },
  { key: "bitter", label: "苦", tone: "cyan" },
  { key: "strength", label: "烈", tone: "red" },
];

/* ── 下拉选项（PxSelect 扁平 options） ── */
const familyOptions = Object.entries(FAMILY_ZH).map(([value, label]) => ({ value, label }));
const methodOptions = Object.entries(METHOD_ZH).map(([value, label]) => ({ value, label }));
const glassOptions = computed(() =>
  vocab.glassware.map((g) => ({ value: g.id, label: `${g.nameZh}（${g.capacityMl}ml）` })),
);
const classicSelectOptions = computed(() => [
  ...(classicKey.value ? [] : [{ value: "none", label: "不关联" }]),
  ...classicChoices.value.map((c) => ({ value: c.key, label: c.title })),
]);

/** 难度保持 1..3：PxStars 再点同一颗会清零，这里兜住下限。 */
function setDifficulty(v: number): void {
  difficulty.value = Math.max(1, v);
}
</script>

<template>
  <div>
    <!-- 新建配方保存后 router.replace 会改路由参数，useQuery 随之重新加载；此时 savedId
         已有值，不能再回落到骨架屏——否则编辑器（含预览播放器）被整块卸载，接着的封面截帧就没有播放器可用。 -->
    <div v-if="!isNew && isLoading && !savedId" class="flex flex-col gap-4">
      <PxSkeleton class="h-14 w-72" />
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <PxSkeleton class="h-[560px]" />
        <PxSkeleton class="aspect-[400/560]" />
      </div>
    </div>

    <div v-else class="flex flex-col gap-6">
      <!-- 页头：工坊招牌 + 存档状态 + 操作 -->
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="sign"><PxIcon name="shaker" :scale="3" /></span>
          <div>
            <h1 class="flex items-baseline gap-3 text-2xl text-fg text-shadow-px">
              调酒工坊
              <span class="font-logo text-[8px] tracking-[0.25em] text-amber">WORKSHOP</span>
            </h1>
            <p v-if="wikiMode" class="flex flex-wrap items-center gap-x-2 text-dim">
              <PxBadge tone="gold" variant="solid" icon="book">百科修订</PxBadge>
              <span>正在修订经典条目</span>
              <span class="font-logo text-[8px] text-faint">v{{ savedVersion }}</span>
            </p>
            <p v-else class="flex flex-wrap items-center gap-x-2 text-dim">
              <PxBadge :tone="isNew && !savedId ? 'pink' : 'cyan'" variant="solid">
                {{ isNew && !savedId ? "新配方" : "编辑中" }}
              </PxBadge>
              <span v-if="savedId" class="flex items-center gap-1 text-green">
                <PxIcon name="save" :scale="1" /> 已存档
                <span v-if="savedVersion !== null" class="font-logo text-[8px] text-faint">v{{ savedVersion }}</span>
              </span>
              <span v-else class="flex items-center gap-1 text-faint">
                <span class="animate-blink">●</span> 尚未存档
              </span>
            </p>
          </div>
        </div>
        <div v-if="wikiMode" class="flex flex-wrap items-center gap-2">
          <PxButton icon="clock" :to="`/wiki/history/recipe/${savedId}`">修订历史</PxButton>
          <PxButton variant="primary" icon="send" sfx="start" :loading="saving" @click="onSubmitRevision()">
            {{ saving ? "提交中…" : "提交修订" }}
          </PxButton>
        </div>
        <div v-else class="flex flex-wrap items-center gap-2">
          <PxButton v-if="agentEnabled" variant="accent" icon="sparkle" @click="agentOpen = true">酒保助手</PxButton>
          <PxButton icon="folder" @click="draftsOpen = true">读取草稿</PxButton>
          <PxButton icon="save" :loading="saving" @click="onSave()">
            {{ saving ? "保存中…" : "保存草稿" }}
          </PxButton>
          <PxButton variant="primary" icon="send" sfx="start" :loading="publishing" @click="onPublish()">
            {{ publishing ? "发布中…" : "发布" }}
          </PxButton>
        </div>
      </header>

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <!-- 左：表单 -->
        <div class="flex min-w-0 flex-col gap-6">
          <!-- 百科修订：编辑摘要（写进修订历史，让后来的人知道为什么改） -->
          <PxPanel v-if="wikiMode" title="编辑摘要" icon="book" tone="plain" variant="inset">
            <div class="field">
              <PxInput v-model="wikiNote" maxlength="200" placeholder="例：按 IBA 2020 版修正青柠用量" />
              <p class="text-faint">这是官方经典条目，所有人都会看到你的修订。改动会记一版，随时可以回退。</p>
            </div>
          </PxPanel>
          <!-- 配方卡 -->
          <PxPanel title="配方卡" icon="pencil">
            <div class="grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <div class="field sm:col-span-2">
                <span class="lbl">标题 <span class="text-red">*</span></span>
                <PxInput v-model="title" size="lg" maxlength="80" placeholder="Daiquiri" />
              </div>
              <div class="field sm:col-span-2">
                <span class="lbl">副标题</span>
                <PxInput v-model="subtitle" maxlength="120" placeholder="白朗姆 · 青柠 · 糖浆" />
              </div>
              <div class="field">
                <span class="lbl">家族（决定步骤骨架）</span>
                <div class="flex items-center gap-2">
                  <div class="sel min-w-0 flex-1">
                    <PxSelect v-model="family" :options="familyOptions" />
                  </div>
                  <PxButton icon="list" title="按家族铺好步骤模板（会替换现有步骤）" @click="applyFamily()">铺骨架</PxButton>
                </div>
              </div>
              <div class="field">
                <span class="lbl">手法标记</span>
                <div class="sel"><PxSelect v-model="method" :options="methodOptions" /></div>
              </div>
              <div class="field">
                <span class="lbl">成品杯型</span>
                <div class="sel"><PxSelect v-model="glass" :options="glassOptions" placeholder="词表加载中…" /></div>
              </div>
              <div class="field">
                <span class="lbl">份数</span>
                <PxInput v-model.number="servings" type="number" min="1" max="50" />
              </div>

              <div class="field sm:col-span-2">
                <span class="lbl">标签（可多选，用于筛选与推荐）</span>
                <div v-if="vocab.tags.length" class="flex flex-wrap items-center gap-x-1 gap-y-1">
                  <button
                    v-for="t in vocab.tags"
                    :key="t.id"
                    type="button"
                    class="chip"
                    :class="{ on: tags.includes(t.id) }"
                    :aria-pressed="tags.includes(t.id)"
                    @click="toggleTag(t.id)"
                  >
                    {{ t.nameZh }}
                  </button>
                </div>
                <p v-else class="text-faint">标签词表加载中…</p>
              </div>

              <div v-if="!wikiMode" class="field sm:col-span-2">
                <span class="lbl">关联经典</span>
                <div class="sel"><PxSelect v-model="classicSel" :options="classicSelectOptions" placeholder="不关联" /></div>
                <p class="text-faint">
                  关联后这杯酒会出现在该经典的「社区变体」列表；从经典页「创作我的版本」进入时自动关联。
                </p>
              </div>

              <div class="field">
                <span class="lbl">难度 <span class="font-logo text-[8px] text-amber">{{ difficulty }}/3</span></span>
                <PxStars :model-value="difficulty" :max="3" label="难度" @update:model-value="setDifficulty" />
              </div>
              <div class="field">
                <span class="lbl">口味（点格子设定，再点最高格减一）</span>
                <div class="flex flex-col gap-1.5">
                  <TasteMeter
                    v-for="t in tasteKeys"
                    :key="t.key"
                    v-model="taste[t.key]"
                    :label="t.label"
                    :tone="t.tone"
                  />
                </div>
              </div>

              <div class="field sm:col-span-2">
                <span class="lbl">描述</span>
                <PxTextarea v-model="descriptionMd" :maxlength="4000" placeholder="这杯酒的故事、灵感、风味……" />
              </div>
            </div>
          </PxPanel>

          <!-- 材料 -->
          <PxPanel icon="bottle" tone="green" :padded="false">
            <template #title>
              材料 <span class="ml-1 font-logo text-[8px] text-faint">×{{ ir.ingredients.length }}</span>
            </template>
            <template #actions>
              <PxButton size="sm" variant="success" icon="plus" @click="addIngredient()">加原料</PxButton>
            </template>
            <div class="flex flex-col gap-2 p-3">
              <p v-if="ir.ingredients.length === 0" class="hint">
                <PxIcon name="info" :scale="1" class="text-green" /> 还没有原料。先加基酒、酸、甜。
              </p>
              <IngredientRow
                v-for="(ing, i) in ir.ingredients"
                :key="ing.slot"
                :model-value="ing"
                @update:model-value="ir.ingredients[i] = $event"
                @remove="removeIngredient(i)"
              />
            </div>
          </PxPanel>

          <!-- 工序 -->
          <PxPanel icon="list" tone="cyan" :padded="false">
            <template #title>
              工序 <span class="ml-1 font-logo text-[8px] text-faint">×{{ ir.steps.length }}</span>
            </template>
            <template #actions>
              <PxButton size="sm" icon="plus" @click="addStep()">加步骤</PxButton>
            </template>
            <div class="flex flex-col gap-2 p-3">
              <p v-if="ir.steps.length === 0" class="hint">
                <PxIcon name="info" :scale="1" class="text-cyan" /> 还没有步骤。在配方卡选好家族点「铺骨架」，或手动加步骤。
              </p>
              <StepCard
                v-for="(s, i) in ir.steps"
                :key="s.id"
                :model-value="s"
                :index="i"
                :last="i === ir.steps.length - 1"
                :slots="slotLabels"
                @update:model-value="ir.steps[i] = $event"
                @remove="ir.steps.splice(i, 1)"
                @move="moveStep(i, $event)"
              />
            </div>
          </PxPanel>
        </div>

        <!-- 右：试饮预览 + 诊断（sticky） -->
        <aside class="flex flex-col gap-5 lg:sticky lg:top-20">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <h2 class="flex items-center gap-2 text-fg">
                <PxIcon name="eye" :scale="2" class="text-amber" /> 试饮预览
              </h2>
              <PxBadge v-if="diagnosis.ok" tone="green" variant="solid" icon="check">结构合法</PxBadge>
              <PxBadge v-else tone="red" variant="solid" icon="warn">{{ diagnosis.errors.length }} 个错误</PxBadge>
            </div>
            <div v-if="!vocab.loaded" class="grid aspect-[400/520] place-items-center bg-deep px-ring">
              <PxLoader text="TUNING" />
            </div>
            <VizPlayer v-else ref="player" :ir="previewIr" :vocab="vocabLookup" :hotkeys="false" />
          </div>

          <PxPanel title="诊断" icon="info" tone="plain" :padded="false">
            <template #actions>
              <span class="font-logo text-[8px] text-faint">SYSTEM</span>
            </template>
            <ul v-if="diagnosis.errors.length || diagnosis.warnings.length" class="flex flex-col gap-1 p-2">
              <li v-for="d in diagnosis.errors" :key="d.code + d.path" class="diag err">
                <span class="mark text-red">✖</span>
                <span class="min-w-0 flex-1">
                  <span class="code text-red">{{ d.code }}</span>
                  <span class="text-fg">{{ d.message }}</span>
                  <span v-if="d.path" class="path">{{ d.path }}</span>
                </span>
              </li>
              <li v-for="d in diagnosis.warnings.slice(0, 6)" :key="d.code + d.path" class="diag warn">
                <span class="mark text-amber">⚠</span>
                <span class="min-w-0 flex-1">
                  <span class="text-fg">{{ d.message }}</span>
                  <span v-if="d.path" class="path">{{ d.path }}</span>
                </span>
              </li>
            </ul>
            <p v-else class="flex items-center gap-2 p-3 text-green">
              <PxIcon name="check" :scale="1" /> 一切正常，没有诊断问题。
            </p>
            <p class="border-t-2 border-dashed border-line px-3 py-2 text-faint">
              草稿阶段错误不阻止保存；发布前必须清掉全部错误。
            </p>
          </PxPanel>
        </aside>
      </div>

      <!-- 读取草稿：存档槽列表，点槽位载入，右上角删除 -->
      <PxDialog v-model:open="draftsOpen" title="读取草稿" icon="folder" size="lg">
        <div v-if="draftsLoading" class="grid gap-3 sm:grid-cols-2">
          <PxSkeleton v-for="i in 4" :key="i" class="h-20" />
        </div>

        <div
          v-else-if="(drafts?.items ?? []).length"
          class="grid max-h-[60vh] gap-3 overflow-y-auto p-1 sm:grid-cols-2"
        >
          <div
            v-for="(d, n) in drafts?.items ?? []"
            :key="d.id"
            class="slot"
            :class="{ cur: d.id === recipeId }"
          >
            <button type="button" class="flex w-full flex-col gap-1 p-3 pr-10 text-left" @click="loadDraft(d.id)">
              <span class="flex items-center gap-2">
                <span class="font-logo text-[8px] text-faint">SLOT {{ String(n + 1).padStart(2, "0") }}</span>
                <PxBadge v-if="d.id === recipeId" tone="amber">正在编辑</PxBadge>
              </span>
              <span class="truncate text-fg">{{ d.title }}</span>
              <span class="flex items-center gap-1 text-faint">
                <PxIcon name="clock" :scale="1" /> 更新于 {{ formatDraftTime(d.updatedAt) }}
              </span>
            </button>
            <PxButton
              square
              size="sm"
              variant="danger"
              icon="trash"
              title="删除草稿"
              class="del"
              sfx="cancel"
              :disabled="deleteDraft.isPending.value"
              @click="deleteDraft.mutate(d.id)"
            />
          </div>
        </div>

        <PxEmpty v-else icon="folder" title="还没有草稿。写好一杯酒后点「保存草稿」。" />
      </PxDialog>

      <BartenderAgent
        v-if="agentEnabled && !wikiMode"
        v-model:open="agentOpen"
        :current="agentCurrent"
        @apply="applyAgentDraft"
      />
    </div>
  </div>
</template>

<style scoped>
.sign {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin: var(--p);
  background: var(--amber);
  color: var(--on-accent);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35),
    inset calc(var(--p) * -1) calc(var(--p) * -1) 0 0 rgb(0 0 0 / 0.25),
    calc(var(--p) * 2) calc(var(--p) * 2) 0 0 var(--shadow);
}
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.lbl { color: var(--dim); }
/* PxSelect 不透传 class（reka SelectRoot 吞掉 attrs），宽度由外层 .sel 定、触发器撑满 */
.sel :deep(.px-sel-trigger) { width: calc(100% - var(--p) * 2); }

.field :deep(input[type="number"]) { font-family: var(--font-logo); font-size: 8px; color: var(--amber); }
.chip {
  height: 22px;
  margin: 2px;
  padding: 0 7px;
  background: var(--panel-lo);
  color: var(--dim);
  box-shadow: 0 0 0 var(--p) var(--line);
}
.chip:hover { color: var(--fg); box-shadow: 0 0 0 var(--p) var(--amber); }
.chip.on {
  background: var(--amber);
  color: var(--on-accent);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35);
}
.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin: var(--p);
  color: var(--dim);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--line);

}
.diag {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  background: var(--deep);
  box-shadow: inset calc(var(--p) * 2) 0 0 0 var(--c, var(--line));
}
.diag.err { --c: var(--red); }
.diag.warn { --c: var(--amber); }
.diag .mark { flex-shrink: 0; width: 12px; text-align: center; }
.diag .code { margin-right: 6px; font-family: var(--font-logo); font-size: 8px; }
.diag .path { margin-left: 6px; color: var(--faint); word-break: break-all; }
.slot {
  position: relative;
  margin: var(--p);
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.slot:hover {
  background: var(--panel-hi);
  box-shadow: 0 0 0 var(--p) var(--amber), var(--p) var(--p) 0 var(--p) var(--shadow);
}
.slot.cur { box-shadow: 0 0 0 var(--p) var(--amber), inset calc(var(--p) * 2) 0 0 0 var(--amber); }
.slot .del { position: absolute; top: 8px; right: 8px; }
</style>
