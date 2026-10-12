<script setup lang="ts">
/**
 * 修订历史（ADR-027）：经典配方或原料词条的每一版，像存档列表一样从新到旧排开。
 * 每版和上一版逐字段对比；配方的原料与步骤改动按需拉两版 IR 再比。
 * 编辑可「以此版为底稿」回到编辑器——回退就是一次普通的新修订，历史不会被抹掉。
 */
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import type { RecipeIR } from "@shaker/recipe-ir";
import { fmtTime, ingredientDiff, irDiff, recipeMetaDiff, type FieldDiff, type IRDiff } from "@/lib/wiki";

type RecipeRevision = components["schemas"]["RevisionBody"];
type IngredientRevision = components["schemas"]["IngredientRevisionBody"];

const route = useRoute();
const api = useApi();
const qc = useQueryClient();
const auth = useAuthStore();
const vocab = useVocabStore();

const kind = computed(() => (route.params.kind === "ingredient" ? "ingredient" : "recipe"));
const id = computed(() => String(route.params.id ?? ""));

/** 条目本体：拿标题与回链。 */
const { data: target } = useQuery({
  queryKey: computed(() => ["wiki-target", kind.value, id.value] as const),
  queryFn: async (): Promise<{ title: string; sub: string; to: string; version: number }> => {
    if (kind.value === "ingredient") {
      const { data, error } = await api.GET("/api/v1/ingredients/{id}", { params: { path: { id: id.value } } });
      if (error) throw error;
      return { title: data.nameZh, sub: data.nameEn, to: `/ingredients/${data.id}`, version: data.wikiVersion };
    }
    const { data, error } = await api.GET("/api/v1/recipes/{id}", { params: { path: { id: id.value } } });
    if (error) throw error;
    const to = data.isCanonical && data.classicKey ? `/classics/${data.classicKey}` : `/recipes/${data.id}`;
    return { title: data.title, sub: data.subtitle ?? "", to, version: data.irVersion };
  },
});

useHead(() => ({ title: `修订历史 · ${target.value?.title ?? ""} · Shaker` }));

/** 统一成一种行：版本、摘要、编辑者、时间 + 与上一版的字段差异。 */
interface Row {
  version: number;
  note: string | null;
  editorHandle: string | null;
  editorName: string | null;
  createdAt: string;
  diff: FieldDiff[];
  /** 配方的 meta 缺失（ADR-027 之前写入），对比不完整。 */
  partial: boolean;
}

const { data: rows, error, isLoading } = useQuery({
  queryKey: computed(() => [kind.value === "ingredient" ? "ingredient-revisions" : "recipe-revisions", id.value] as const),
  queryFn: async (): Promise<Row[]> => {
    if (kind.value === "ingredient") {
      const { data, error } = await api.GET("/api/v1/ingredients/{id}/revisions", { params: { path: { id: id.value } } });
      if (error) throw error;
      const items: IngredientRevision[] = data.items ?? [];
      return items.map((r, i) => {
        const prev = items[i + 1];
        return {
          version: r.version,
          note: r.note,
          editorHandle: r.editorHandle,
          editorName: r.editorName,
          createdAt: r.createdAt,
          // 最早一版是底稿，没有可比的上一版
          diff: prev ? ingredientDiff(prev.snapshot, r.snapshot) : [],
          partial: false,
        };
      });
    }
    const { data, error } = await api.GET("/api/v1/recipes/{id}/revisions", { params: { path: { id: id.value } } });
    if (error) throw error;
    const items: RecipeRevision[] = data.items ?? [];
    return items.map((r, i) => {
      const prev = items[i + 1] ?? null;
      return {
        version: r.version,
        note: r.note,
        editorHandle: r.editorHandle,
        editorName: r.editorName,
        createdAt: r.createdAt,
        diff: prev ? recipeMetaDiff(prev, r) : [],
        partial: prev !== null && (!r.meta || !prev.meta),
      };
    });
  },
});

/* ── 配方 IR 对比：展开时才拉两版 IR ── */
const open = ref<number | null>(null);
const irDiffs = reactive(new Map<number, IRDiff | "loading" | "error">());

