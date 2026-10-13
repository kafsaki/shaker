// Package config 从环境变量读取配置。开发环境全部有默认值，零配置可跑。
package config

import (
	"log/slog"
	"os"
	"strings"
	"time"
)

type Config struct {
	Addr        string
	DatabaseURL string
	JWTSecret   []byte
	S3Endpoint  string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	// S3PresignEndpoint 是签发给浏览器的预签名 URL 所用的地址，必须是浏览器可达的
	// 公网地址（部署时经反代指向 MinIO）。SigV4 签名覆盖 Host 头，所以这个字符串
	// 必须与浏览器实际请求的 host 完全一致。留空则与 S3Endpoint 相同（本地开发）。
	S3PresignEndpoint string
	// S3PublicURL 是对象存储的公网读地址（MinIO 已对桶开匿名下载）。
	S3PublicURL string
	// Seed 为 true 时每次启动都把 seed.json 全量 upsert 一遍（幂等）；false 跳过导入。
	Seed bool
	// MediaCleanupInterval 孤儿媒体清理的扫描间隔；0 表示关闭（如多实例部署时应关闭，
	// 避免每个实例各扫一遍）。默认 6h。
	MediaCleanupInterval time.Duration
	// MediaOrphanTTL 未 commit 的媒体记录保留多久后连对象一起清理。默认 24h，
	// 必须远大于 PresignTTL（15 分钟），否则会删掉正在上传的对象。
	MediaOrphanTTL time.Duration
	// AdminHandles 启动时提升为百科管理员的账号（逗号分隔，ADR-027）。管理员再在站内
	// 授予/撤销编辑身份；这里只负责「第一个管理员从哪来」。
	AdminHandles []string
	// LLM* 酒保助手（ADR-028）所用的 OpenAI 兼容模型服务。主备各自一套地址 + 模型 + 密钥，
	// 备用可以是另一家服务商。两套都没有密钥时助手关闭，接口返回 503。
	// 密钥只放环境变量，绝不进仓库、绝不下发前端。
	LLMBaseURL         string
	LLMModel           string
	LLMKeys            []string
	LLMFallbackBaseURL string
	LLMFallbackModel   string
	LLMFallbackKeys    []string
	LLMEffort          string
	LLMTimeout         time.Duration
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// envDuration 读时长配置（如 "6h" / "30m"）。解析失败时告警并退回默认值，
// 不让一个手误的配置把服务挡在启动之外。
func envDuration(key, def string) time.Duration {
	raw := env(key, def)
	d, err := time.ParseDuration(raw)
	if err != nil {
		slog.Warn("时长配置无法解析，改用默认值", "key", key, "value", raw, "default", def)
		d, _ = time.ParseDuration(def)
	}
	return d
}

// envList 读逗号分隔的列表，去掉空项与两端空白。
func envList(key string) []string {
	var out []string
	for _, v := range strings.Split(os.Getenv(key), ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func Load() Config {
	secret := env("SHAKER_JWT_SECRET", "shaker-dev-secret-change-me")
	if secret == "shaker-dev-secret-change-me" {
		slog.Warn("SHAKER_JWT_SECRET 未设置，使用开发默认值——生产环境必须显式配置")
	}
	return Config{
		Addr:        env("SHAKER_ADDR", ":8080"),
		DatabaseURL: env("SHAKER_DATABASE_URL", "postgres://shaker:shaker_dev@localhost:5432/shaker?sslmode=disable"),
		JWTSecret:   []byte(secret),
		S3Endpoint:  env("SHAKER_S3_ENDPOINT", "http://localhost:9000"),
		S3Bucket:    env("SHAKER_S3_BUCKET", "shaker-media"),
		S3AccessKey: env("SHAKER_S3_ACCESS_KEY", "shaker"),
		S3SecretKey: env("SHAKER_S3_SECRET_KEY", "shaker_dev_secret"),
		// 默认与 S3Endpoint 相同：本地开发时浏览器与 API 看到的是同一个地址
		S3PresignEndpoint: env("SHAKER_S3_PRESIGN_ENDPOINT", env("SHAKER_S3_ENDPOINT", "http://localhost:9000")),
		S3PublicURL:       env("SHAKER_S3_PUBLIC_URL", "http://localhost:9000/shaker-media"),
		Seed:              env("SHAKER_SEED", "true") == "true",

		MediaCleanupInterval: envDuration("SHAKER_MEDIA_CLEANUP_INTERVAL", "6h"),
		MediaOrphanTTL:       envDuration("SHAKER_MEDIA_ORPHAN_TTL", "24h"),
		AdminHandles:         envList("SHAKER_ADMIN_HANDLES"),

		LLMBaseURL: env("SHAKER_LLM_BASE_URL", "https://discovery-api.intern-ai.org.cn/v1"),
		LLMModel:   env("SHAKER_LLM_MODEL", "deepseek-v4-flash-0731"),
		LLMKeys:    envList("SHAKER_LLM_API_KEY"),
		// 备用端点：主端点失效/限流时接替；地址与模型不填则沿用主端点的
		LLMFallbackBaseURL: env("SHAKER_LLM_FALLBACK_BASE_URL", env("SHAKER_LLM_BASE_URL", "https://discovery-api.intern-ai.org.cn/v1")),
		LLMFallbackModel:   env("SHAKER_LLM_FALLBACK_MODEL", env("SHAKER_LLM_MODEL", "deepseek-v4-flash-0731")),
		LLMFallbackKeys:    envList("SHAKER_LLM_API_KEY_FALLBACK"),
		LLMEffort:          env("SHAKER_LLM_EFFORT", ""),
		LLMTimeout:         envDuration("SHAKER_LLM_TIMEOUT", "90s"),
	}
}
