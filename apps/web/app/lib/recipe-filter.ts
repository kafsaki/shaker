/**
 * 配方筛选状态：搜索结果页与「探索」页共用（对应后端 filterConds 的同名参数）。
 * 数值区间用滑块，滑到两端即「不限」——此时不往后端发该参数，
 * 避免把未来超出现有范围的配方永久过滤掉。
 */
import type { LocationQuery } from "vue-router";

export type SortKey = "relevance" | "hot" | "new";

/** "" 不限 | original 原创 | canonical 权威（IBA 经典） */
export type OriginKey = "" | "original" | "canonical";

/** 酒精度滑块上限（%）：滑到上限 = 不限。现有数据 6~45.5。 */
export const ABV_MAX = 50;
/** 容量滑块上限（ml）：滑到上限 = 不限。现有数据 30~276。 */
export const VOLUME_MAX = 400;

export interface RecipeFilterState {
  family: string;
  method: string;
  glass: string;
  /** 多选，OR 语义：命中任一标签（与后端 tag 参数一致） */
  tags: string[];
  /** "" 不限 | original 原创 | canonical 权威（IBA 经典） */
  origin: OriginKey;
  /** relevance | hot | new（探索页用 Tab 表达热度/时间，不用这个） */
  sort: SortKey;
  abvMin: number;
  abvMax: number;
  volumeMin: number;
  volumeMax: number;
  /** 0 = 不限，1..5 = 难度不高于 N 星 */
  difficultyMax: number;
}

export function defaultFilter(): RecipeFilterState {
  return {
    family: "all",
    method: "all",
    glass: "all",
    tags: [],
    origin: "",
    sort: "relevance",
    abvMin: 0,
    abvMax: ABV_MAX,
    volumeMin: 0,
    volumeMax: VOLUME_MAX,
    difficultyMax: 0,
  };
}

function asNum(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function asStr(v: unknown, dflt: string): string {
  return typeof v === "string" && v ? v : dflt;
}

/** 重复的 tag 参数在地址栏里是数组，单个则是字符串，统一成非空字符串数组。 */
function asTags(v: unknown): string[] {
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string" && x !== "");
  }
  return [];
}

/** 从地址栏还原（用于直链分享 / 刷新复现）。 */
export function filterFromQuery(q: LocationQuery): RecipeFilterState {
  const d = defaultFilter();
  const sort = q.sort;
  return {
    family: asStr(q.family, d.family),
    method: asStr(q.method, d.method),
    glass: asStr(q.glass, d.glass),
    tags: asTags(q.tag),
    origin: q.origin === "original" || q.origin === "canonical" ? (q.origin as OriginKey) : "",
    sort: sort === "hot" || sort === "new" ? sort : "relevance",
    abvMin: asNum(q.abvMin, d.abvMin),
    abvMax: asNum(q.abvMax, d.abvMax),
    volumeMin: asNum(q.volumeMin, d.volumeMin),
    volumeMax: asNum(q.volumeMax, d.volumeMax),
    difficultyMax: asNum(q.difficultyMax, d.difficultyMax),
  };
}

/** 有生效的筛选（三档下拉都不算「全部」、区间滑动过、难度选了星）。 */
export function isFilterActive(f: RecipeFilterState, withSort = false): boolean {
  return (
    f.family !== "all" ||
    f.method !== "all" ||
    f.glass !== "all" ||
    f.tags.length > 0 ||
    f.origin !== "" ||
    f.difficultyMax > 0 ||
    f.abvMin > 0 ||
    f.abvMax < ABV_MAX ||
    f.volumeMin > 0 ||
    f.volumeMax < VOLUME_MAX ||
    (withSort && f.sort !== "relevance")
  );
}

/** 非默认项写回地址栏（标量都是字符串、多选标签是重复参数，便于 URL 分享）。 */
export function filterToQuery(f: RecipeFilterState): Record<string, string | string[]> {
  return {
    ...(f.family !== "all" ? { family: f.family } : {}),
    ...(f.method !== "all" ? { method: f.method } : {}),
    ...(f.glass !== "all" ? { glass: f.glass } : {}),
    ...(f.tags.length ? { tag: [...f.tags] } : {}),
    ...(f.origin ? { origin: f.origin } : {}),
    ...(f.sort !== "relevance" ? { sort: f.sort } : {}),
    ...(f.abvMin > 0 ? { abvMin: String(f.abvMin) } : {}),
    ...(f.abvMax < ABV_MAX ? { abvMax: String(f.abvMax) } : {}),
    ...(f.volumeMin > 0 ? { volumeMin: String(f.volumeMin) } : {}),
    ...(f.volumeMax < VOLUME_MAX ? { volumeMax: String(f.volumeMax) } : {}),
    ...(f.difficultyMax > 0 ? { difficultyMax: String(f.difficultyMax) } : {}),
  };
}

/** 传给 /search 或 /feed/* 的查询参数（不限的项省略）。 */
export interface RecipeFilterParams {
  family?: string;
  method?: string;
  glass?: string;
  /** 重复传参，OR 语义 */
  tag?: string[];
  origin?: "original" | "canonical";
  abvMin?: number;
  abvMax?: number;
  volumeMin?: number;
  volumeMax?: number;
  difficultyMax?: number;
}

export function filterToParams(f: RecipeFilterState): RecipeFilterParams {
  return {
    ...(f.family !== "all" ? { family: f.family } : {}),
    ...(f.method !== "all" ? { method: f.method } : {}),
    ...(f.glass !== "all" ? { glass: f.glass } : {}),
    ...(f.tags.length ? { tag: [...f.tags] } : {}),
    ...(f.origin ? { origin: f.origin } : {}),
    ...(f.abvMin > 0 ? { abvMin: f.abvMin } : {}),
    ...(f.abvMax < ABV_MAX ? { abvMax: f.abvMax } : {}),
    ...(f.volumeMin > 0 ? { volumeMin: f.volumeMin } : {}),
    ...(f.volumeMax < VOLUME_MAX ? { volumeMax: f.volumeMax } : {}),
    ...(f.difficultyMax > 0 ? { difficultyMax: f.difficultyMax } : {}),
  };
}

/** queryKey 片段：是个稳定字符串，避免把数组/对象塞进 key。 */
export function filterKey(f: RecipeFilterState, withSort = false): string {
  return [
    f.family,
    f.method,
    f.glass,
    // 排序后再拼，避免勾选顺序不同造成同一个结果集命中不同缓存
    [...f.tags].sort().join(","),
    f.origin,
    f.abvMin,
    f.abvMax,
    f.volumeMin,
    f.volumeMax,
    f.difficultyMax,
    withSort ? f.sort : "",
  ].join("|");
}