function fetchIR(version: number): Promise<RecipeIR> {
  return qc.fetchQuery({
    queryKey: ["recipe-revision", id.value, version],
    staleTime: Infinity, // 历史版本不可变
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/recipes/{id}/revisions/{version}", {
        params: { path: { id: id.value, version } },
      });
      if (error) throw error;
      return data.ir as RecipeIR;
    },
  });
}

async function toggle(row: Row, index: number): Promise<void> {
  open.value = open.value === row.version ? null : row.version;
  const prevVersion = rows.value?.[index + 1]?.version;
  if (kind.value !== "recipe" || open.value === null || prevVersion === undefined || irDiffs.has(row.version)) return;
  irDiffs.set(row.version, "loading");
  try {
    await vocab.ensure();
    const [cur, prev] = await Promise.all([fetchIR(row.version), fetchIR(prevVersion)]);
    irDiffs.set(
      row.version,
      irDiff(prev, cur, (i) => vocab.ingMap.get(i)?.nameZh, (g) => vocab.glassware.find((x) => x.id === g)?.nameZh),
    );
  } catch {
    irDiffs.set(row.version, "error");
  }
}

function irOf(version: number): IRDiff | null {
  const d = irDiffs.get(version);
  return typeof d === "object" ? d : null;
}

/** 元数据和 IR 都没变（比如只是重新保存了一次）。 */
function unchanged(r: Row): boolean {
  const d = irOf(r.version);
  return !!d && !r.diff.length && !d.meta.length && !d.added.length && !d.removed.length && !d.stepsChanged;
}

function baseOn(version: number): string {
  return kind.value === "ingredient"
    ? `/wiki/ingredients/${id.value}?from=${version}`
    : `/editor/${id.value}?from=${version}`;
}

