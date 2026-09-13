/**
 * IR 上的纯辅助函数。
 *
 * 这些本来住在 `ir.ts` 里，但那个文件顶层 `import zod` —— 任何运行时引用
 * 都会把 zod 拖进 bundle。播放路径需要这些函数却不需要 schema，
 * 所以单独放一个零依赖文件（见 `core.ts` 的说明）。
 *
 * 只依赖类型，不依赖任何运行时值。
 */
import type { ContainerId } from "./vocab.ts";
import type { RecipeIR, Step } from "./ir.ts";

/** 步骤引用到的容器集合 —— 编译器据此隐式创建容器。 */
export function containersUsed(ir: RecipeIR): Set<ContainerId> {
  const out = new Set<ContainerId>();
  for (const s of ir.steps) {
    if ("target" in s) out.add(s.target);
    if ("from" in s) out.add(s.from);
    if ("to" in s) out.add(s.to);
  }
  return out;
}

/** 某步骤引用的原料 slot（统一 items / material 两种写法）。 */
export function slotsReferenced(s: Step): string[] {
  const out: string[] = [];
  if ("items" in s && s.items) out.push(...s.items);
  if ("material" in s && s.material) out.push(s.material);
  return out;
}
