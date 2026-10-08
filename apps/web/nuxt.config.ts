import tailwindcss from "@tailwindcss/vite";

// Nuxt 4 SPA（ADR-007 v1 本地优先，无 SEO 部署压力；将来开 SSR 只动数据层）。
// dev 由 nitro devProxy 把 /api 转发到 Go API（:8080），生产走同域反代。
export default defineNuxtConfig({
  compatibilityDate: "2026-09-15",
  devtools: { enabled: true },
  ssr: false,

  modules: ["@pinia/nuxt"],

  // 只扫 .vue：shadcn-vue 的每个 ui/<name>/ 都带 index.ts barrel（具名导出 +
  // buttonVariants 之类的非组件导出），Nuxt 默认把 .ts 也当候选组件，
  // 于是 ui/button/index.ts 与 ui/button/Button.vue 都命名成 UiButton 而告警 24 条。
  // barrel 只做入口，不参与组件注册，限定扩展名后自动导入形态不变。
  components: [{ path: "~/components", extensions: ["vue"] }],

  css: ["~/assets/css/main.css"],

  vite: {
    plugins: [tailwindcss()],
  },

  nitro: {
    devProxy: {
      "/api": {
        target: "http://localhost:8080/api",
        changeOrigin: true,
      },
    },
  },

  app: {
    head: {
      title: "Shaker · 调酒社区",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
      ],
    },
  },
})