/** 配方 v1 是种子导入；原料 v0 是种子原文。 */
const firstVersion = computed(() => (kind.value === "ingredient" ? 0 : 1));
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-4">
    <NuxtLink v-if="target" :to="target.to" class="flex w-fit items-center gap-1 text-dim hover:text-amber">
      <PxIcon name="chevron-left" :scale="1" />回{{ kind === "ingredient" ? "物品详情" : "配方" }}
    </NuxtLink>

    <PxPanel :title="target ? `修订历史 · ${target.title}` : '修订历史'" icon="clock" tone="amber" :padded="false">
      <template #actions>
        <PxButton size="sm" variant="ghost" icon="book" to="/wiki">编辑部</PxButton>
      </template>

      <div v-if="isLoading" class="flex flex-col gap-2 p-3">
        <PxSkeleton v-for="i in 4" :key="i" class="h-16" />
      </div>

      <PxEmpty v-else-if="error" icon="warn" tone="red" :title="apiErrorMessage(error)" />

      <PxEmpty v-else-if="!rows?.length" icon="clock" title="这个条目还没有人修订过。">
        <PxButton v-if="auth.isEditor" icon="pencil" :to="kind === 'ingredient' ? `/wiki/ingredients/${id}` : `/editor/${id}`">
          做第一次修订
        </PxButton>
      </PxEmpty>

      <ol v-else class="flex flex-col gap-2 p-3">
        <li v-for="(r, i) in rows" :key="r.version" class="save" :class="{ current: i === 0 }">
          <button type="button" class="head" :aria-expanded="open === r.version" @click="toggle(r, i)">
            <span class="ver">
              <span class="font-logo text-[8px] text-faint">VER</span>
              <span class="font-logo text-[14px]" :class="i === 0 ? 'text-amber' : 'text-fg'">{{ r.version }}</span>
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex flex-wrap items-center gap-2">
                <span class="truncate text-fg">{{ r.note || (r.version === firstVersion ? "种子原文" : "（未写摘要）") }}</span>
                <PxBadge v-if="i === 0" tone="amber" variant="solid">当前</PxBadge>
                <PxBadge v-if="r.diff.length" tone="cyan">{{ r.diff.length }} 处改动</PxBadge>
              </span>
              <span class="text-faint">
                {{ r.editorName || r.editorHandle || "系统" }}
                · <span class="font-logo text-[8px]">{{ fmtTime(r.createdAt) }}</span>
              </span>
            </span>
            <PxIcon :name="open === r.version ? 'chevron-up' : 'chevron-down'" :scale="2" class="text-dim" />
          </button>

          <div v-if="open === r.version" class="body">
            <p v-if="r.editorHandle" class="text-faint">
              修订人
              <NuxtLink :to="`/u/${r.editorHandle}`" class="text-dim hover:text-amber">@{{ r.editorHandle }}</NuxtLink>
            </p>
            <p v-if="i === rows!.length - 1" class="text-faint">
              {{ r.version === firstVersion ? "首次修订前的种子原文，留作回退的底稿。" : "现存最早的一版，留作回退的底稿。" }}
            </p>
            <p v-else-if="r.diff.length === 0 && kind === 'ingredient'" class="text-faint">文字没有变化。</p>
            <p v-if="r.partial" class="flex items-center gap-1 text-faint">
              <PxIcon name="info" :scale="1" />早期版本没有记录简介等元数据，只能对比配方内容。
            </p>

            <dl v-if="r.diff.length" class="flex flex-col gap-3">
              <div v-for="d in r.diff" :key="d.label" class="field">
                <dt class="text-dim">{{ d.label }}</dt>
                <dd v-if="d.long" class="grid gap-2 sm:grid-cols-2">
                  <p class="old whitespace-pre-wrap">{{ d.before || "（空）" }}</p>
                  <p class="new whitespace-pre-wrap">{{ d.after || "（空）" }}</p>
                </dd>
                <dd v-else class="flex flex-wrap items-center gap-2">
                  <span class="old">{{ d.before || "（空）" }}</span>
                  <PxIcon name="chevron-right" :scale="1" class="text-faint" />
                  <span class="new">{{ d.after || "（空）" }}</span>
                </dd>
              </div>
            </dl>

            <!-- 配方内容（IR）对比 -->
            <template v-if="kind === 'recipe'">
              <PxSkeleton v-if="irDiffs.get(r.version) === 'loading'" class="h-12" />
              <p v-else-if="irDiffs.get(r.version) === 'error'" class="text-red">配方内容读取失败</p>
              <template v-else-if="irOf(r.version)">
                <dl class="flex flex-col gap-3">
                  <div v-for="d in irOf(r.version)!.meta" :key="d.label" class="field">
                    <dt class="text-dim">{{ d.label }}</dt>
                    <dd class="flex flex-wrap items-center gap-2">
                      <span class="old">{{ d.before || "（空）" }}</span>
                      <PxIcon name="chevron-right" :scale="1" class="text-faint" />
                      <span class="new">{{ d.after }}</span>
                    </dd>
                  </div>
                  <div v-if="irOf(r.version)!.added.length || irOf(r.version)!.removed.length" class="field">
                    <dt class="text-dim">原料</dt>
                    <dd class="flex flex-col gap-1">
                      <span v-for="l in irOf(r.version)!.removed" :key="'-' + l" class="old">− {{ l }}</span>
                      <span v-for="l in irOf(r.version)!.added" :key="'+' + l" class="new">＋ {{ l }}</span>
                    </dd>
                  </div>
                  <p v-if="irOf(r.version)!.stepsChanged" class="flex items-center gap-1 text-cyan">
                    <PxIcon name="list" :scale="1" />调制步骤有改动
                  </p>
                  <p v-if="unchanged(r)" class="text-faint">
                    这一版没有内容变化。
                  </p>
                </dl>
              </template>
            </template>

            <div v-if="auth.isEditor && i > 0" class="flex justify-end border-t-2 border-dashed border-line pt-3">
              <PxButton size="sm" icon="replay" :to="baseOn(r.version)">以此版为底稿编辑</PxButton>
            </div>
          </div>
        </li>
      </ol>
    </PxPanel>
  </div>
</template>

<style scoped>
.save {
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--hi);
  margin: var(--p);
}
.save.current {
  box-shadow: 0 0 0 var(--p) var(--amber), inset var(--p) var(--p) 0 0 var(--hi);
}
.head {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  text-align: left;
}
.head:hover {
  background: var(--panel);
}
.ver {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 40px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-top: var(--p) dashed var(--line);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.old,
.new {
  padding: 2px 6px;
  overflow-wrap: anywhere;
}
.old {
  color: var(--dim);
  background: color-mix(in srgb, var(--red) 14%, transparent);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--red) 60%, transparent);
}
p.old {
  text-decoration: none;
}
.new {
  color: var(--fg);
  background: color-mix(in srgb, var(--green) 16%, transparent);
}
</style>
