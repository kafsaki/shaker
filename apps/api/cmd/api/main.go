// shaker-api：调酒社区后端。
//
// 启动顺序：迁移（goose 内嵌）→ 种子导入（每次全量 upsert，SHAKER_SEED=false 跳过）→ HTTP 服务。
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
	"github.com/kafsaki/shaker/apps/api/internal/media"
	"github.com/kafsaki/shaker/apps/api/internal/seed"
	"github.com/kafsaki/shaker/apps/api/internal/wiki"
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

	// 百科管理员从部署配置来（ADR-027）；之后的编辑身份由管理员在站内授予
	if len(cfg.AdminHandles) > 0 {
		missing, err := wiki.NewStore(pool).PromoteAdmins(ctx, cfg.AdminHandles)
		if err != nil {
			slog.Error("提升百科管理员失败", "err", err)
			os.Exit(1)
		}
		if len(missing) > 0 {
			slog.Warn("SHAKER_ADMIN_HANDLES 中有账号不存在，注册后重启即可生效", "handles", missing)
		}
	}

	// 孤儿媒体清理。单独建一个 media.Store：handler 侧那个藏在 api 包内部，
	// 而定时任务只需要 连接池 + S3 客户端，没必要为此改 api.New 的签名。
	go media.NewStore(pool, cfg).RunCleanupLoop(ctx, cfg.MediaCleanupInterval, cfg.MediaOrphanTTL)

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
