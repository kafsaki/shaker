/**
 * @shaker/visual-assets —— 视觉素材的唯一来源。
 *
 * 素材维护纪律：
 *   - 素材 = 纯数据（字符画 / 剖面点列），只允许改这个包；
 *   - 渲染画法（drawXxx 函数、粒子、液流）在 animator-web，不是素材；
 *   - 新增/修改素材走 GitHub PR，评审时字符画肉眼审、剖面物理外观一起审；
 *   - 本包只 import @shaker/recipe-ir/core 的类型与剖面辅助函数，不依赖动画器。
 */
export * from "./registry.ts";
