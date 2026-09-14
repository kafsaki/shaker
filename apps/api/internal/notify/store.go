// Package notify 通知收件箱（API 定义 §2.11）。
//
// 写侧挂在互动/关注/发布的事务里（Q 接口同时接受 pool 与 tx，保证原子）；
// 自发的动作不通知自己。v1 无 river，粉丝扇出在发布事务内联完成——
// v1 规模（关注数小）够用，上量后挪到异步任务（API 定义 §3 第 8 步的原设计）。
package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/cursor"
)

var ErrBadCursor = errors.New("分页游标无效")

// 类型枚举（DB CHECK 之外的代码层约束，写侧只用这五个）。
const (
	TypeLike    = "like"
	TypeComment = "comment"
	TypeReply   = "reply"
	TypeFollow  = "follow"
	TypeSystem  = "system" // 发布动态等平台通知
)

// Q 写侧查询接口：pgxpool.Pool 与 pgx.Tx 都满足，事务内写入保证原子。
type Q interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Insert 写一条通知。actor == 收件人时静默跳过（自己点赞自己不通知）。
// payload 可为 nil。写侧失败应随外层事务回滚（一致性优先）。
func Insert(ctx context.Context, q Q, userID uuid.UUID, typ string,
	actorID *uuid.UUID, entityType string, entityID *uuid.UUID, payload map[string]any) error {
	if actorID != nil && *actorID == userID {
		return nil
	}
	_, err := q.Exec(ctx, `
		INSERT INTO notifications (id, user_id, type, actor_id, entity_type, entity_id, payload)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		uuid.Must(uuid.NewV7()), userID, typ, actorID, entityType, entityID, payload)
	if err != nil {
		return fmt.Errorf("写通知 %s: %w", typ, err)
	}
	return nil
}

// FanoutToFollowers 给 author 的全部粉丝发通知（发布动态用）。
// 不通知作者自己；粉丝数大时这里会慢——v1 可接受，见包注释。
func FanoutToFollowers(ctx context.Context, q Q, authorID uuid.UUID,
	entityType string, entityID uuid.UUID, payload map[string]any) error {
	tag, err := q.Exec(ctx, `
		INSERT INTO notifications (id, user_id, type, actor_id, entity_type, entity_id, payload)
		SELECT gen_random_uuid(), f.follower_id, 'system', $1, $2, $3, $4
		FROM follows f WHERE f.followee_id = $1 AND f.follower_id <> $1`,
		authorID, entityType, entityID, payload)
	if err != nil {
		return fmt.Errorf("扇出通知: %w", err)
	}
	_ = tag
	return nil
}

/* ────────────────────────── 读侧（收件箱） ────────────────────────── */

// Item 通知条目。
type Item struct {
	ID         uuid.UUID
	Type       string
	ActorID    *uuid.UUID
	ActorHandle *string // actor 删号后为 nil
	ActorName  *string
	EntityType *string
	EntityID   *uuid.UUID
	Payload    []byte // jsonb 原文，客户端自解析
	ReadAt     *time.Time
	CreatedAt  time.Time
}

// Store 通知数据访问。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// ListResult 分页页。
type ListResult struct {
	Items      []Item
	NextCursor string
}

// List 收件箱（created_at DESC, id ASC，Time 游标）。unreadOnly 只取未读。
func (s *Store) List(ctx context.Context, userID uuid.UUID, unreadOnly bool, cur string, limit int) (*ListResult, error) {
	c, err := cursor.Decode[cursor.Time](cur)
	if err != nil {
		return nil, ErrBadCursor
	}
	args := []any{userID}
	unread := ""
	if unreadOnly {
		unread = " AND n.read_at IS NULL"
	}
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (n.created_at < $%d OR (n.created_at = $%d AND n.id > $%d))", n-1, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT n.id, n.type, n.actor_id, u.handle, u.display_name, n.entity_type, n.entity_id, n.payload, n.read_at, n.created_at
		FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
		WHERE n.user_id = $1`+unread+pred+`
		ORDER BY n.created_at DESC, n.id ASC
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("查询通知: %w", err)
	}
	defer rows.Close()
	var items []Item
	var times []time.Time
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.Type, &it.ActorID, &it.ActorHandle, &it.ActorName,
			&it.EntityType, &it.EntityID, &it.Payload, &it.ReadAt, &it.CreatedAt); err != nil {
			return nil, fmt.Errorf("扫描通知: %w", err)
		}
		items = append(items, it)
		times = append(times, it.CreatedAt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历通知: %w", err)
	}
	res := &ListResult{Items: []Item{}}
	if len(items) > limit {
		items = items[:limit]
		times = times[:limit]
		res.NextCursor = cursor.Encode(cursor.Time{T: times[limit-1].UnixNano(), ID: items[limit-1].ID.String()})
	}
	res.Items = items
	return res, nil
}

// UnreadCount 未读数（小红点用）。
func (s *Store) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, userID).Scan(&n); err != nil {
		return 0, fmt.Errorf("统计未读: %w", err)
	}
	return n, nil
}

// MarkRead 标读：ids 为空则全部标读。返回影响行数。
func (s *Store) MarkRead(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) (int64, error) {
	var tag pgconn.CommandTag
	var err error
	if len(ids) == 0 {
		tag, err = s.pool.Exec(ctx, `
			UPDATE notifications SET read_at = now()
			WHERE user_id = $1 AND read_at IS NULL`, userID)
	} else {
		tag, err = s.pool.Exec(ctx, `
			UPDATE notifications SET read_at = now()
			WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2)`, userID, ids)
	}
	if err != nil {
		return 0, fmt.Errorf("标读: %w", err)
	}
	return tag.RowsAffected(), nil
}
