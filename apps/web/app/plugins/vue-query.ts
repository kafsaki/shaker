import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

// 全局默认：写操作由调用方按需关 retry；读操作失败轻试一次。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VueQueryPlugin, { queryClient });
});
