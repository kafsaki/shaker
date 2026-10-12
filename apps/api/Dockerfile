# 迁移 SQL、种子 JSON、IR schema 全部 go:embed 进二进制 —— 运行阶段不带任何文件，
# 所以最终镜像只需一个静态二进制。
FROM golang:1.27-alpine AS build
WORKDIR /src

# 依赖清单单独一层：改业务代码不必重下模块
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.21
# ca-certificates：访问 HTTPS 对象存储要用；tzdata：日志时间戳按 TZ 走
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -H -u 10001 shaker
COPY --from=build /out/api /usr/local/bin/api
USER shaker
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api"]
