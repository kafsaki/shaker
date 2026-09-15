/**
 * 认证状态（SPA 模式）：
 * - accessToken 只放内存（15 分钟，不落盘）
 * - refreshToken 放 localStorage（30 天，轮转语义：刷新即失效，泄露可撤销）
 * - API client 的 401 单飞刷新回调写回这里；本 store 是 token 的唯一持有者
 */
import { markRaw } from "vue";
import { defineStore } from "pinia";
import {
  createShakerClient,
  type ShakerClient,
  type components,
} from "@shaker/api-client";

export type CurrentUser = components["schemas"]["UserBody"];

const RT_KEY = "shaker_rt";

export const useAuthStore = defineStore("auth", () => {
  const accessToken = ref<string | null>(null);
  const refreshToken = ref<string | null>(null);
  const user = ref<CurrentUser | null>(null);
  /** 启动会话恢复完成（插件里等待，路由 middleware 不用再等） */
  const ready = ref(false);

  const isAuthenticated = computed(() => user.value !== null);

  function persistRefresh(rt: string | null): void {
    refreshToken.value = rt;
    if (rt) localStorage.setItem(RT_KEY, rt);
    else localStorage.removeItem(RT_KEY);
  }

  function clearSession(): void {
    accessToken.value = null;
    user.value = null;
    persistRefresh(null);
  }

  const client = markRaw(
    createShakerClient({
      getAccessToken: () => accessToken.value,
      getRefreshToken: () =>
        refreshToken.value ?? localStorage.getItem(RT_KEY),
      onTokens: (a, r) => {
        accessToken.value = a;
        persistRefresh(r);
      },
      onAuthFailure: () => clearSession(),
    }),
  ) as ShakerClient;

  async function fetchMe(): Promise<boolean> {
    const { data, error } = await client.GET("/api/v1/me");
    if (error) return false;
    user.value = data;
    return true;
  }

  async function login(identifier: string, password: string): Promise<void> {
    const { data, error } = await client.POST("/api/v1/auth/login", {
      body: { identifier, password },
    });
    if (error) throw error;
    accessToken.value = data.accessToken;
    persistRefresh(data.refreshToken);
    await fetchMe();
  }

  async function register(input: {
    handle: string;
    email: string;
    password: string;
    displayName: string;
  }): Promise<void> {
    const { data, error } = await client.POST("/api/v1/auth/register", {
      body: input,
    });
    if (error) throw error;
    accessToken.value = data.accessToken;
    persistRefresh(data.refreshToken);
    await fetchMe();
  }

  async function logout(): Promise<void> {
    try {
      await client.POST("/api/v1/auth/logout");
    } catch {
      // 尽力而为：服务端撤销失败也照样清本地会话
    }
    clearSession();
  }

  async function logoutAll(): Promise<void> {
    try {
      await client.POST("/api/v1/auth/logout-all");
    } catch {
      // 同上
    }
    clearSession();
  }

  /**
   * 启动恢复：refresh 在 localStorage。直接 GET /me —— access 为空或过期
   * 时 api-client 的 401 链路会自动刷新并重试，失败则清会话回到匿名态。
   */
  async function restoreSession(): Promise<void> {
    const rt = localStorage.getItem(RT_KEY);
    if (!rt) {
      ready.value = true;
      return;
    }
    refreshToken.value = rt;
    try {
      const ok = await fetchMe();
      if (!ok) clearSession();
    } catch {
      clearSession();
    }
    ready.value = true;
  }

  return {
    accessToken,
    refreshToken,
    user,
    ready,
    isAuthenticated,
    client,
    login,
    register,
    logout,
    logoutAll,
    restoreSession,
    fetchMe,
    clearSession,
  };
});
