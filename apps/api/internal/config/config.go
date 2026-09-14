// Package config 从环境变量读取配置。开发环境全部有默认值，零配置可跑。
package config

import (
	"log/slog"
	"os"
)

type Config struct {
	Addr        string
	DatabaseURL string
	JWTSecret   []byte
	S3Endpoint  string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	// S3PublicURL 是对象存储的公网读地址（MinIO 已对桶开匿名下载）。
	S3PublicURL string
	// Seed 为 true 时启动阶段做幂等种子导入（词表为空才导入）。
	Seed bool
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
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
		S3PublicURL: env("SHAKER_S3_PUBLIC_URL", "http://localhost:9000/shaker-media"),
		Seed:        env("SHAKER_SEED", "true") == "true",
	}
}
