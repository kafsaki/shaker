<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { Bell, BookOpen, LogOut, Martini, Moon, PencilLine, Settings, Sun, User } from "lucide-vue-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

const auth = useAuthStore();
const { theme, toggleTheme } = useTheme();
const route = useRoute();

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

async function onLogout(): Promise<void> {
  await auth.logout();
  await navigateTo("/");
}
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur"
  >
    <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
      <NuxtLink to="/" class="flex items-center gap-2 text-base font-semibold">
        <span
          class="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"
        >
          <Martini class="size-4" />
        </span>
        Shaker
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
          to="/ingredients"
          class="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="activePrefix('/ingredients') ? 'font-medium text-foreground' : 'text-muted-foreground'"
        >
          原料百科
        </NuxtLink>
        <NuxtLink
          to="/classics"
          class="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="activePrefix('/classics') ? 'font-medium text-foreground' : 'text-muted-foreground'"
        >
          经典
        </NuxtLink>
      </nav>

      <div class="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          :title="theme === 'dark' ? '切换到亮色' : '切换到暗色'"
          @click="toggleTheme()"
        >
          <Sun v-if="theme === 'dark'" class="size-4" />
          <Moon v-else class="size-4" />
        </Button>

        <template v-if="auth.isAuthenticated">
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
          <Separator orientation="vertical" class="mx-1 !h-5" />
          <Button size="sm" variant="outline" as-child>
            <NuxtLink to="/editor/new" class="flex items-center gap-1.5">
              <PencilLine class="size-3.5" />
              创作
            </NuxtLink>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                class="ml-1 rounded-full outline-none ring-ring focus-visible:ring-2"
                :title="auth.user?.displayName"
              >
                <Avatar class="size-8">
                  <AvatarImage
                    v-if="auth.user?.avatarUrl"
                    :src="auth.user.avatarUrl"
                    :alt="auth.user.displayName"
                  />
                  <AvatarFallback class="text-xs">
                    {{ auth.user?.displayName.slice(0, 1) }}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuLabel class="flex flex-col">
                <span class="text-sm font-medium">{{ auth.user?.displayName }}</span>
                <span class="text-xs font-normal text-muted-foreground">
                  @{{ auth.user?.handle }}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem as-child>
                <NuxtLink :to="`/u/${auth.user?.handle}`" class="flex items-center gap-2">
                  <User class="size-4" /> 我的主页
                </NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child>
                <NuxtLink to="/me" class="flex items-center gap-2">
                  <Settings class="size-4" /> 设置
                </NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child>
                <NuxtLink to="/me/menus" class="flex items-center gap-2">
                  <BookOpen class="size-4" /> 我的酒单
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
        </template>

        <template v-else>
          <Button size="sm" as-child>
            <NuxtLink to="/login">登录 / 注册</NuxtLink>
          </Button>
        </template>
      </div>
    </div>
  </header>
</template>
