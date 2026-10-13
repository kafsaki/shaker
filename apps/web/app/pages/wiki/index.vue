<script setup lang="ts">
/**
 * 编辑部（ADR-027）：百科的公告栏。
 * 左：最近修订动态（经典配方 + 原料词条混排）；右：编辑名册，管理员在这里任免编辑。
 * 不懂代码也能维护——词条页上的「编辑词条」就是入口，这里只负责看和管人。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { toast } from "@/lib/toast";
import { ROLE_ZH, fmtTime } from "@/lib/wiki";

type Change = components["schemas"]["WikiChangeBody"];
type Member = components["schemas"]["WikiMemberBody"];

useHead({ title: "编辑部 · Shaker" });

const api = useApi();
const qc = useQueryClient();
const auth = useAuthStore();

const { data: changes, isLoading: changesLoading, error: changesError } = useQuery({
  queryKey: ["wiki-changes"],
  queryFn: async (): Promise<Change[]> => {
    const { data, error } = await api.GET("/api/v1/wiki/changes", { params: { query: { limit: 50 } } });
    if (error) throw error;
    return data.items ?? [];
  },
});

const { data: members, isLoading: membersLoading } = useQuery({
  queryKey: ["wiki-editors"],
  queryFn: async (): Promise<Member[]> => {
    const { data, error } = await api.GET("/api/v1/wiki/editors");
    if (error) throw error;
    return data.items ?? [];
  },
});

function targetTo(c: Change): string {
  return c.kind === "recipe" ? `/classics/${c.targetKey}` : `/ingredients/${c.targetKey}`;
}
function historyTo(c: Change): string {
  return `/wiki/history/${c.kind}/${c.targetId}`;
}

/* ── 管理员：任免编辑 ── */
const handle = ref("");
const setRole = useMutation({
  mutationFn: async (vars: { handle: string; role: "user" | "editor" }) => {
    const { data, error } = await api.PUT("/api/v1/admin/users/{handle}/role", {
      params: { path: { handle: vars.handle } },
      body: { role: vars.role },
    });
    if (error) throw error;
    return data;
  },
  onSuccess: (m) => {
    toast.success(m.role === "editor" ? `@${m.handle} 成为了百科编辑` : `已撤销 @${m.handle} 的编辑身份`);
    handle.value = "";
    void qc.invalidateQueries({ queryKey: ["wiki-editors"] });
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

function grant(): void {
  const h = handle.value.trim().replace(/^@/, "");
  if (h) setRole.mutate({ handle: h, role: "editor" });
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <p class="font-logo text-[8px] tracking-[0.3em] text-amber">EDITORIAL</p>
      <h1 class="flex items-center gap-2 text-2xl text-fg text-shadow-px">
        <PxIcon name="book" :scale="3" class="text-amber" />编辑部
      </h1>
      <p class="text-dim">经典配方与原料百科由编辑们一起维护。每次修订都留档，随时可以翻旧版、以旧版为底稿改回去。</p>
    </header>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <!-- 修订动态 -->
      <PxPanel title="最近修订" icon="clock" tone="amber" :padded="false">
        <div v-if="changesLoading" class="flex flex-col gap-2 p-3">
          <PxSkeleton v-for="i in 6" :key="i" class="h-12" />
        </div>
        <PxEmpty v-else-if="changesError" icon="warn" tone="red" :title="apiErrorMessage(changesError)" />
        <PxEmpty v-else-if="!changes?.length" icon="book" title="还没有人修订过百科。">
          <template v-if="auth.isEditor">去任意经典或原料页面，点「编辑词条」开始。</template>
        </PxEmpty>
        <ul v-else class="flex flex-col">
          <li v-for="c in changes" :key="`${c.kind}-${c.targetId}-${c.version}`" class="change">
            <PxIcon :name="c.kind === 'recipe' ? 'martini' : 'bottle'" :scale="2" :class="c.kind === 'recipe' ? 'text-pink' : 'text-cyan'" />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="flex flex-wrap items-center gap-x-2">
                <NuxtLink :to="targetTo(c)" class="truncate text-fg hover:text-amber">{{ c.title }}</NuxtLink>
                <span class="font-logo text-[8px] text-faint">V{{ c.version }}</span>
              </span>
              <span class="truncate text-dim">{{ c.note || "（未写摘要）" }}</span>
              <span class="text-faint">
                <NuxtLink v-if="c.editorHandle" :to="`/u/${c.editorHandle}`" class="hover:text-amber">
                  {{ c.editorName || c.editorHandle }}
                </NuxtLink>
                · <span class="font-logo text-[8px]">{{ fmtTime(c.createdAt) }}</span>
              </span>
            </div>
            <PxButton size="sm" variant="ghost" icon="clock" :to="historyTo(c)" :aria-label="`${c.title} 的修订历史`" />
          </li>
        </ul>
      </PxPanel>

      <div class="flex flex-col gap-6">
        <!-- 我的身份 -->
        <PxPanel title="我的身份" icon="user" tone="plain">
          <p v-if="!auth.isAuthenticated" class="text-dim">
            登录后，如果你被任命为编辑，就能直接修订百科。
            <NuxtLink to="/login?redirect=/wiki" class="text-amber hover:underline">去登录</NuxtLink>
          </p>
          <div v-else class="flex flex-col gap-2">
            <p class="flex items-center gap-2">
              <PxBadge :tone="auth.isAdmin ? 'gold' : auth.isEditor ? 'amber' : 'plain'" variant="solid" :icon="auth.isAdmin ? 'crown' : auth.isEditor ? 'pencil' : 'user'">
                {{ ROLE_ZH[auth.user?.role ?? "user"] }}
              </PxBadge>
            </p>
            <p v-if="auth.isEditor" class="text-dim">在经典配方或原料页面点「编辑词条」即可修订。</p>
            <p v-else class="text-dim">你现在还不能修订百科。发现错误？在配方下留言，或联系管理员任命你为编辑。</p>
          </div>
        </PxPanel>

        <!-- 编辑名册 -->
        <PxPanel title="编辑名册" icon="users" tone="cyan" :padded="false">
          <div v-if="membersLoading" class="flex flex-col gap-2 p-3">
            <PxSkeleton v-for="i in 3" :key="i" class="h-10" />
          </div>
          <ul v-else class="flex flex-col">
            <li v-for="m in members" :key="m.id" class="member">
              <NuxtLink :to="`/u/${m.handle}`" class="flex min-w-0 flex-1 items-center gap-2 hover:text-amber">
                <PxAvatar :src="m.avatarUrl" :seed="m.handle" :size="32" />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-fg">{{ m.displayName }}</span>
                  <span class="truncate text-faint">@{{ m.handle }} · {{ m.editCount }} 次修订</span>
                </span>
              </NuxtLink>
              <PxBadge :tone="m.role === 'admin' ? 'gold' : 'amber'" :icon="m.role === 'admin' ? 'crown' : undefined">
                {{ ROLE_ZH[m.role] }}
              </PxBadge>
              <PxButton
                v-if="auth.isAdmin && m.role === 'editor'"
                size="sm"
                variant="ghost"
                icon="x"
                :aria-label="`撤销 @${m.handle} 的编辑身份`"
                :disabled="setRole.isPending.value"
                @click="setRole.mutate({ handle: m.handle, role: 'user' })"
              />
            </li>
          </ul>

          <form v-if="auth.isAdmin" class="flex gap-2 border-t-2 border-dashed border-line p-3" @submit.prevent="grant">
            <PxInput v-model="handle" icon="user" size="sm" class="flex-1" placeholder="用户 handle" />
            <PxButton size="sm" icon="plus" type="submit" :loading="setRole.isPending.value" :disabled="!handle.trim()">任命</PxButton>
          </form>
        </PxPanel>
      </div>
    </div>
  </div>
</template>

<style scoped>
.change,
.member {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}
.change + .change,
.member + .member {
  border-top: var(--p) dashed var(--line);
}
</style>
