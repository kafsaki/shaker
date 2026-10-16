/**
 * @shaker/animator-core —— IR → Timeline 编译器 + 取样器。纯 TS，零渲染依赖。
 */
export * from "./types.ts";
export { compile, WORK_VESSEL_IDS, WORK_VESSELS } from "./compile.ts";
export { sample, stepAt, particlesAt, lifeOf, applyEase, vesselPoseAt, PARTICLE_LIFE_MS, type SampleResult, type Particle } from "./sample.ts";
export { radiusAtV, rimRadius, toWorld, toLocal, pourLip, type Frame } from "./geometry.ts";
export { hash01 } from "./random.ts";
export { stepLabel, type Lang } from "./labels.ts";
