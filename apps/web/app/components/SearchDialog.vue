<script setup lang="ts">
/** 全局搜索窗（HUD 搜索键、/、Ctrl+K）：选范围 + 输关键词，回车进搜索结果页。 */
const open = defineModel<boolean>("open", { default: false });
const router = useRouter();
const q = ref("");
const scope = ref("recipe");
const input = ref<{ focus: () => void } | null>(null);

const SCOPES = [
  { value: "recipe", label: "配方", icon: "martini" as const },
  { value: "ingredient", label: "原料", icon: "bottle" as const },
  { value: "menu", label: "酒单", icon: "list" as const },
  { value: "user", label: "用户", icon: "user" as const },
];

watch(open, (o) => {
  if (o) setTimeout(() => input.value?.focus(), 30);
});

function submit(): void {
  const kw = q.value.trim();
  open.value = false;
  void router.push({
    path: "/search",
    query: { ...(kw ? { q: kw } : {}), ...(scope.value !== "recipe" ? { type: scope.value } : {}) },
  });
}

const HINTS = ["Daiquiri", "朗姆", "柑橘", "Negroni", "金酒"];
</script>

<template>
  <PxDialog v-model:open="open" title="搜索终端" icon="search" tone="cyan">
    <form class="flex flex-col gap-4" @submit.prevent="submit()">
      <PxSegmented v-model="scope" :items="SCOPES" size="sm" />
      <PxInput ref="input" v-model="q" icon="search" size="lg" placeholder="输入关键词，回车搜索（留空 = 浏览全部）" />
      <div class="flex flex-wrap items-center gap-1 text-faint">
        <span>试试：</span>
        <button
          v-for="h in HINTS"
          :key="h"
          type="button"
          class="hover:text-amber"
          @click="q = h; submit()"
        >
          <PxBadge>{{ h }}</PxBadge>
        </button>
      </div>
      <div class="flex items-center justify-between text-faint">
        <span class="flex items-center gap-1"><PxKbd>ENTER</PxKbd> 搜索 <PxKbd>ESC</PxKbd> 关闭</span>
        <PxButton type="submit" variant="primary" icon="search" sfx="confirm">搜索</PxButton>
      </div>
    </form>
  </PxDialog>
</template>
