// shaker-api：调酒社区后端。
//
// 启动顺序：迁移（goose 内嵌）→ 种子导入（词表为空时）→ HTTP 服务。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kafsaki/shaker/apps/api/db"
	"github.com/kafsaki/shaker/apps/api/internal/api"
	"github.com/kafsaki/shaker/apps/api/internal/config"
	"github.com/kafsaki/shaker/apps/api/internal/seed"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("数据库连接失败", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := db.Migrate(pool); err != nil {
		slog.Error("迁移失败", "err", err)
		os.Exit(1)
	}
	slog.Info("迁移完成")

	if cfg.Seed {
		if err := seed.Run(ctx, pool); err != nil {
			slog.Error("种子导入失败", "err", err)
			os.Exit(1)
		}
		slog.Info("种子导入完成（幂等）")
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.New(pool, cfg),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("shaker-api 监听中", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP 服务异常退出", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("优雅停机超时", "err", err)
	}
}
