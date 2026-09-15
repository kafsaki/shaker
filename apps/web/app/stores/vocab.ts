/**
 * 词表缓存（/vocab 一次全拉 100~200KB，客户端强缓存）。
 * 编辑器的原料选择/校验、动画编译、筛选器全部消费这里。
 */
import { defineStore } from "pinia";
import {
  compileVessel,
  type IngredientMeta,
  type VesselDef,
  type VesselSpec,
} from "@shaker/recipe-ir/core";
import type { VocabLookup } from "@shaker/recipe-ir/core";
import { WORK_VESSELS } from "@shaker/animator-core";
import type { components } from "@shaker/api-client";

type Vocab = components["schemas"]["VocabBody"];
type VocabIngredient = components["schemas"]["IngredientBody"];
type VocabGlass = components["schemas"]["GlassBody"];

const CACHE_KEY = "shaker_vocab_cache";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h（API 侧配 ETag，这里简单按时间）

interface VocabCache {
  savedAt: number;
  vocab: Vocab;
}

export const useVocabStore = defineStore("vocab", () => {
  const ingredients = ref<VocabIngredient[]>([]);
  const glassware = ref<VocabGlass[]>([]);
  const techniques = ref<components["schemas"]["TechniqueBody"][]>([]);
  const tags = ref<components["schemas"]["TagBody"][]>([]);
  const version = ref("");
  const loaded = ref(false);
  const loading = ref<Promise<void> | null>(null);

  const ingMap = computed(
    () => new Map(ingredients.value.map((i) => [i.id, i])),
  );
  const glassMap = computed(() => new Map(glassware.value.map((g) => [g.id, g])));

  function fromCache(): boolean {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const c = JSON.parse(raw) as VocabCache;
      if (!c.vocab || Date.now() - c.savedAt > CACHE_TTL_MS) return false;
      apply(c.vocab);
      return true;
    } catch {
      return false;
    }
  }

  function apply(v: Vocab): void {
    ingredients.value = v.ingredients ?? [];
    glassware.value = v.glassware ?? [];
    techniques.value = v.techniques ?? [];
    tags.value = v.tags ?? [];
    version.value = v.version;
    loaded.value = true;
    const cache: VocabCache = { savedAt: Date.now(), vocab: v };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // 存储满了就算了，内存里还有
    }
  }

  async function ensure(): Promise<void> {
    if (loaded.value) return;
    if (fromCache()) return;
    loading.value ??= (async () => {
      const api = useAuthStore().client;
      const { data, error } = await api.GET("/api/v1/vocab");
      if (error) {
        loading.value = null;
        throw error;
      }
      apply(data);
      loading.value = null;
    })();
    return loading.value;
  }

  /** 编辑器/编译用的 VocabLookup（工作容器由 animator-core 内置兜底）。 */
  function toVocabLookup(): VocabLookup {
    const meta = new Map<string, IngredientMeta>();
    for (const i of ingredients.value) {
      meta.set(i.id, {
        id: i.id,
        nameZh: i.nameZh,
        nameEn: i.nameEn,
        category: i.category,
        abv: i.abv ?? undefined,
        density: i.density ?? undefined,
        viz: i.viz as IngredientMeta["viz"],
      });
    }
    const vessels = new Map<string, VesselSpec>();
    for (const g of glassware.value) {
      const def: VesselDef = {
        id: g.id,
        nameZh: g.nameZh,
        nameEn: g.nameEn,
        capacityMl: g.capacityMl,
        shape: g.shape as VesselDef["shape"],
      };
      vessels.set(g.id, compileVessel(def));
    }
    return {
      ingredient: (id) => meta.get(id),
      vessel: (id) => vessels.get(id) ?? WORK_VESSELS.get(id),
    };
  }

  return {
    ingredients,
    glassware,
    techniques,
    tags,
    version,
    loaded,
    ensure,
    ingMap,
    glassMap,
    toVocabLookup,
  };
});
