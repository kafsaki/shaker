/**
 * Shaker API 客户端（ADR-017：openapi.yaml 由 Go huma 生成 → 本包生成 TS 类型，单向流向）。
 *
 * 设计要点：
 * - baseUrl 为空串：同源相对路径。dev 由 Nuxt devProxy 把 /api 转发到 Go API，生产同域反代。
 * - 认证由调用方注入（auth store）：本包不持有状态，只按回调取 token。
 * - 401 自动刷新：access token 15 分钟过期，收到 401 时单飞调用 /auth/refresh
 *   （轮转语义：旧 refresh token 立即失效），成功后重放原请求，失败触发登出回调。
 *   认证端点自身（login/refresh/logout）不参与重试，避免递归。
 */
import createClientBase from "openapi-fetch";
import type { paths } from "./schema.ts";

export type { paths, components, operations } from "./schema.ts";

export interface ShakerClientOptions {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  /** 刷新成功，新令牌对回写（access 15 分钟 + refresh 30 天轮转）。 */
  onTokens(accessToken: string, refreshToken: string): void;
  /** 刷新也失败（refresh 过期/被撤销）——调用方应清空会话。 */
  onAuthFailure(): void;
}

export type ShakerClient = ReturnType<typeof createClientBase<paths>>;

/** 刷新后的 access token 通过这里注入，避免闭包持有过期值。 */
export function createShakerClient(opts: ShakerClientOptions): ShakerClient {
  let refreshing: Promise<boolean> | null = null;

  async function tryRefresh(): Promise<boolean> {
    const rt = opts.getRefreshToken();
    if (!rt) return false;
    try {
      // 用裸 fetch：不走包装（无 Authorization 头、不重试），防递归
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!data.accessToken || !data.refreshToken) return false;
      opts.onTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  const authedFetch: typeof fetch = async (input, init) => {
    const doFetch = (): Promise<Response> => {
      const headers = new Headers(init?.headers);
      const at = opts.getAccessToken();
      if (at) headers.set("Authorization", `Bearer ${at}`);
      return fetch(input, { ...init, headers });
    };

    let res = await doFetch();

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const isAuthEndpoint = url.includes("/api/v1/auth/");

    if (res.status === 401 && !isAuthEndpoint && opts.getRefreshToken()) {
      // 单飞：并发的多个 401 只触发一次 refresh
      refreshing ??= tryRefresh().finally(() => {
        refreshing = null;
      });
      const ok = await refreshing;
      if (ok) {
        res = await doFetch();
      } else {
        opts.onAuthFailure();
      }
    }
    return res;
  };

  return createClientBase<paths>({ baseUrl: "", fetch: authedFetch });
}
