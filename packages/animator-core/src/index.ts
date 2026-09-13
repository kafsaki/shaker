/**
 * @shaker/animator-core —— IR → Timeline 编译器。
 *
 * **零渲染依赖。** tsconfig 的 lib 只给 ES2023 不给 DOM，
 * 从类型层面强制这条纪律（ADR-004/005 的全部灵活性建立在它之上）。
 *
 * 绘制后端（animator-web / 未来的 animator-skia）消费 Timeline，
 * 但本包不知道它们存在。
 */
export * from "./types.ts";
export * from "./compile.ts";
export * from "./sample.ts";
export { stepLabel, type Lang } from "./labels.ts";
export type { ContainerState, LiquidLayer, SolidIce } from "./state.ts";
