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

	"github.com/kafsaki/shaker/apps/api/internal/auth"
	"github.com/kafsaki/shaker/apps/api/internal/config"
	"github.com/kafsaki/shaker/apps/api/internal/interact"
	"github.com/kafsaki/shaker/apps/api/internal/menu"
	"github.com/kafsaki/shaker/apps/api/internal/ratelimit"
	"github.com/kafsaki/shaker/apps/api/internal/recipe"
	"github.com/kafsaki/shaker/apps/api/internal/user"
	"github.com/kafsaki/shaker/apps/api/internal/vocab"
)

// API 持有 HTTP 层的全部依赖。
type API struct {
	cfg    config.Config
	pool   *pgxpool.Pool
	tokens *auth.TokenManager
	auth   *auth.Service
	vocab  *vocab.Store
	recipes *recipe.Store
	interact *interact.Store
	users  *user.Store
	menus  *menu.Store
	// limiters 路径 → 限流器。敏感端点按 IP 计数。
	limiters map[string]*ratelimit.Limiter
	// writeLimiter 全部写操作（API 定义 §4：每用户 60 次/分钟）。
	writeLimiter *ratelimit.Limiter
	// publishLimiter 发布动作单独收紧（每用户 10 次/小时）。
	publishLimiter *ratelimit.Limiter
}

// New 构建 chi 路由。所有业务路由由各 handler 文件里的 register* 注册。
func New(pool *pgxpool.Pool, cfg config.Config) *chi.Mux {
	r, _ := setupRouter(pool, cfg)
	return r
}

// setupRouter 组装路由 + huma 实例。pool 可为 nil —— gen-openapi 只生成
// 文档不连库，store 构造不碰连接，handler 不会被调用。
func setupRouter(pool *pgxpool.Pool, cfg config.Config) (*chi.Mux, huma.API) {
	r := chi.NewMux()
	r.Use(middleware.RequestID)
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)

	installErrorFormat()

	api := humachi.New(r, huma.DefaultConfig("shaker", "0.1.0"))
	api.OpenAPI().Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearerAuth": {Type: "http", Scheme: "bearer", BearerFormat: "JWT"},
	}

	a := &API{
		cfg:    cfg,
		pool:   pool,
		tokens: auth.NewTokenManager(cfg.JWTSecret),
	}
	a.auth = auth.NewService(pool, a.tokens)
	a.vocab = vocab.NewStore(pool)
	a.recipes = recipe.NewStore(pool)
	a.interact = interact.NewStore(pool)
	a.users = user.NewStore(pool)
	a.menus = menu.NewStore(pool)
	a.limiters = map[string]*ratelimit.Limiter{
		// 认证端点按 IP 限流：登录防撞库、注册防批量、刷新防穷举、改密防试旧密码
		"/api/v1/auth/login":    ratelimit.New(10, time.Minute),
		"/api/v1/auth/register": ratelimit.New(5, time.Hour),
		"/api/v1/auth/refresh":  ratelimit.New(30, time.Minute),
		"/api/v1/me/password":   ratelimit.New(5, time.Hour),
	}
	a.writeLimiter = ratelimit.New(60, time.Minute)
	a.publishLimiter = ratelimit.New(10, time.Hour)

	api.UseMiddleware(a.middleware)

	registerHealth(api)
	a.registerAuth(api)
	a.registerMe(api)
	a.registerVocab(api)
	a.registerRecipes(api)
	a.registerFeed(api)
	a.registerInteract(api)
	a.registerUsers(api)
	a.registerSearch(api)
	a.registerClassics(api)
	a.registerMenus(api)
	return r, api
}

// GenOpenAPI 输出 OpenAPI 3.1 YAML。schema/openapi.yaml 的唯一来源（ADR-017：
// code-first，禁止手改），由 cmd/gen-openapi 调用。
func GenOpenAPI() ([]byte, error) {
	_, api := setupRouter(nil, config.Config{JWTSecret: []byte("gen-only")})
	return api.OpenAPI().YAML()
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
