<script setup lang="ts">
/**
 * 顶部 HUD 状态栏 + 移动端底部操作栏。
 * 左：招牌 + 游戏菜单式主导航；右：搜索（/ 或 Ctrl+K）、信箱（未读数）、昼夜、音效、玩家卡。
 * 玩家卡显示称号与等级（纯装饰，见 lib/game.ts），悬浮/点击展开指令菜单。
 */
import { useQuery } from "@tanstack/vue-query";
import type { components } from "@shaker/api-client";
import { LOGO_PALETTE, LOGO_SHAKER } from "@/lib/pixel-sprites";
import { levelOf, rankOf } from "@/lib/game";
import type { PixelIconName } from "@/lib/pixel-icons";

const auth = useAuthStore();
const api = useApi();
const route = useRoute();
const { theme, toggleTheme } = useTheme();
const { prefs, setPref } = usePrefs();
const { play } = useSfx();
const searchOpen = useState("search-open", () => false);

const NAV: { to: string; label: string; icon: PixelIconName; match: (p: string) => boolean }[] = [
  { to: "/", label: "酒馆", icon: "home", match: (p) => p === "/" },
  { to: "/classics", label: "图鉴", icon: "book", match: (p) => p.startsWith("/classics") },
  { to: "/ingredients", label: "原料", icon: "bottle", match: (p) => p.startsWith("/ingredients") },
  { to: "/editor/new", label: "工坊", icon: "shaker", match: (p) => p.startsWith("/editor") },
];

const { data: unread } = useQuery({
  queryKey: ["notifications-unread"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/notifications/unread-count");
    if (error) throw error;
    return data.count;
  },
  enabled: computed(() => auth.isAuthenticated),
  refetchInterval: 60_000,
});

// 玩家卡的计数与个人主页共用缓存键
const { data: me } = useQuery({
  queryKey: computed(() => ["user", auth.user?.handle ?? ""] as const),
  queryFn: async (): Promise<components["schemas"]["PublicUserBody"]> => {
    const { data, error } = await api.GET("/api/v1/users/{handle}", {
      params: { path: { handle: auth.user!.handle } },
    });
    if (error) throw error;
    return data;
  },
  enabled: computed(() => auth.isAuthenticated),
  staleTime: 60_000,
});

const level = computed(() => (me.value ? levelOf(me.value.counts) : 1));
const rank = computed(() => rankOf(me.value?.counts.recipe ?? 0));

function toggleSound(): void {
  setPref("sound", !prefs.value.sound);
  if (prefs.value.sound) play("coin");
}

function onTheme(): void {
  toggleTheme();
  play("click");
}

const menuOpen = ref(false);
async function onLogout(): Promise<void> {
  await auth.logout();
  await navigateTo("/");
}

/* 全局快捷键：/ 或 Ctrl+K 打开搜索（正在输入时不抢键） */
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    searchOpen.value = true;
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

const isActive = (n: (typeof NAV)[number]) => n.match(route.path);
const meActive = computed(() => !!auth.user && route.path.startsWith(`/u/${auth.user.handle}`));
</script>

