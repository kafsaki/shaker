/**
 * 液流物理（ADR-031）：编排期用它把出液口放到「液柱正好落进目标」的位置，
 * 取样期用同一套公式画液柱 —— 两边一份公式，不会对不上。
 *
 * 抛体运动：出口处水平速度 vx、竖直初速 VY0（向下），重力 G。
 *   x(a) = x0 + vx·a        y(a) = y0 + VY0·a + ½·G·a²
 * 所以液柱**出口段偏横、越往下越竖直**（x ∝ √y）。旧版画成 x ∝ t²，正好反了 ——
 * 越往下越往外飘，这就是「出戏」的来源。
 *
 * 重力不按真实值（19600 单位/s²）：真实的液柱在舞台尺度上一闪就落地，看不出前缘
 * 下落、收手时尾巴脱落。取 2400，液柱前缘落 100 单位约 0.27 秒。
 */
export const G = 2400;
/** 出口竖直初速（向下）：液体不是从静止开始落，而是被倾倒推出来的。 */
export const VY0 = 40;

/** 从出口下落 H 到达落点所需时间（秒）。 */
export function fallTime(H: number): number {
  if (H <= 0) return 0;
  // ½G a² + VY0 a − H = 0
  return (-VY0 + Math.sqrt(VY0 * VY0 + 2 * G * H)) / G;
}

export function yAtAge(y0: number, a: number): number {
  return y0 + VY0 * a + 0.5 * G * a * a;
}

/** y 处对应的液滴年龄（yAtAge 的反函数）。 */
export function ageAtY(y0: number, y: number): number {
  return fallTime(y - y0);
}

/**
 * 编排用：出液口在 lipY、落点在 landY、水平速度 vx（带方向）时，
 * 要让液柱落在 targetX，出液口的 x 该在哪。
 */
export function lipXFor(targetX: number, lipY: number, landY: number, vx: number): number {
  return targetX - vx * fallTime(landY - lipY);
}
