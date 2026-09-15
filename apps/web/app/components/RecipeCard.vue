<script setup lang="ts">
import { Heart, Martini, MessageCircle } from "lucide-vue-next";
import type { components } from "@shaker/api-client";
import { FAMILY_ZH } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";

type Recipe = components["schemas"]["FeedCard"];

defineProps<{ recipe: Recipe }>();
</script>

<template>
  <NuxtLink
    :to="`/r/${recipe.slug}`"
    class="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
  >
    <div
      class="relative aspect-[4/3] overflow-hidden bg-gradient-to-b from-secondary to-background"
    >
      <img
        v-if="recipe.coverUrl"
        :src="recipe.coverUrl"
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
    </div>

    <div class="flex flex-1 flex-col gap-1.5 p-3">
      <div class="truncate font-medium">{{ recipe.title }}</div>
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-xs text-muted-foreground">
          {{ recipe.author.displayName }}
        </span>
        <span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span class="flex items-center gap-0.5">
            <Heart class="size-3" />{{ recipe.counts.like }}
          </span>
          <span class="flex items-center gap-0.5">
            <MessageCircle class="size-3" />{{ recipe.counts.comment }}
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
