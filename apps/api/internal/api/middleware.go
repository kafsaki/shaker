package api

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/netip"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
)

// huma 中间件链（对全部 operation 生效，按序执行）：
//
//  1. 请求信息注入：把 RemoteAddr / User-Agent 塞进 context
//     （huma handler 只拿得到 context.Context，拿不到原始请求）
//  2. 认证：Bearer 存在则解析；无效直接 401。不强制 —— 是否需要登录由各 handler 决定
//  3. 限流：敏感路径按 IP；写操作按用户（API 定义 §4），发布单独收紧到 10 次/小时
//
// v1 单实例直连，RemoteAddr 即客户端地址；上反代后需改读 X-Forwarded-For。

type ctxKey string

const (
	ctxClaims ctxKey = "authClaims"
	ctxIP     ctxKey = "clientIP"
	ctxUA     ctxKey = "userAgent"
)

func (a *API) middleware(ctx huma.Context, next func(huma.Context)) {
	// 1. 请求信息
	hc := huma.WithValue(ctx, ctxIP, ipOf(ctx.RemoteAddr()))
	hc = huma.WithValue(hc, ctxUA, ctx.Header("User-Agent"))

	// 2. 认证（可选）—— 先于限流解析：写操作按用户计数需要身份
	var claims *auth.Claims
	if bearer, ok := bearerOf(ctx.Header("Authorization")); ok {
		c, err := a.tokens.ParseAccessToken(bearer)
		if err != nil {
			writeJSONError(hc, newErr(http.StatusUnauthorized, "auth.token_invalid", auth.ErrTokenInvalid.Error()))
			return
		}
		claims = c
		hc = huma.WithValue(hc, ctxClaims, c)
	}

	// 3. 限流
	if !a.allow(ctx, claims) {
		writeJSONError(hc, newErr(http.StatusTooManyRequests, "rate_limited",
			messageForStatus(http.StatusTooManyRequests)))
		return
	}
	next(hc)
}

// allow 限流判定。返回 false 时中间件直接写 429。
func (a *API) allow(ctx huma.Context, claims *auth.Claims) bool {
	ip := ipOf(ctx.RemoteAddr()).String()
	if l, ok := a.limiters[ctx.URL().Path]; ok && !l.Allow(ip) {
		return false // 认证类敏感端点：按 IP
	}

	m := ctx.Method()
	if m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions {
		return true
	}
	// 写操作：认证按用户、匿名按 IP
	key := ip
	if claims != nil {
		key = claims.UserUUID().String()
	}
	if !a.writeLimiter.Allow(key) {
		return false
	}
	// 发布动作单独收紧（每用户 10 次/小时，API 定义 §4）
	if m == http.MethodPost && isPublishPath(ctx.URL().Path) && !a.publishLimiter.Allow(key) {
		return false
	}
	return true
}

// isPublishPath 匹配 /api/v1/recipes/{id}/publish（id 是变化的 UUID）。
func isPublishPath(path string) bool {
	const prefix, suffix = "/api/v1/recipes/", "/publish"
	return strings.HasPrefix(path, prefix) && strings.HasSuffix(path, suffix) &&
		len(path) > len(prefix)+len(suffix)
}

// bearerOf 解析 "Bearer <token>" 头。
func bearerOf(h string) (string, bool) {
	const prefix = "Bearer "
	if len(h) > len(prefix) && h[:len(prefix)] == prefix {
		return h[len(prefix):], true
	}
	return "", false
}

// ipOf 从 RemoteAddr 提取 IP（去掉端口）。解析失败返回无效 Addr（零值）。
func ipOf(remote string) netip.Addr {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	ip, _ := netip.ParseAddr(host)
	return ip
}

// requireClaims 从 context 取当前用户，未认证返回 401 错误。
func requireClaims(ctx context.Context) (*auth.Claims, huma.StatusError) {
	if c, ok := ctx.Value(ctxClaims).(*auth.Claims); ok && c != nil {
		return c, nil
	}
	return nil, newErr(http.StatusUnauthorized, "auth.unauthorized", messageForStatus(http.StatusUnauthorized))
}

// ctxIPAddr / ctxUserAgent 供 handler 读取中间件注入的请求信息。
func ctxIPAddr(ctx context.Context) *netip.Addr {
	if v, ok := ctx.Value(ctxIP).(netip.Addr); ok && v.IsValid() {
		return &v
	}
	return nil
}

func ctxUserAgent(ctx context.Context) string {
	if v, ok := ctx.Value(ctxUA).(string); ok {
		return v
	}
	return ""
}

// writeJSONError 在中间件里直接写错误响应（handler 外没有 huma 的序列化通道）。
func writeJSONError(ctx huma.Context, e huma.StatusError) {
	ctx.SetHeader("Content-Type", "application/json; charset=utf-8")
	ctx.SetStatus(e.GetStatus())
	_ = json.NewEncoder(ctx.BodyWriter()).Encode(e)
}
