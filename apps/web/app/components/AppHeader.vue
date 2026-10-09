<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { Bell, BookOpen, LogOut, Martini, Moon, PencilLine, Search, Settings, Sun } from "lucide-vue-next";
// MenuAnchor（只提供弹出层的定位参考、不接管点击）未出现在 reka-ui 主入口的
// 导出里，只能走它声明的 ./internal 子路径——这样头像可以保持成一个普通链接。
import { MenuAnchor } from "reka-ui/internal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const auth = useAuthStore();
const { theme, toggleTheme } = useTheme();
const route = useRoute();
const router = useRouter();

/* 全局搜索：回车跳到搜索结果页 */
const keyword = ref((route.query.q as string) ?? "");

// 只在搜索结果页同步输入框（进入/前进后退/分享链接），避免离开搜索页时清掉未提交的关键词
watch(
  () => route.query.q,
  (v) => {
    if (route.path === "/search") keyword.value = (v as string) ?? "";
  },
  { immediate: true },
);

function submitSearch(): void {
  const q = keyword.value.trim();
  if (!q) return;
  void router.push({ path: "/search", query: { q } });
}

// 未读红点：轻量轮询（登录后才有意义）
const { data: unread } = useQuery({
  queryKey: ["notifications-unread"],
  queryFn: async () => {
    const api = useAuthStore().client;
    const { data, error } = await api.GET("/api/v1/notifications/unread-count");
    if (error) throw error;
    return data.count;
  },
  enabled: computed(() => auth.isAuthenticated),
  refetchInterval: 60_000,
});

function activePrefix(prefix: string): boolean {
  if (prefix === "/") return route.path === "/";
  return route.path.startsWith(prefix);
}

// 搜索结果页自带搜索框，导航条的搜索入口在该页无意义，隐藏
const showSearch = computed(() => route.path !== "/search");

async function onLogout(): Promise<void> {
  await auth.logout();
  await navigateTo("/");
}

/* 头像菜单：点击头像进个人主页，菜单只由悬浮触发（仿 b 站）。
   两处悬浮区（导航里的头像槽、面板本身）共用这一对开关：悬浮任一处保持
   展开，离开后延迟一点收起——延迟既给鼠标从槽位移向面板留时间，也避开
   面板出现/生长导致指针下元素换人时的 enter/leave 抖动。
   这里刻意不用「进入计数」：面板一出现，指针下的元素就会换人，少一次
   leave 计数就永远回不到零，菜单便再也关不上。 */
const profileMenuOpen = ref(false);
let profileMenuTimer: ReturnType<typeof setTimeout> | undefined;

function openProfileMenu(): void {
  clearTimeout(profileMenuTimer);
  profileMenuOpen.value = true;
}

function closeProfileMenuSoon(): void {
  clearTimeout(profileMenuTimer);
  profileMenuTimer = setTimeout(() => (profileMenuOpen.value = false), 180);
}

onBeforeUnmount(() => clearTimeout(profileMenuTimer));
</script>

