# 构建上下文必须是仓库根（见 deploy/docker-compose.yml 的 context: ..）：
# Nuxt 应用直接消费 pnpm workspace 里的 packages/*（纯 TS，无需单独构建）。
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# 依赖单测装在整仓：pnpm --frozen-lockfile 要求 workspace 内所有清单与锁文件一致。
# 没做「先拷清单再拷源码」的分层缓存——v1 仓库小，先保证正确与易读。
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @shaker/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000
# nitro node-server 产物自带全部依赖，运行阶段不需要 node_modules
COPY --from=build /repo/apps/web/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
