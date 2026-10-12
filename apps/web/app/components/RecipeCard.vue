<script setup lang="ts">
/**
 * 收藏卡：外框颜色 = 稀有度（权威金 / 原创青 / 变体绿），卡面是动画定格封面，
 * 底栏是互动计数。悬浮时卡片抬起、名字前出现 ▶ 光标；传奇卡有周期扫光。
 *
 * 数据放宽为最小结构：FeedCard 可直接赋值，酒单卡片（MenuRecipeCardBody）也能传。
 * 互动数两种来源：feed 用 counts，酒单卡片用扁平的 likeCount/commentCount/collectCount。
 */
import { FAMILY_ZH } from "@/lib/labels";
import { compact, rarityOf } from "@/lib/game";

interface RecipeCardData {
  code: string;
  classicKey?: string | null;
  title: string;
  coverUrl?: string | null;
  coverUrlLight?: string | null;
  family?: string | null;
  isCanonical?: boolean;
  source?: string | null;
  abvEst?: number | null;
  difficulty?: number | null;
  author?: { displayName: string } | null;
  counts?: { like: number; comment: number; collect?: number } | null;
  likeCount?: number;
  commentCount?: number;
  collectCount?: number;
  collapsedVariants?: { count: number } | null;
}

// to：覆盖默认跳转；默认经典走 /classics/:key（唯一地址），其余走 /r/:code
// disabled：配方已删——灰显、盖「已删除」戳且不可点
// slim：窄卡（横向滚动列表里），隐藏作者行
const props = defineProps<{ recipe: RecipeCardData; to?: string; disabled?: boolean; slim?: boolean }>();

const target = computed(() => {
  if (props.to) return props.to;
  if (props.recipe.isCanonical && props.recipe.classicKey) return `/classics/${props.recipe.classicKey}`;
  return `/r/${props.recipe.code}`;
});
const like = computed(() => props.recipe.counts?.like ?? props.recipe.likeCount ?? 0);
const comment = computed(() => props.recipe.counts?.comment ?? props.recipe.commentCount ?? 0);
const collect = computed(() => props.recipe.counts?.collect ?? props.recipe.collectCount ?? 0);
const rarity = computed(() => rarityOf(props.recipe));
const { play } = useSfx();
</script>

<template>
  <NuxtLink
    :to="target"
    draggable="false"
    class="card"
    :class="[`r-${rarity.key}`, { off: disabled, slim }]"
    @click="play('click')"
  >
    <div class="art">
      <PxCover :dark="recipe.coverUrl" :light="recipe.coverUrlLight" :alt="recipe.title" class="size-full" />
      <span v-if="rarity.key === 'legend'" class="shine" aria-hidden="true" />
      <span class="tag" :title="rarity.label">
        <PxIcon :name="rarity.icon" :scale="1" />
        <span v-if="!slim">{{ rarity.label }}</span>
      </span>
      <span v-if="recipe.family && FAMILY_ZH[recipe.family] && !slim" class="family">{{ FAMILY_ZH[recipe.family] }}</span>
      <span v-if="recipe.abvEst != null && !slim" class="abv font-logo">{{ recipe.abvEst.toFixed(0) }}%</span>
      <span v-if="disabled" class="stamp">已删除</span>
    </div>

    <div class="info">
      <p class="name" :class="disabled && 'line-through'">
        <span class="cur" aria-hidden="true">▶</span>{{ recipe.title }}
      </p>
      <p v-if="!slim" class="meta">
        <span class="truncate">{{ recipe.author?.displayName ?? "—" }}</span>
        <PxStars v-if="recipe.difficulty" :model-value="recipe.difficulty" :max="recipe.difficulty" readonly class="shrink-0" />
      </p>
    </div>

    <div class="stats">
      <span title="点赞"><PxIcon name="heart" :scale="1" class="text-pink" />{{ compact(like) }}</span>
      <span title="收藏"><PxIcon name="bookmark" :scale="1" class="text-amber" />{{ compact(collect) }}</span>
      <span title="评论"><PxIcon name="comment" :scale="1" class="text-cyan" />{{ compact(comment) }}</span>
    </div>
    <p v-if="recipe.collapsedVariants" class="variants">+{{ recipe.collapsedVariants.count }} 个变体已折叠</p>
  </NuxtLink>
</template>

<style scoped>
.card {
  --edge: var(--line);
  position: relative;
  display: flex;
  flex-direction: column;
  margin: calc(var(--p) * 2);
  padding: 6px;
  background: var(--panel);
  box-shadow:
    0 0 0 var(--p) var(--edge),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 3) calc(var(--p) * 3) 0 calc(var(--p) * 2) var(--shadow);
}
.r-legend { --edge: var(--gold); }
.r-rare { --edge: var(--cyan); }
.r-uncommon { --edge: var(--green); }
.card:hover,
.card:focus-visible {
  transform: translate(calc(var(--p) * -1), calc(var(--p) * -2));
  box-shadow:
    0 0 0 var(--p) var(--amber),
    0 0 0 calc(var(--p) * 2) var(--ink),
    inset var(--p) var(--p) 0 0 var(--hi),
    calc(var(--p) * 5) calc(var(--p) * 6) 0 calc(var(--p) * 2) var(--shadow);
  outline: none;
}
.card:active { transform: none; }
.off { pointer-events: none; filter: grayscale(1); opacity: 0.6; }

.art {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.art :deep(img) { object-position: 50% 100%; }
.card:hover .art :deep(img) { transform: scale(1.04); transform-origin: 50% 100%; }

.tag,
.family,
.abv {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 5px;
  font-size: 12px;
  line-height: 1;
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.tag { top: 6px; right: 6px; background: var(--edge); color: var(--on-accent); }
.r-common .tag { background: var(--panel-hi); color: var(--dim); }
.family { top: 6px; left: 6px; background: var(--panel); color: var(--fg); }
.abv { bottom: 6px; right: 6px; background: var(--ink); color: var(--amber-hi); font-size: 8px; }

.shine {
  position: absolute;
  inset: 0 auto 0 0;
  width: 18%;
  background: linear-gradient(90deg, transparent, rgb(255 240 200 / 0.14), transparent);
  animation: px-shine 4s steps(20) infinite;
  pointer-events: none;
}
.stamp {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  rotate: -12deg;
  padding: 4px 10px;
  border: 2px solid var(--red);
  color: var(--red);
  background: var(--panel);
  font-size: 12px;
}

.info { padding: 8px 2px 4px; min-width: 0; }
.name {
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--fg);
}
.name .cur { width: 0; overflow: hidden; color: var(--amber); font-size: 10px; flex-shrink: 0; }
.card:hover .name .cur { width: 14px; animation: px-blink 0.8s steps(1) infinite; }
.card:hover .name { color: var(--amber); }
.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: var(--faint);
}
.stats {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  margin-top: 4px;
  padding: 4px 6px;
  background: var(--panel-lo);
  color: var(--dim);
  box-shadow: inset var(--p) var(--p) 0 0 var(--lo);
}
.stats span { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-logo); font-size: 8px; }
.variants { margin-top: 4px; color: var(--faint); text-align: center; }
.slim { padding: 4px; }
.slim .info { padding: 6px 0 2px; }
</style>