<template>
  <!-- 收起态保持 z-40：面板（z-50）压在导航之上，放大头像才能从面板图层里
       盖住导航下缘与面板顶边，不必去抬高整条导航 -->
  <header class="sticky top-0 z-40 border-b-2 border-border bg-background/95">
    <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
      <NuxtLink to="/" class="group flex items-center gap-2 text-base font-semibold">
        <span
          class="grid size-7 place-items-center rounded-sm border-2 border-primary bg-primary text-primary-foreground transition-transform group-hover:scale-110 pixel-shadow-sm"
        >
          <Martini class="size-4" />
        </span>
        <span class="font-pixel text-sm tracking-wider text-primary">
          SHAKER
        </span>
      </NuxtLink>

      <nav class="hidden items-center gap-1 md:flex">
        <NuxtLink
          to="/"
          class="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="activePrefix('/') ? 'font-medium text-foreground' : 'text-muted-foreground'"
        >
          探索
        </NuxtLink>
        <NuxtLink
          to="/classics"
          class="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="activePrefix('/classics') ? 'font-medium text-foreground' : 'text-muted-foreground'"
        >
          经典
        </NuxtLink>
        <NuxtLink
          to="/ingredients"
          class="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="activePrefix('/ingredients') ? 'font-medium text-foreground' : 'text-muted-foreground'"
        >
          原料百科
        </NuxtLink>
      </nav>

      <!-- 全局搜索栏：回车跳搜索结果页；小屏收成图标入口 -->
      <form
        v-if="showSearch"
        class="relative hidden min-w-0 max-w-xs flex-1 md:block"
        @submit.prevent="submitSearch()"
      >
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="keyword"
          placeholder="搜配方 / 酒单 / 用户 / 原料…"
          class="h-9 rounded-sm border-2 pl-8"
        />
      </form>
      <Button v-if="showSearch" variant="ghost" size="icon" class="md:hidden" title="搜索" as-child>
        <NuxtLink to="/search"><Search class="size-4" /></NuxtLink>
      </Button>

      <!-- 右侧顺序：头像 | 通知 | 明暗切换 | 创作 -->
      <div class="ml-auto flex items-center gap-1.5">
        <template v-if="auth.isAuthenticated">
          <!-- 头像：点击进个人主页；悬浮时头像在原地长出放大版并展开菜单（仿 b 站）。
               几何：导航行高 56px（加 2px 下边框，视觉下沿在 58px），头像 32px
               居中 → 头像盒 12~44px、中心 28px。面板 sideOffset=14 → 面板顶边
               正好接在导航视觉下沿（58px）；放大头像 64px、以面板顶边中点为中心
               → 中心 28+30=58px，即放大后竖向中点落在导航下边缘，横竖都居中于面板上边缘。
               modal=false 是必须的：reka 默认按模态处理，会锁页面滚动并在 body 上
               禁用外部指针事件，整页失去命中、头像槽也不再是悬浮区。 -->
          <DropdownMenu v-model:open="profileMenuOpen" :modal="false">
            <MenuAnchor as-child>
              <!-- 本槽位永远不动（popper 量的就是它），悬浮区因此固定在原头像位置。
                   ml/mr 是给放大头像留横向余量：它比槽位每边宽 16px，
                   别压到左边的搜索框和右边的通知键 -->
              <span class="ml-1 mr-4 inline-flex">
                <NuxtLink
                  :to="`/u/${auth.user?.handle}`"
                  class="block rounded-full outline-none ring-ring focus-visible:ring-2"
                  :title="auth.user?.displayName"
                  @mouseenter="openProfileMenu()"
                  @mouseleave="closeProfileMenuSoon()"
                  @click="profileMenuOpen = false"
                >
                  <!-- 展开时本体隐去：放大版恰好从它的位置尺寸起步，看上去是同一个头像在长 -->
                  <Avatar
                    class="size-8 transition-opacity duration-100"
                    :class="profileMenuOpen ? 'opacity-0' : 'opacity-100'"
                  >
                    <AvatarImage
                      v-if="auth.user?.avatarUrl"
                      :src="auth.user.avatarUrl"
                      :alt="auth.user.displayName"
                    />
                    <AvatarFallback class="text-xs">
                      {{ auth.user?.displayName.slice(0, 1) }}
                    </AvatarFallback>
                  </Avatar>
                </NuxtLink>
              </span>
            </MenuAnchor>
            <!-- 放大头像画在面板图层里（面板 z-50 高于导航 z-40）：
                 它在面板之上，所以压在导航下缘与面板顶边的那部分照样能点；
                 命中盒是静止的 48px 方块，只有内层图形做生长动画，
                 放大过程中指针既不会丢焦、光标也不会在箭头与手型之间跳。
                 为此面板要放开 overflow，否则绝对定位的头像会被裁掉。 -->
            <DropdownMenuContent
              align="center"
              :side-offset="14"
              class="w-48 overflow-x-visible overflow-y-visible"
              @mouseenter="openProfileMenu()"
              @mouseleave="closeProfileMenuSoon()"
            >
              <!-- 它已经是面板子树的一部分，悬浮/移开由面板那对 enter/leave 一并覆盖，
                   这里不重复挂监听，省得两个悬浮区互相打架 -->
              <NuxtLink
                :to="`/u/${auth.user?.handle}`"
                class="absolute -top-8 left-1/2 size-16 -translate-x-1/2 rounded-full outline-none ring-ring focus-visible:ring-2"
                :title="auth.user?.displayName"
                @click="profileMenuOpen = false"
              >
                <span class="animate-avatar-bloom block size-full">
                  <Avatar class="size-16">
                    <AvatarImage
                      v-if="auth.user?.avatarUrl"
                      :src="auth.user.avatarUrl"
                      :alt="auth.user.displayName"
                    />
                    <AvatarFallback class="text-lg">
                      {{ auth.user?.displayName.slice(0, 1) }}
                    </AvatarFallback>
                  </Avatar>
                </span>
              </NuxtLink>

              <!-- 给放大头像让位：它从面板顶边压进来 32px -->
              <div class="h-8" aria-hidden="true" />
              <DropdownMenuLabel class="flex flex-col items-center">
                <span class="text-sm font-medium">{{ auth.user?.displayName }}</span>
                <span class="text-xs font-normal text-muted-foreground">
                  @{{ auth.user?.handle }}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem as-child>
                <NuxtLink :to="`/u/${auth.user?.handle}/menus`" class="flex items-center gap-2">
                  <BookOpen class="size-4" /> 我的酒单
                </NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child>
                <NuxtLink :to="`/u/${auth.user?.handle}/settings`" class="flex items-center gap-2">
                  <Settings class="size-4" /> 设置
                </NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:text-destructive"
                @click="onLogout()"
              >
                <LogOut class="size-4" /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" title="通知" as-child class="relative">
            <NuxtLink to="/notifications">
              <Bell class="size-4" />
              <span
                v-if="(unread ?? 0) > 0"
                class="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground"
              >
                {{ (unread ?? 0) > 9 ? "9+" : unread }}
              </span>
            </NuxtLink>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            :title="theme === 'dark' ? '切换到亮色' : '切换到暗色'"
            @click="toggleTheme()"
          >
            <Sun v-if="theme === 'dark'" class="size-4" />
            <Moon v-else class="size-4" />
          </Button>

          <Separator orientation="vertical" class="mx-1 !h-5" />
          <Button size="sm" variant="outline" as-child>
            <NuxtLink to="/editor/new" class="flex items-center gap-1.5">
              <PencilLine class="size-3.5" />
              创作
            </NuxtLink>
          </Button>
        </template>

        <template v-else>
          <Button
            variant="ghost"
            size="icon"
            :title="theme === 'dark' ? '切换到亮色' : '切换到暗色'"
            @click="toggleTheme()"
          >
            <Sun v-if="theme === 'dark'" class="size-4" />
            <Moon v-else class="size-4" />
          </Button>
          <Button size="sm" as-child>
            <NuxtLink to="/login">登录 / 注册</NuxtLink>
          </Button>
        </template>
      </div>
    </div>
  </header>
</template>
