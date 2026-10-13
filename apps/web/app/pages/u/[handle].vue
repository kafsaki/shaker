<script setup lang="ts">
/**
 * 角色面板（用户主页骨架）：角色卡资料头 + 分栏页签 + 子路由出口。
 * 分栏（配方/酒单/粉丝/关注）是真实子路由，路径 `/u/{handle}/recipes|menus|followers|following`。
 * `/u/{handle}/settings` 是本人专属页，不挂资料头与分栏导航（bare 分支）。
 * 称号 / 等级是按公开计数算的装饰（lib/game），不是独立数据。
 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { compact, levelOf, rankOf } from "@/lib/game";
import { toast } from "@/lib/toast";

type PubUser = components["schemas"]["PublicUserBody"];

const route = useRoute();
const api = useApi();
const auth = useAuthStore();
const handle = computed(() => String(route.params.handle ?? ""));

// 设置页独立成页：精确比对路径，避免 handle 恰为 "settings" 时误判
const bare = computed(() => route.path === `/u/${handle.value}/settings`);

const { data: user, error, isLoading } = useQuery({
  queryKey: computed(() => ["user", handle.value] as const),
  queryFn: async (): Promise<PubUser> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}", {
      params: { path: { handle: handle.value } },
    });
    if (error) throw error;
    return data;
  },
  enabled: computed(() => !bare.value),
});

const isSelf = computed(() => auth.user?.handle === handle.value);

const tabs = computed(() => {
  const c = user.value?.counts;
  return [
    { value: "recipes", to: `/u/${handle.value}/recipes`, label: "配方", icon: "martini" as const, count: c?.recipe },
    { value: "menus", to: `/u/${handle.value}/menus`, label: "酒单", icon: "list" as const },
    { value: "followers", to: `/u/${handle.value}/followers`, label: "粉丝", icon: "heart" as const, count: c?.follower },
    { value: "following", to: `/u/${handle.value}/following`, label: "关注", icon: "users" as const, count: c?.following },
  ];
});
/** 当前分栏由路由决定；页签点击走 to 导航，路由变了这里自然跟上，所以 setter 不做事。 */
const currentTab = computed({
  get: () => tabs.value.find((t) => route.path.startsWith(t.to))?.value ?? "recipes",
  set: () => {},
});
/** 窄屏页签横向滚动：把选中页签滚进视野（直链进「关注」时它可能在屏外）。 */
/** 只横向滚动页签条（scrollIntoView 会连带滚动整页）。 */
function revealTab(strip: HTMLElement | null): void {
  const on = strip?.querySelector<HTMLElement>(".seg.on");
  if (!strip || !on) return;
  const l = on.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
  if (l < strip.scrollLeft || l + on.offsetWidth > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = Math.max(0, l - 8);
  }
}
const tabsEl = ref<HTMLElement | null>(null);
watch(
  [currentTab, tabsEl],
  () => nextTick(() => revealTab(tabsEl.value)),
  { immediate: true },
);

