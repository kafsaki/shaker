// Package db 管理连接池与内嵌迁移。
//
// 迁移文件就放在本包的 migrations/ 目录下（README 里的 goose -dir 路径不变），
// 这样 go:embed 能直接引用——embed 不允许向上级目录走。
package db

import (
	"context"
	"embed"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Connect 建立连接池并等待数据库就绪（docker compose 里的 pg 可能慢半拍）。
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("解析数据库连接串: %w", err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		err = pool.Ping(pingCtx)
		cancel()
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			pool.Close()
			return nil, fmt.Errorf("等待数据库就绪超时: %w", err)
		}
		time.Sleep(500 * time.Millisecond)
	}
	return pool, nil
}

// Migrate 以内嵌迁移文件执行 goose up。幂等，可随启动反复执行。
func Migrate(pool *pgxpool.Pool) error {
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close() // 不会关掉底层 pool

	goose.SetBaseFS(migrationsFS)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("设置 goose 方言: %w", err)
	}
	if err := goose.Up(sqlDB, "migrations"); err != nil {
		return fmt.Errorf("执行迁移: %w", err)
	}
	return nil
}
