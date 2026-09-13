/**
 * 自动生成步骤文案（规范 §8）。
 *
 * 需求 2 要求"提供文字说明"。既然 IR 是结构化的，文案就该模板生成 ——
 * 作者只在需要时覆写 `step.text`。中英双套模板（ADR-011）。
 */
import type { IngredientRef, Step } from "@shaker/recipe-ir/core";
import type { ResolvedVocab } from "./types.ts";

export type Lang = "zh" | "en";

const CONTAINER: Record<Lang, Record<string, string>> = {
  zh: {
    shaker: "摇酒壶",
    mixing_glass: "搅拌杯",
    glass: "杯中",
    blender: "搅拌机",
    secondary: "第二个容器",
  },
  en: {
    shaker: "the shaker",
    mixing_glass: "the mixing glass",
    glass: "the glass",
    blender: "the blender",
    secondary: "the second vessel",
  },
};

const SHAKE_INTENSITY: Record<Lang, Record<string, string>> = {
  zh: { gentle: "轻轻", standard: "充分", hard: "用力" },
  en: { gentle: "gently", standard: "well", hard: "hard" },
};

const MUDDLE_INTENSITY: Record<Lang, Record<string, string>> = {
  zh: { gentle: "轻", firm: "用力" },
  en: { gentle: "gently", firm: "firmly" },
};

const STRAINER: Record<Lang, Record<string, string>> = {
  zh: { hawthorne: "霍桑滤网", julep: "茱莉普滤网", fine: "细滤网", none: "直接" },
  en: { hawthorne: "a Hawthorne strainer", julep: "a julep strainer", fine: "a fine strainer", none: "" },
};

const GARNISH_POSITION: Record<Lang, Record<string, string>> = {
  zh: { rim: "挂于杯口", in_glass: "投入杯中", float: "漂浮于液面", skewer: "串于签上", side: "置于杯旁" },
  en: { rim: "on the rim", in_glass: "in the glass", float: "floating", skewer: "on a pick", side: "alongside" },
};

const WAIT_REASON: Record<Lang, Record<string, string>> = {
  zh: { settle: "分层稳定", bloom: "泡沫成型", infuse: "风味融合" },
  en: { settle: "the layers to settle", bloom: "the foam to bloom", infuse: "the flavours to marry" },
};

const CHILL_METHOD: Record<Lang, Record<string, string>> = {
  zh: { ice_water: "冰水", freezer: "冷冻" },
  en: { ice_water: "ice water", freezer: "the freezer" },
};

const SMOKE_METHOD: Record<Lang, Record<string, string>> = {
  zh: { smoking_gun: "烟枪", torched_wood: "烧木板", dry_ice: "干冰" },
  en: { smoking_gun: "a smoking gun", torched_wood: "torched wood", dry_ice: "dry ice" },
};

const BLEND_SPEED: Record<Lang, Record<string, string>> = {
  zh: { low: "低", high: "高" },
  en: { low: "low", high: "high" },
};

function nameOf(id: string, vocab: ResolvedVocab, lang: Lang): string {
  const meta = vocab.ingredient(id) as { nameZh?: string; nameEn?: string } | undefined;
  if (!meta) return id;
  return (lang === "zh" ? meta.nameZh : meta.nameEn) ?? id;
}

