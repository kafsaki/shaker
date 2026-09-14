// Package api 组装 HTTP 层：chi 路由 + huma（OpenAPI code-first）+ 中间件。
package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

// API 持有 HTTP 层的全部依赖。
type API struct {
	Pool *pgxpool.Pool
}

// New 构建 chi 路由。所有业务路由由各 handler 文件里的 register* 注册。
func New(pool *pgxpool.Pool) *chi.Mux {
	r := chi.NewMux()
	r.Use(middleware.RequestID)
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)

	api := humachi.New(r, huma.DefaultConfig("shaker", "0.1.0"))

	registerHealth(api)
	return r
}

func registerHealth(api huma.API) {
	type healthReq struct{}
	huma.Register(api, huma.Operation{
		OperationID: "health",
		Method:      http.MethodGet,
		Path:        "/healthz",
		Summary:     "存活探针",
	}, func(ctx context.Context, _ *healthReq) (*HealthResp, error) {
		return &HealthResp{Body: struct{}{}}, nil
	})
}

type HealthResp struct {
	Body struct{} `json:"-"`
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		if r.URL.Path == "/healthz" {
			return // 探针不打日志，避免刷屏
		}
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"ms", time.Since(start).Milliseconds(),
			"req_id", middleware.GetReqID(r.Context()),
		)
	})
}