const level = computed(() => (user.value ? levelOf(user.value.counts) : 1));
const rank = computed(() => rankOf(user.value?.counts.recipe ?? 0));
const joined = computed(() => (user.value ? new Date(user.value.createdAt).toLocaleDateString("zh-CN") : ""));
/** 网站外链：用户可能只填了域名，补上协议；展示时去掉协议更短。 */
const websiteHref = computed(() => {
  const w = user.value?.website?.trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
});
const websiteText = computed(() => (user.value?.website ?? "").replace(/^https?:\/\//i, "").replace(/\/$/, ""));

const followingNow = ref(false);
watch(
  user,
  (u) => {
    followingNow.value = u?.viewerIsFollowing ?? false;
  },
  { immediate: true },
);

const followPending = ref(false);
async function toggleFollow(): Promise<void> {
  if (!auth.isAuthenticated) {
    toast.info("登录后即可关注");
    return;
  }
  followPending.value = true;
  try {
    if (followingNow.value) {
      const { error } = await api.DELETE("/api/v1/users/{handle}/follow", {
        params: { path: { handle: handle.value } },
      });
      if (error) throw error;
      followingNow.value = false;
    } else {
      const { error } = await api.PUT("/api/v1/users/{handle}/follow", {
        params: { path: { handle: handle.value } },
      });
      if (error) throw error;
      followingNow.value = true;
    }
  } catch (err) {
    toast.error(apiErrorMessage(err));
  } finally {
    followPending.value = false;
  }
}

useHead(() => ({
  title: bare.value
    ? "设置 · Shaker"
    : `${user.value?.displayName ?? handle.value} · Shaker`,
}));
</script>

<template>
  <div>
    <!-- 设置页：全屏，无资料头/分栏 -->
    <NuxtPage v-if="bare" />

    <div v-else-if="isLoading" class="flex flex-col gap-4">
      <PxSkeleton class="h-48" />
      <PxSkeleton class="h-10 w-2/3" />
      <PxSkeleton class="h-64" />
    </div>

    <PxEmpty v-else-if="error" icon="warn" tone="red" :title="apiErrorMessage(error)">
      <PxButton icon="chevron-left" to="/">回酒馆</PxButton>
    </PxEmpty>

    <div v-else-if="user" class="flex flex-col gap-6">
      <!-- 角色卡 -->
      <PxPanel title="角色面板" icon="user" tone="pink" :padded="false">
        <template #actions>
          <span class="font-logo text-[8px] tracking-[0.2em] text-faint">{{ isSelf ? "PLAYER 1" : "NPC" }}</span>
        </template>

        <div class="sheet">
          <!-- 立绘 + 等级牌 -->
          <div class="portrait">
            <div class="frame">
              <PxAvatar :src="user.avatarUrl" :seed="user.handle" :size="96" />
            </div>
            <span class="lv font-logo" title="等级 = 1 + 配方数 + 粉丝数/5">LV.{{ level }}</span>
          </div>

          <!-- 名牌 + 简介 + 资料 -->
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="min-w-0 break-words text-2xl text-fg text-shadow-px">{{ user.displayName }}</h1>
              <PxBadge v-if="user.isOfficial" tone="gold" variant="solid" icon="crown">官方</PxBadge>
              <NuxtLink v-if="user.role === 'editor' || user.role === 'admin'" to="/wiki" class="hover:brightness-125">
                <PxBadge tone="amber" icon="pencil">{{ user.role === "admin" ? "百科管理员" : "百科编辑" }}</PxBadge>
              </NuxtLink>
            </div>
            <p class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-faint">@{{ user.handle }}</span>
              <span class="flex items-center gap-1" title="称号按已发布配方数；等级 = 1 + 配方数 + 粉丝数/5">
                <PxBadge tone="amber" icon="trophy">{{ rank }}</PxBadge>
                <span class="font-logo text-[8px] text-amber">LV.{{ level }}</span>
                <PxIcon name="info" :scale="1" class="text-faint" />
              </span>
            </p>

            <div v-if="user.bio" class="bio">
              <span class="speaker">{{ user.displayName }}</span>
              <p class="whitespace-pre-wrap break-words text-fg">{{ user.bio }}</p>
            </div>

            <ul class="flex flex-wrap items-center gap-x-4 gap-y-1 text-dim">
              <li v-if="user.location" class="flex items-center gap-1">
                <PxIcon name="home" :scale="1" class="text-faint" />{{ user.location }}
              </li>
              <li v-if="websiteHref" class="flex min-w-0 items-center gap-1">
                <PxIcon name="globe" :scale="1" class="text-faint" />
                <a :href="websiteHref" target="_blank" rel="noopener noreferrer nofollow" class="truncate text-cyan hover:underline">
                  {{ websiteText }}
                </a>
              </li>
              <li class="flex items-center gap-1">
                <PxIcon name="clock" :scale="1" class="text-faint" />{{ joined }} 加入
              </li>
            </ul>
          </div>

          <!-- 属性格 + 指令 -->
          <div class="side">
            <div class="grid grid-cols-3 gap-1">
              <NuxtLink :to="`/u/${handle}/recipes`" class="attr">
                <span class="font-logo text-[16px] text-amber">{{ compact(user.counts.recipe) }}</span>
                <span class="text-faint">配方</span>
              </NuxtLink>
              <NuxtLink :to="`/u/${handle}/followers`" class="attr">
                <span class="font-logo text-[16px] text-pink">{{ compact(user.counts.follower) }}</span>
                <span class="text-faint">粉丝</span>
              </NuxtLink>
              <NuxtLink :to="`/u/${handle}/following`" class="attr">
                <span class="font-logo text-[16px] text-cyan">{{ compact(user.counts.following) }}</span>
                <span class="text-faint">关注</span>
              </NuxtLink>
            </div>
            <!-- 本人：设置入口（对他人不可见）；他人：关注按钮 -->
            <PxButton v-if="isSelf" icon="gear" block :to="`/u/${handle}/settings`">系统设置</PxButton>
            <PxButton
              v-else
              block
              :variant="followingNow ? 'secondary' : 'accent'"
              :icon="followingNow ? 'check' : 'plus'"
              :loading="followPending"
              :sfx="followingNow ? 'cancel' : 'coin'"
              @click="toggleFollow()"
            >
              {{ followingNow ? "已关注" : "关注" }}
            </PxButton>
          </div>
        </div>
      </PxPanel>

      <!-- 分栏（真实子路由）；窄屏不换行，横向滑动 -->
      <div ref="tabsEl" class="tabs-scroll">
        <PxSegmented v-model="currentTab" variant="tabs" :items="tabs" class="!flex-nowrap min-w-full" />
      </div>

      <NuxtPage />
    </div>
  </div>
</template>

<style scoped>
.tabs-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-top: 4px;
  scrollbar-width: none;
}
.tabs-scroll::-webkit-scrollbar { display: none; }
.tabs-scroll :deep(.seg) { flex-shrink: 0; white-space: nowrap; }
.sheet {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 20px;
  padding: 18px;
}
.portrait {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.frame {
  padding: 6px;
  background: var(--deep);
  box-shadow:
    0 0 0 var(--p) var(--ink),
    0 0 0 calc(var(--p) * 2) var(--pink),
    0 0 0 calc(var(--p) * 3) var(--ink),
    calc(var(--p) * 4) calc(var(--p) * 4) 0 calc(var(--p) * 3) var(--shadow);
  margin: calc(var(--p) * 3);
}
.lv {
  padding: 4px 8px;
  background: var(--ink);
  color: var(--amber-hi);
  font-size: 8px;
  box-shadow: 0 0 0 var(--p) var(--amber);
}
/* 简介：RPG 对白框（名牌压在左上角） */
.bio {
  position: relative;
  max-width: 60ch;
  margin: 10px var(--p) var(--p);
  padding: 14px 12px 10px;
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.bio .speaker {
  position: absolute;
  left: 8px;
  top: -10px;
  max-width: calc(100% - 16px);
  overflow: hidden;
  padding: 0 6px;
  background: var(--pink);
  color: var(--on-accent);
  line-height: 18px;
  white-space: nowrap;
  text-overflow: ellipsis;
  box-shadow: 0 0 0 var(--p) var(--ink);
}
.side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 240px;
  flex-shrink: 0;
}
.attr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: var(--p);
  padding: 8px 4px 6px;
  background: var(--panel-lo);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.attr:hover { background: var(--panel-hi); box-shadow: 0 0 0 var(--p) var(--amber), inset var(--p) var(--p) 0 0 var(--hi); }
@media (max-width: 767px) {
  .side { width: 100%; }
}
@media (max-width: 479px) {
  .sheet { padding: 14px; gap: 14px; }
}
</style>
