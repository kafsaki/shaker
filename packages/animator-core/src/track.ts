/**
 * 关键帧轨道：写入（编排期）与取样（播放期）。
 *
 * 轨道的键按时间排序；同一时刻允许多个键（瞬切：后写的那个从该时刻起生效）。
 * 取样是二分 + 两端插值，O(log n)。
 */
import type { Ease, Track } from "./types.ts";

export function track<T>(initial: T, t = 0): Track<T> {
  return { keys: [{ t, v: initial, ease: "linear" }] };
}

/**
 * 在 t 处写一个键。`ease` 是**从上一个键到这一键**的曲线（编排时更好写：
 * 「从现在缓出地移动到这里」）。写入时会挪到前一个键上存储。
 */
export function key<T>(tr: Track<T>, t: number, v: T, ease: Ease = "easeInOut"): void {
  const ks = tr.keys;
  // 时间单调：编排按时间顺序写；乱序写入的键插到正确位置
  let i = ks.length;
  while (i > 0 && ks[i - 1]!.t > t) i--;
  if (i > 0) ks[i - 1]!.ease = ease;
  ks.splice(i, 0, { t, v, ease: "linear" });
}

/** 在 t 处保持最后写入的值（之后的移动从这里开始，而不是从上一个键开始插值）。 */
export function hold<T>(tr: Track<T>, t: number): void {
  if (t > lastT(tr)) key(tr, t, last(tr), "linear");
}

/** 轨道在 t 时刻的「最后写入值」（不插值）—— 编排时读当前姿态用。 */
export function last<T>(tr: Track<T>): T {
  return tr.keys[tr.keys.length - 1]!.v;
}

export function lastT<T>(tr: Track<T>): number {
  return tr.keys[tr.keys.length - 1]!.t;
}

export function applyEase(k: number, ease: Ease): number {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  switch (ease) {
    case "linear":
      return t;
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "easeInOut":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "hold":
      return t < 1 ? 0 : 1;
  }
}

/** 找到 t 所在区间：返回 [a, b, 插值系数]。 */
function locate<T>(tr: Track<T>, t: number): { a: T; b: T; k: number } {
  const ks = tr.keys;
  if (t <= ks[0]!.t) return { a: ks[0]!.v, b: ks[0]!.v, k: 0 };
  const lastKey = ks[ks.length - 1]!;
  if (t >= lastKey.t) return { a: lastKey.v, b: lastKey.v, k: 0 };
  // 最后一个 t_i ≤ t 的键
  let lo = 0;
  let hi = ks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ks[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = ks[lo]!;
  const b = ks[lo + 1]!;
  const span = b.t - a.t;
  if (span <= 0) return { a: b.v, b: b.v, k: 0 };
  return { a: a.v, b: b.v, k: applyEase((t - a.t) / span, a.ease) };
}

/** 取样：lerp(a, b, k)。k = 0 时直接返回 a（不调 lerp），省掉静止段的分配。 */
export function valueAt<T>(tr: Track<T>, t: number, lerp: (a: T, b: T, k: number) => T): T {
  const { a, b, k } = locate(tr, t);
  if (k <= 0 || a === b) return a;
  return lerp(a, b, k);
}

export const lerpNum = (a: number, b: number, k: number): number => a + (b - a) * k;

export function numAt(tr: Track<number>, t: number): number {
  return valueAt(tr, t, lerpNum);
}
