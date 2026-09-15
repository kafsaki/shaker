export default defineNuxtPlugin(async () => {
  // 应用挂载前恢复会话：避免"刷新页面闪一下未登录态"。
  const auth = useAuthStore();
  await auth.restoreSession();
});
