/**
 * 封面按主题取图：配方封面存暗/亮两套（cover-dark / cover-light 固定键）。
 * 亮色主题优先取亮色版本，缺失则回落暗色版本（反之亦然）——
 * 双版本是后加的，早期配方可能只有暗色封面。
 */
export function useCover() {
  const { theme } = useTheme();

  /** 单张封面。 */
  function pickCover(dark?: string | null, light?: string | null): string {
    return (theme.value === "light" ? (light ?? dark) : (dark ?? light)) ?? "";
  }

  /** 封面列表（酒单堆叠）：整组按主题切换，空组回落另一版本。 */
  function pickCovers(
    dark?: string[] | null,
    light?: string[] | null,
  ): string[] {
    const d = dark ?? [];
    const l = light ?? [];
    if (theme.value === "light") return l.length ? l : d;
    return d.length ? d : l;
  }

  return { pickCover, pickCovers };
}