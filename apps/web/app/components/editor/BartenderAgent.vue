<script setup lang="ts">
/**
 * 酒保助手（ADR-028）：用一句话描述想喝的酒，后端让模型写出结构化配方（已过 irv 校验），
 * 用户过目后「填入工坊」。草稿不落库，保存仍走编辑器自己的流程。
 * 追问时：有未填入的草稿就在草稿上改；否则勾选「在工坊当前配方上修改」时改表单里的配方。
 */
import { toast } from "@/lib/toast";
import type { components } from "@shaker/api-client";
import { UNIT_GROUPS, type RecipeIR } from "@shaker/recipe-ir";
import { BARTENDER, BARTENDER_PALETTE } from "@/lib/pixel-sprites";

type AgentRecipe = components["schemas"]["AgentRecipeBody"];
type AgentDraft = components["schemas"]["AgentDraftOutputBody"];

const props = defineProps<{
  /** 工坊当前表单；表单为空时传 null */
  current: AgentRecipe | null;
}>();
const emit = defineEmits<{ apply: [draft: AgentDraft] }>();
const open = defineModel<boolean>("open", { default: false });

const api = useApi();
const vocab = useVocabStore();
const { theme } = useTheme();

const GREETING = "晚上好。说说你想喝点什么——基酒、口味、场合都行，我来把配方写出来。";
const EXAMPLES = [
  "适合新手的清爽长饮，不要太烈",
  "用波本做一杯带苦味的经典风格",
  "带咖啡味的餐后甜酒",
  "夏天喝的金酒，加黄瓜和接骨木花",
];

const prompt = ref("");
const busy = ref(false);
const elapsed = ref(0);
const history = ref<string[]>([]);
const reply = ref(GREETING);
const draft = ref<AgentDraft | null>(null);
const onForm = ref(true);

const ir = computed(() => (draft.value?.ir ?? null) as RecipeIR | null);
const glassName = computed(() => {
  const g = ir.value?.glass;
  return vocab.glassware.find((x) => x.id === g)?.nameZh ?? g ?? "";
});
const issues = computed(() => draft.value?.issues ?? []);

/** 这一轮改的是谁：未填入的草稿优先，其次（勾选时）工坊表单 */
const base = computed<AgentRecipe | null>(() => {
  const d = draft.value;
  if (d) {
    return {
      title: d.title,
      subtitle: d.subtitle,
      descriptionMd: d.descriptionMd,
      family: d.family ?? undefined,
      difficulty: d.difficulty,
      tasteProfile: d.tasteProfile,
      tags: d.tags ?? [],
      ir: d.ir,
    };
  }
  return onForm.value ? props.current : null;
});

let tick: ReturnType<typeof setInterval> | undefined;
onBeforeUnmount(() => clearInterval(tick));

async function send(text = prompt.value): Promise<void> {
  const p = text.trim();
  if (!p || busy.value) return;
  busy.value = true;
  elapsed.value = 0;
  tick = setInterval(() => elapsed.value++, 1000);
  history.value.push(p);
  prompt.value = "";
  try {
    const current = base.value ?? undefined;
    const { data, error } = await api.POST("/api/v1/agent/recipe-draft", { body: { prompt: p, current } });
    if (error) {
      reply.value = apiErrorMessage(error);
      toast.error(reply.value);
      return;
    }
    draft.value = data;
    reply.value = data.reply || `给你调了一杯「${data.title}」。`;
  } catch (e) {
    reply.value = apiErrorMessage(e);
    toast.error(reply.value);
  } finally {
    clearInterval(tick);
    busy.value = false;
  }
}

function discard(): void {
  draft.value = null;
  reply.value = "好，这杯倒掉。换个想法？";
}

function apply(): void {
  if (!draft.value) return;
  emit("apply", draft.value);
  draft.value = null;
  history.value = [];
  reply.value = GREETING;
  open.value = false;
}

function amountText(i: RecipeIR["ingredients"][number]): string {
  const unit = UNIT_GROUPS.find((g) => g.value === i.unit)?.label ?? i.unit;
  return "amount" in i ? `${i.amount} ${unit}` : unit;
}
</script>

