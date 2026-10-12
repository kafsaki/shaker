package media

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

// orphanBatch 单轮清理的条数上限。定时任务每轮只处理一批，
// 避免首次上线时一次性扫掉大量积压把对象存储打满。
const orphanBatch = 500

// CleanupResult 一轮清理的结果。
type CleanupResult struct {
	Scanned int // 命中的过期 pending 记录数
	Deleted int // 对象与记录都清掉的条数
	Failed  int // 对象删除失败、留待下轮重试的条数
}

// CleanupOrphans 清理超过 ttl 仍未 commit 的孤儿媒体：先删对象，再删记录。
//
// 顺序不可颠倒——先删记录而对象删除失败的话，那个对象就再无线索指向它，
// 永远留在桶里；反过来只是留一行记录，下一轮重试即可。
// 记录侧再带一次 committed_at IS NULL 条件：万一客户端在本轮取数之后、
// 删记录之前完成 commit，记录会留下（对象已被删，但这在 TTL ≫ PresignTTL
// 的前提下不可能发生：预签名 15 分钟就失效，客户端传不上去）。
func (s *Store) CleanupOrphans(ctx context.Context, ttl time.Duration) (CleanupResult, error) {
	var res CleanupResult

	rows, err := s.pool.Query(ctx, `
		SELECT id, storage_key FROM media_assets
		WHERE committed_at IS NULL AND created_at < $1
		ORDER BY created_at
		LIMIT $2`, time.Now().Add(-ttl), orphanBatch)
	if err != nil {
		return res, fmt.Errorf("查询孤儿媒体: %w", err)
	}
	type orphan struct {
		id  uuid.UUID
		key string
	}
	var found []orphan
	for rows.Next() {
		var o orphan
		if err := rows.Scan(&o.id, &o.key); err != nil {
			rows.Close()
			return res, fmt.Errorf("扫描孤儿媒体: %w", err)
		}
		found = append(found, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return res, fmt.Errorf("遍历孤儿媒体: %w", err)
	}
	res.Scanned = len(found)

	for _, o := range found {
		// S3 DELETE 幂等：对象不存在也返回成功，无需先 HEAD 判存在。
		if _, err := s.s3.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(s.bucket), Key: aws.String(o.key),
		}); err != nil {
			res.Failed++
			slog.Warn("删除孤儿对象失败", "key", o.key, "err", err)
			continue
		}
		if _, err := s.pool.Exec(ctx,
			`DELETE FROM media_assets WHERE id = $1 AND committed_at IS NULL`, o.id); err != nil {
			res.Failed++
			slog.Warn("删除孤儿记录失败", "key", o.key, "err", err)
			continue
		}
		res.Deleted++
	}
	return res, nil
}

// RunCleanupLoop 周期清理孤儿媒体：启动时先跑一次，之后每隔 interval 重复。
// interval <= 0 时直接返回（由调用方决定是否启用）。
// 单实例下进程内定时任务即可，不必为它引入队列（ADR-003）。
func (s *Store) RunCleanupLoop(ctx context.Context, interval, ttl time.Duration) {
	if interval <= 0 {
		return
	}
	runOnce := func() {
		// 单轮超时兜底：清理卡住不该拖住整个进程
		runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		res, err := s.CleanupOrphans(runCtx, ttl)
		if err != nil {
			slog.Error("孤儿媒体清理失败", "err", err)
			return
		}
		if res.Deleted > 0 || res.Failed > 0 {
			slog.Info("孤儿媒体清理完成",
				"deleted", res.Deleted, "failed", res.Failed, "scanned", res.Scanned)
		}
	}

	if ctx.Err() == nil {
		runOnce()
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOnce()
		}
	}
}