<template>
  <header class="hud sticky top-0 z-40">
    <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-3 md:gap-5 md:px-4">
      <!-- 招牌 -->
      <NuxtLink to="/" class="group flex shrink-0 items-center gap-2" aria-label="Shaker 首页">
        <span class="transition-transform group-hover:-translate-y-0.5">
          <PxSprite :rows="LOGO_SHAKER" :palette="LOGO_PALETTE[theme]" :scale="2" />
        </span>
        <span class="flex flex-col leading-none">
          <span class="font-logo text-[16px] text-amber text-shadow-px">SHAKER</span>
          <span class="mt-1 hidden font-logo text-[8px] tracking-[0.3em] text-faint sm:block">PIXEL BAR</span>
        </span>
      </NuxtLink>

      <!-- 主导航（桌面） -->
      <nav class="hidden items-stretch self-stretch md:flex" aria-label="主导航">
        <NuxtLink
          v-for="n in NAV"
          :key="n.to"
          :to="n.to"
          class="nav-item"
          :class="{ on: isActive(n) }"
          @click="play('step')"
        >
          <span class="cur" aria-hidden="true">▶</span>
          <PxIcon :name="n.icon" :scale="2" />
          <span>{{ n.label }}</span>
        </NuxtLink>
      </nav>

      <div class="ml-auto flex items-center gap-1">
        <!-- 搜索 -->
        <button type="button" class="search-trigger hidden lg:flex" @click="searchOpen = true">
          <PxIcon name="search" :scale="1" />
          <span class="flex-1 text-left">搜配方 / 原料 / 酒单…</span>
          <PxKbd>/</PxKbd>
        </button>
        <PxButton variant="ghost" square icon="search" class="lg:!hidden" title="搜索" @click="searchOpen = true" />

        <template v-if="auth.isAuthenticated">
          <PxButton variant="ghost" square to="/notifications" title="信箱" class="relative">
            <PxIcon name="mail" :scale="2" />
            <span v-if="(unread ?? 0) > 0" class="badge">{{ (unread ?? 0) > 9 ? "9+" : unread }}</span>
          </PxButton>
        </template>
        <PxButton
          variant="ghost"
          square
          :icon="theme === 'dark' ? 'moon' : 'sun'"
          :title="theme === 'dark' ? '夜班（点击切到日班）' : '日班（点击切到夜班）'"
          class="max-sm:!hidden"
          :sfx="false"
          @click="onTheme()"
        />
        <PxButton
          variant="ghost"
          square
          :icon="prefs.sound ? 'sound-on' : 'sound-off'"
          :title="prefs.sound ? '音效：开' : '音效：关'"
          class="max-sm:!hidden"
          :class="prefs.sound ? '!text-amber' : ''"
          :sfx="false"
          @click="toggleSound()"
        />

        <!-- 玩家卡 -->
        <PxMenu v-if="auth.isAuthenticated && auth.user" v-model:open="menuOpen">
          <template #trigger>
            <button type="button" class="player" :class="{ on: menuOpen || meActive }">
              <PxAvatar :src="auth.user.avatarUrl" :seed="auth.user.handle" :size="28" />
              <span class="hidden min-w-0 flex-col text-left leading-tight md:flex">
                <span class="max-w-28 truncate text-fg">{{ auth.user.displayName }}</span>
                <span class="text-faint"><span class="font-logo text-[8px] text-amber">LV.{{ level }}</span> {{ rank }}</span>
              </span>
              <PxIcon name="chevron-down" :scale="1" class="hidden text-dim md:block" />
            </button>
          </template>
          <div class="flex items-center gap-3 px-3 pb-2 pt-3">
            <PxAvatar :src="auth.user.avatarUrl" :seed="auth.user.handle" :size="40" />
            <div class="min-w-0">
              <p class="truncate text-fg">{{ auth.user.displayName }}</p>
              <p class="truncate text-faint">@{{ auth.user.handle }}</p>
            </div>
          </div>
          <div class="px-menu-sep" />
          <PxMenuItem icon="user" :to="`/u/${auth.user.handle}`">角色面板</PxMenuItem>
          <PxMenuItem icon="list" :to="`/u/${auth.user.handle}/menus`">我的酒单</PxMenuItem>
          <PxMenuItem icon="folder" to="/editor/new?drafts=1">草稿箱</PxMenuItem>
          <PxMenuItem icon="gear" :to="`/u/${auth.user.handle}/settings`">系统设置</PxMenuItem>
          <div class="px-menu-sep" />
          <PxMenuItem icon="logout" danger @select="onLogout()">退出游戏</PxMenuItem>
        </PxMenu>
        <template v-else>
          <PxButton variant="primary" size="sm" icon="play" to="/login" class="ml-1">读取存档</PxButton>
          <PxButton size="sm" to="/register" class="max-sm:!hidden">新游戏</PxButton>
        </template>
      </div>
    </div>
  </header>

  <!-- 移动端底部操作栏 -->
  <nav class="tabbar" aria-label="底部导航">
    <NuxtLink v-for="n in NAV" :key="n.to" :to="n.to" class="tab" :class="{ on: isActive(n), big: n.icon === 'shaker' }">
      <PxIcon :name="n.icon" :scale="2" />
      <span>{{ n.label }}</span>
    </NuxtLink>
    <NuxtLink
      :to="auth.user ? `/u/${auth.user.handle}` : '/login'"
      class="tab"
      :class="{ on: meActive }"
    >
      <PxIcon name="user" :scale="2" />
      <span>{{ auth.user ? "我的" : "登录" }}</span>
    </NuxtLink>
  </nav>

  <SearchDialog v-model:open="searchOpen" />
</template>

<style scoped>
.hud {
  background: var(--panel);
  box-shadow:
    0 var(--p) 0 0 var(--ink),
    inset 0 calc(var(--p) * -1) 0 0 var(--lo),
    inset 0 var(--p) 0 0 var(--hi),
    0 calc(var(--p) * 3) 0 0 var(--shadow);
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 0 6px;
  color: var(--dim);
}
.nav-item .cur { visibility: hidden; color: var(--amber); font-size: 10px; }
.nav-item:hover { color: var(--fg); background: var(--panel-hi); }
.nav-item:hover .cur { visibility: visible; }
.nav-item.on { color: var(--amber); background: var(--panel-lo); }
.nav-item.on .cur { visibility: visible; animation: px-blink 0.8s steps(1) infinite; }
.nav-item.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: var(--amber);
}
.search-trigger {
  align-items: center;
  gap: 8px;
  width: 220px;
  height: 30px;
  margin: 0 6px;
  padding: 0 6px 0 10px;
  background: var(--deep);
  color: var(--faint);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 var(--lo);
}
.search-trigger:hover { color: var(--dim); box-shadow: 0 0 0 var(--p) var(--amber), inset var(--p) var(--p) 0 0 var(--lo); }
.badge {
  position: absolute;
  top: -2px;
  right: -4px;
  min-width: 16px;
  height: 14px;
  padding: 0 2px;
  background: var(--pink);
  color: #fff;
  font-family: var(--font-logo);
  font-size: 8px;
  line-height: 14px;
  text-align: center;
  box-shadow: 0 0 0 var(--p) var(--ink);
  animation: px-bob 1s steps(2) infinite;
}
.player {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin-left: 4px;
  padding: 0 8px 0 4px;
}
.player:hover,
.player.on { background: var(--panel-hi); }

.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  height: 60px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--panel);
  box-shadow: 0 calc(var(--p) * -1) 0 0 var(--ink), inset 0 var(--p) 0 0 var(--hi);
}
/* 断点写在这里：scoped 的 display 会压过 Tailwind 的 md:hidden */
@media (min-width: 768px) {
  .tabbar { display: none; }
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--dim);
}
.tab.on { color: var(--amber); background: var(--panel-lo); box-shadow: inset 0 calc(var(--p) * 2) 0 0 var(--amber); }
.tab.big {
  position: relative;
  top: -10px;
  margin: 0 6px;
  height: 64px;
  background: var(--amber);
  color: var(--on-accent);
  box-shadow: 0 0 0 var(--p) var(--ink), inset var(--p) var(--p) 0 0 rgb(255 255 255 / 0.35), 0 calc(var(--p) * 2) 0 0 var(--shadow);
}
</style>