<template>
  <PxDialog v-model:open="open" title="酒保助手" icon="sparkle" tone="pink" size="lg">
    <div class="flex flex-col gap-5">
      <PxDialogue speaker="酒保 · 摇摇" :text="busy ? '……（摇壶声）' : reply">
        <template #portrait>
          <PxSprite :rows="BARTENDER" :palette="BARTENDER_PALETTE[theme]" :scale="4" />
        </template>
        <template v-if="!draft && !busy && history.length === 0" #choices>
          <PxButton v-for="e in EXAMPLES" :key="e" size="sm" @click="send(e)">{{ e }}</PxButton>
        </template>
      </PxDialogue>

      <ol v-if="history.length" class="flex flex-col gap-1">
        <li v-for="(h, i) in history" :key="i" class="said">
          <span class="font-logo text-[8px] text-faint">YOU</span>
          <span class="min-w-0 flex-1 text-dim">{{ h }}</span>
        </li>
      </ol>

      <div v-if="busy" class="grid place-items-center gap-2 bg-deep py-6 px-ring">
        <PxLoader text="MIXING" />
        <span class="text-faint">正在调配 {{ elapsed }}s · 通常 5–30 秒</span>
      </div>

      <!-- 生成结果：配方卡预览 -->
      <section v-else-if="draft && ir" class="card">
        <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 class="text-lg text-fg text-shadow-px">{{ draft.title }}</h3>
          <span v-if="draft.subtitle" class="text-dim">{{ draft.subtitle }}</span>
        </header>
        <p class="flex flex-wrap items-center gap-2 text-faint">
          <PxBadge tone="cyan">{{ glassName }}</PxBadge>
          <span>{{ ir.steps.length }} 道工序</span>
          <span>难度 {{ draft.difficulty }}/3</span>
        </p>
        <ul class="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <li v-for="i in ir.ingredients" :key="i.slot" class="flex items-baseline gap-2">
            <span class="w-20 shrink-0 text-right text-amber">{{ amountText(i) }}</span>
            <span class="min-w-0 truncate text-fg">{{ vocab.ingMap.get(i.ingredientId)?.nameZh ?? i.ingredientId }}</span>
          </li>
        </ul>
        <ul v-if="issues.length" class="flex flex-col gap-1">
          <li v-for="d in issues" :key="d.code + d.path" class="flex items-start gap-2 text-amber">
            <PxIcon name="warn" :scale="1" class="mt-1 shrink-0" />
            <span>{{ d.message }}<span class="ml-1 text-faint">（填入后可在工坊里修）</span></span>
          </li>
        </ul>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <PxButton variant="primary" icon="check" sfx="start" @click="apply()">填入工坊</PxButton>
          <PxButton icon="x" sfx="cancel" @click="discard()">不要这杯</PxButton>
          <span v-if="current" class="text-faint">填入会覆盖工坊里当前的内容</span>
        </div>
      </section>

      <form class="flex flex-col gap-2" @submit.prevent="send()">
        <PxTextarea
          v-model="prompt"
          :maxlength="2000"
          :disabled="busy"
          :placeholder="draft ? '想怎么改？例：少一点甜，换成黑朗姆' : '例：一杯适合夏天的清爽金酒饮品'"
          @keydown.enter.exact.prevent="send()"
        />
        <div class="flex flex-wrap items-center justify-between gap-2">
          <PxCheckbox v-if="current && !draft" v-model="onForm" :disabled="busy">在工坊当前配方上修改</PxCheckbox>
          <span v-else-if="draft" class="text-faint">继续说会在这杯草稿上修改</span>
          <span v-else class="text-faint">Enter 发送 · Shift+Enter 换行</span>
          <PxButton type="submit" variant="primary" icon="send" :loading="busy" :disabled="!prompt.trim()">
            {{ busy ? "调配中…" : "交给酒保" }}
          </PxButton>
        </div>
      </form>
    </div>
  </PxDialog>
</template>

<style scoped>
.said {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 4px 10px;
  background: var(--panel-lo);
  box-shadow: inset calc(var(--p) * 2) 0 0 0 var(--line);
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: var(--p);
  padding: 14px 16px;
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo), inset calc(var(--p) * 2) 0 0 0 var(--pink);
}
</style>
