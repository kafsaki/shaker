/**
 * @shaker/recipe-ir —— 配方 IR 的唯一真相源。
 *
 * **零 UI 依赖，零渲染依赖。** tsconfig 里 lib 只给 ES2023 不给 DOM，
 * 从类型层面强制这条纪律（ADR-004/005 的全部灵活性都建立在它之上）。
 */

export * from "./vocab.ts";
export * from "./ir.ts";
export * from "./ir-utils.ts";
export * from "./units.ts";
export * from "./color.ts";
export * from "./glass.ts";
export * from "./validate.ts";
export * as physics from "./physics.ts";
