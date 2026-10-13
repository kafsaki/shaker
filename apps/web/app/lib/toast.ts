/**
 * 游戏式消息条（替代 vue-sonner）：API 与 sonner 的常用子集同形，
 * `toast.success(title, { description })`，调用点只需换 import。
 * 渲染在 PxToaster；音效由 PxToaster 按类型播放（它在组件上下文里，能读偏好）。
 */
import { reactive } from "vue";

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

export const toastState = reactive<{ items: ToastItem[] }>({ items: [] });

let seq = 0;
const LIFETIME: Record<ToastKind, number> = { success: 2600, info: 3000, error: 4800 };

function push(kind: ToastKind, title: string, opts?: { description?: string }): void {
  const id = ++seq;
  toastState.items.push({ id, kind, title, description: opts?.description });
  // 同屏最多 4 条，旧的先走
  if (toastState.items.length > 4) toastState.items.shift();
  setTimeout(() => dismissToast(id), LIFETIME[kind]);
}

export function dismissToast(id: number): void {
  const i = toastState.items.findIndex((t) => t.id === id);
  if (i >= 0) toastState.items.splice(i, 1);
}

export const toast = {
  success: (title: string, opts?: { description?: string }) => push("success", title, opts),
  error: (title: string, opts?: { description?: string }) => push("error", title, opts),
  info: (title: string, opts?: { description?: string }) => push("info", title, opts),
};
