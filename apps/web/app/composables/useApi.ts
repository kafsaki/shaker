import type { ShakerClient } from "@shaker/api-client";
import { useAuthStore } from "~/stores/auth";

/** 统一入口：client 由 auth store 持有（token 注入 + 401 刷新轮转已接好）。 */
export function useApi(): ShakerClient {
  return useAuthStore().client;
}

/** 从 api-client 的 error 对象（ApiError 结构）里取用户可读信息。 */
export function apiErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "error" in err) {
    const inner = (err as { error?: unknown }).error;
    if (typeof inner === "object" && inner !== null) {
      // 后端错误信封（API 定义 §1.4）：{ code, message, details: [{code, message, path}] }
      // 校验失败的具体原因在 details 里，逐条拼上
      const e = inner as { message?: unknown; details?: unknown };
      const lines: string[] = [];
      if (typeof e.message === "string" && e.message) lines.push(e.message);
      if (Array.isArray(e.details)) {
        for (const d of e.details) {
          if (typeof d !== "object" || d === null) continue;
          const det = d as { message?: unknown; path?: unknown };
          if (typeof det.message !== "string" || !det.message) continue;
          lines.push(
            typeof det.path === "string" && det.path
              ? `${det.path}: ${det.message}`
              : det.message,
          );
        }
      }
      if (lines.length) return lines.join("；");
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "请求失败，请稍后重试";
}
