import type { ShakerClient } from "@shaker/api-client";
import { useAuthStore } from "~/stores/auth";

/** 统一入口：client 由 auth store 持有（token 注入 + 401 刷新轮转已接好）。 */
export function useApi(): ShakerClient {
  return useAuthStore().client;
}

/** 从 api-client 的 error 对象（ApiError 结构）里取用户可读信息。 */
export function apiErrorMessage(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "error" in err &&
    typeof (err as { error?: unknown }).error === "object" &&
    (err as { error?: unknown }).error !== null
  ) {
    const inner = (err as { error: { message?: unknown } }).error;
    if (typeof inner.message === "string" && inner.message) return inner.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return "请求失败，请稍后重试";
}