function listNames(
  slots: readonly string[],
  bySlot: Map<string, IngredientRef>,
  vocab: ResolvedVocab,
  lang: Lang,
): string {
  const names = slots
    .map((s) => bySlot.get(s))
    .filter((r): r is IngredientRef => r !== undefined)
    .map((r) => nameOf(r.ingredientId, vocab, lang));
  if (names.length === 0) return lang === "zh" ? "原料" : "the ingredients";
  if (lang === "zh") return names.join("、");
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** 把 0..1 的填充率说成「几分满」。 */
function fillWords(fill: number, lang: Lang): string {
  const tenths = Math.round(fill * 10);
  if (lang === "zh") {
    if (tenths >= 10) return "满";
    return `约${tenths}分满`;
  }
  if (tenths >= 10) return "full";
  return `about ${tenths}0% full`;
}

const ICE_NAME: Record<Lang, Record<string, string>> = {
  zh: {
    cube: "方冰",
    large_cube: "大方冰",
    sphere: "球冰",
    cracked: "裂冰",
    crushed: "碎冰",
    block: "冰柱",
    dry_ice: "干冰",
  },
  en: {
    cube: "ice cubes",
    large_cube: "a large cube",
    sphere: "an ice sphere",
    cracked: "cracked ice",
    crushed: "crushed ice",
    block: "an ice spear",
    dry_ice: "dry ice",
  },
};

/**
 * 生成一个步骤的双语文案。
 * 作者覆写优先；覆写只提供一种语言时，另一种仍用模板生成。
 */
export function stepLabel(
  step: Step,
  bySlot: Map<string, IngredientRef>,
  vocab: ResolvedVocab,
): { zh: string; en: string } {
  return {
    zh: step.text?.zh ?? render(step, bySlot, vocab, "zh"),
    en: step.text?.en ?? render(step, bySlot, vocab, "en"),
  };
}

function render(s: Step, bySlot: Map<string, IngredientRef>, vocab: ResolvedVocab, l: Lang): string {
  const zh = l === "zh";
  const C = CONTAINER[l];
  const items = (slots: readonly string[]) => listNames(slots, bySlot, vocab, l);

  switch (s.action) {
    case "CHILL":
      return zh
        ? `用${CHILL_METHOD.zh[s.method ?? "ice_water"]}冰杯`
        : `Chill the glass with ${CHILL_METHOD.en[s.method ?? "ice_water"]}`;

    case "RIM": {
      const mat = items([s.material]);
      const cov = s.coverage === "half" ? (zh ? "半圈" : "half the rim") : zh ? "整圈" : "the rim";
      return zh ? `用${mat}做${cov}杯口` : `Rim ${cov} with ${mat}`;
    }

    case "RINSE":
      return zh
        ? `用${items(s.items)}涮杯${s.discard ? "，倒掉多余" : ""}`
        : `Rinse the glass with ${items(s.items)}${s.discard ? ", discard the excess" : ""}`;

    case "ADD":
      return zh
        ? `将${items(s.items)}倒入${C[s.target]}`
        : `Add ${items(s.items)} to ${C[s.target]}`;

    case "ICE":
      return zh
        ? `向${C[s.target]}加入${ICE_NAME.zh[s.iceType]}至${fillWords(s.fill, "zh")}`
        : `Fill ${C[s.target]} ${fillWords(s.fill, "en")} with ${ICE_NAME.en[s.iceType]}`;

    case "MUDDLE": {
      const inten = MUDDLE_INTENSITY[l][s.intensity ?? "gentle"]!;
      const what = s.intensity === "firm" ? (zh ? "汁液" : "the juices") : zh ? "香气" : "the aromas";
      return zh
        ? `用捣棒${inten}压${items(s.items)}，释出${what}`
        : `Muddle ${items(s.items)} ${inten} to release ${what}`;
    }

    case "SHAKE": {
      const inten = SHAKE_INTENSITY[l][s.intensity ?? "standard"]!;
      const secs = s.durationSec ?? 12;
      if (s.dryShake) {
        return zh ? `不加冰${inten}干摇约 ${secs} 秒` : `Dry shake ${inten} for about ${secs}s, no ice`;
      }
      return zh ? `加盖${inten}摇晃约 ${secs} 秒` : `Shake ${inten} for about ${secs}s`;
    }

    case "STIR":
      return zh
        ? `用吧勺搅拌约 ${s.durationSec ?? 30} 秒至充分冷却`
        : `Stir for about ${s.durationSec ?? 30}s until well chilled`;

    case "SWIZZLE":
      return zh
        ? `插入搅棒快速旋转 ${s.durationSec ?? 8} 秒，直至杯壁结霜`
        : `Swizzle for ${s.durationSec ?? 8}s until the glass frosts over`;

    case "ROLL":
      return zh
        ? `在两容器间来回倾倒 ${s.times} 次`
        : `Roll back and forth between vessels ${s.times} times`;

    case "THROW":
      return zh
        ? `从${s.height === "low" ? "低" : "高"}处抛接 ${s.times} 次`
        : `Throw ${s.times} times from a ${s.height ?? "high"} arc`;

    case "BLEND":
      return zh
        ? `以${BLEND_SPEED.zh[s.speed ?? "high"]}速搅打 ${s.durationSec ?? 20} 秒至雪泥质地`
        : `Blend on ${BLEND_SPEED.en[s.speed ?? "high"]} for ${s.durationSec ?? 20}s until slushy`;

    case "STRAIN": {
      const st = s.strainer ?? "hawthorne";
      if (zh) {
        return `经${STRAINER.zh[st]}${s.double ? "双重" : ""}滤入${C[s.to]}`;
      }
      const via = st === "none" ? "" : ` through ${STRAINER.en[st]}`;
      return `${s.double ? "Double-strain" : "Strain"}${via} into ${C[s.to]}`;
    }

    case "DUMP":
      return zh ? `连冰带液整杯倒入${C[s.to]}` : `Dump everything, ice included, into ${C[s.to]}`;

    case "TOP_UP":
      return zh ? `用${items(s.items)}补满` : `Top up with ${items(s.items)}`;

    case "FLOAT":
      return zh
        ? `沿吧勺背面缓慢浮入${items(s.items)}，形成分层`
        : `Float ${items(s.items)} over the back of a barspoon to layer`;

    case "GARNISH": {
      const what = s.garnishId ? nameOf(s.garnishId, vocab, l) : items(s.items ?? []);
      const pos = GARNISH_POSITION[l][s.position]!;
      const expressed =
        s.prep === "expressed" ? (zh ? "，先挤出皮油" : ", expressing the oils first") : "";
      const slapped = s.prep === "slapped" ? (zh ? "，先在掌心拍打" : ", slapped to wake it up") : "";
      return zh
        ? `以${what}${pos}装饰${expressed}${slapped}`
        : `Garnish with ${what} ${pos}${expressed}${slapped}`;
    }

    case "SPRITZ":
      return zh
        ? `在液面上方喷 ${s.sprays ?? 1} 下${items(s.items)}`
        : `Spritz ${items(s.items)} ${s.sprays ?? 1}× over the surface`;

    case "FLAME": {
      const subj =
        s.subject === "surface"
          ? zh
            ? "液面"
            : "the surface"
          : s.subject === "peel_oil"
            ? zh
              ? "皮油"
              : "the citrus oils"
            : zh
              ? "装饰物"
              : "the garnish";
      return zh ? `点燃${subj}` : `Flame ${subj}`;
    }

    case "SMOKE":
      return zh
        ? `用${SMOKE_METHOD.zh[s.method ?? "smoking_gun"]}烟熏${s.cover ? "并加盖聚烟" : ""}`
        : `Smoke with ${SMOKE_METHOD.en[s.method ?? "smoking_gun"]}${s.cover ? ", covered to trap it" : ""}`;

    case "WAIT":
      return zh
        ? `静置 ${s.durationSec} 秒，待${WAIT_REASON.zh[s.reason ?? "settle"]}`
        : `Rest ${s.durationSec}s for ${WAIT_REASON.en[s.reason ?? "settle"]}`;
  }
}
