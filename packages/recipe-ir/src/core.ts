/**
 * `@shaker/recipe-ir/core` —— **零 zod 运行时依赖**的核心子集。
 *
 * 为什么单独开一个入口：`index.ts` 的 barrel 导出会无条件把 zod 拉进 bundle
 * （`export * from "./ir.ts"`），实测让只读播放路径多出约 107 KB gzip。
 * 而配方浏览页只需要编译动画 + 绘制，不需要校验能力 —— 不该为编辑器付这个体积。
 *
 * 规则：
 *   - **播放/渲染路径**（animator-core、animator-web、配方详情页）→ 引 `/core`
 *   - **编辑器与后端校验**（需要 zod schema、parse、safeParse）→ 引根入口
 *
 * 这里只导出运行时零 zod 的模块；IR 与词表的**类型**可以照常导出（`import type` 会被擦除）。
 */

/* ── 运行时：纯数学，零 zod ── */
export * from "./glass.ts";
export * from "./color.ts";
export * from "./units.ts";
export * from "./validate.ts";
export * from "./ir-utils.ts";
export * as physics from "./physics.ts";

/* ── 纯类型：来自 zod 推导，但 import type 在运行时被擦除 ── */
export type {
  Action,
  ChillMethod,
  ContainerId,
  Family,
  FlameSubject,
  FloatTechnique,
  GarnishPosition,
  GarnishPrep,
  I18nText,
  IbaCategory,
  IceType,
  IngredientCategory,
  Method,
  MuddleIntensity,
  PourStyle,
  RimCoverage,
  Role,
  ShakeIntensity,
  SmokeMethod,
  Strainer,
  Texture,
  Unit,
  Viscosity,
  WaitReason,
} from "./vocab.ts";

export type { IngredientRef, RecipeIR, Step } from "./ir.ts";

/*
 * 故意**不**从这里导出 ACTIONS / UNITS 之类的常量数组：
 * 它们住在 vocab.ts，而那个文件顶层 import zod —— re-export 会把 zod 拖回来。
 * 播放路径目前不需要它们；真需要时再把纯数组拆成独立文件。
 */
