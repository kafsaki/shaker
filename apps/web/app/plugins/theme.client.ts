export default defineNuxtPlugin(() => {
  const { initTheme } = useTheme();
  const { initPrefs } = usePrefs();
  initTheme();
  initPrefs();
});
