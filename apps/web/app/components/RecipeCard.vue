<script setup lang="ts">
import { Heart, Martini, MessageCircle } from "lucide-vue-next";
import { FAMILY_ZH } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";

// 放宽为最小结构：FeedCard 可直接赋值，酒单卡片（MenuRecipeCardBody）也能传。
// 互动数两种来源：feed 用 counts，酒单卡片用扁平的 likeCount/commentCount。
interface RecipeCardData {
  code: string;
  title: string;
  coverUrl?: string | null;
  coverUrlLight?: string | null;
  family?: string | null;
  isCanonical?: boolean;
  author?: { displayName: string } | null;
  counts?: { like: number; comment: number } | null;
  likeCount?: number;
  commentCount?: number;
  collapsedVariants?: { count: number } | null;
}

// to：覆盖默认的 /r/:code 跳转（经典列表要进 /classics/:key，
// 而不是再嵌一层 <a> —— 嵌套链接内层优先生效，外层会被吃掉）
// disabled：配方已删/编辑态——灰显且不可点（pointer-events-none 使其彻底失效）
const props = defineProps<{
  recipe: RecipeCardData;
  to?: string;
  disabled?: boolean;
}>();
const target = computed(() => props.to ?? `/r/${props.recipe.code}`);
const like = computed(() => props.recipe.counts?.like ?? props.recipe.likeCount ?? 0);
const comment = computed(() => props.recipe.counts?.comment ?? props.recipe.commentCount ?? 0);
const { pickCover } = useCover();
const cover = computed(() => pickCover(props.recipe.coverUrl, props.recipe.coverUrlLight));
</script>

<template>
  <NuxtLink
    :to="target"
    class="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors"
    :class="disabled ? 'pointer-events-none opacity-60' : 'hover:border-primary/40'"
  >
    <div
      class="relative aspect-[400/520] overflow-hidden bg-gradient-to-b from-secondary to-background"
    >
      <img
        v-if="cover"
        :src="cover"
        :alt="recipe.title"
        class="size-full object-cover transition-transform group-hover:scale-105"
        loading="lazy"
      />
      <div v-else class="flex size-full items-center justify-center">
        <Martini class="size-12 text-muted-foreground/40" />
      </div>
      <Badge
        v-if="recipe.family && FAMILY_ZH[recipe.family]"
        variant="secondary"
        class="absolute left-2 top-2"
      >
        {{ FAMILY_ZH[recipe.family] }}
      </Badge>
      <Badge
        v-if="recipe.isCanonical"
        class="absolute right-2 top-2 border-primary/40 bg-primary/10 text-primary"
      >
        权威
      </Badge>
      <Badge
        v-if="disabled"
        variant="outline"
        class="absolute bottom-2 left-2 bg-background/80 text-[11px]"
      >
        配方已删除
      </Badge>
    </div>

    <div class="flex flex-1 flex-col gap-1.5 p-3">
      <div class="truncate font-medium" :class="disabled && 'line-through'">
        {{ recipe.title }}
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-xs text-muted-foreground">
          {{ recipe.author?.displayName }}
        </span>
        <span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span class="flex items-center gap-0.5">
            <Heart class="size-3" />{{ like }}
          </span>
          <span class="flex items-center gap-0.5">
            <MessageCircle class="size-3" />{{ comment }}
          </span>
        </span>
      </div>
      <p
        v-if="recipe.collapsedVariants"
        class="text-xs text-muted-foreground/80"
      >
        另有 {{ recipe.collapsedVariants.count }} 个变体已折叠
      </p>
    </div>
  </NuxtLink>
</template>