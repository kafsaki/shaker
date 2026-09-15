export type Theme = "dark" | "light";

/**
 * 主题（默认暗——呼应动画原型的暗调吧台）。
 * 持久化在 localStorage，应用方式是 html 上的 .dark class（Tailwind v4 自定义变体）。
 */
export function useTheme() {
  const theme = useState<Theme>("shaker-theme", () => "dark");

  function apply(t: Theme): void {
    document.documentElement.classList.toggle("dark", t === "dark");
    localStorage.setItem("shaker_theme", t);
  }

  function initTheme(): void {
    const saved = localStorage.getItem("shaker_theme");
    if (saved === "light" || saved === "dark") theme.value = saved;
    apply(theme.value);
  }

  function toggleTheme(): void {
    theme.value = theme.value === "dark" ? "light" : "dark";
    apply(theme.value);
  }

  return { theme, initTheme, toggleTheme };
}
