// Package report 举报（API 定义 §2.11）。v1 只收单不接审核（ADR-007）：
// 写 reports 表留档，moderation_logs 等接入审核流再启用。
package report

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrBadEntity entityType 不在枚举里。
	ErrBadEntity = errors.New("举报对象类型不合法")
	// ErrNotFound 被举报的实体不存在。
	ErrNotFound = errors.New("举报对象不存在")
)

// Store 举报数据访问。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// entityTable entityType → 表名。固定映射，防注入。
var entityTable = map[string]string{
	"recipe":  "recipes",
	"comment": "comments",
	"user":    "users",
	"menu":    "menus",
}

// Create 提交举报。reason 自由文本（前端给常用理由选项，后端不枚举）。
func (s *Store) Create(ctx context.Context, reporterID uuid.UUID, entityType string, entityID uuid.UUID, reason string, detail *string) error {
	table, ok := entityTable[entityType]
	if !ok {
		return ErrBadEntity
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT EXISTS(SELECT 1 FROM %s WHERE id = $1 AND deleted_at IS NULL)`, table), entityID).Scan(&exists); err != nil {
		return fmt.Errorf("查询举报对象: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, detail)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		uuid.Must(uuid.NewV7()), reporterID, entityType, entityID, reason, detail); err != nil {
		return fmt.Errorf("写举报: %w", err)
	}
	return nil
}
