// Package interact 互动域（API 定义 §2.4）：配方点赞、评论（一层回复）、评论点赞。
//
// 幂等是设计核心：点赞是「状态设置」而非事件追加——PUT/DELETE 用主键防重，
// 重复调用 200 而非 409。计数冗余列（like_count/comment_count/reply_count）
// 全部在同一事务内原子维护；hot_score 在互动时内联重算（v1，见 recipe.TouchHot）。
package interact

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/cursor"
	"github.com/kafsaki/shaker/apps/api/internal/notify"
	"github.com/kafsaki/shaker/apps/api/internal/recipe"
)

var (
	// ErrRecipeNotFound 配方不存在或未发布（点赞/评论只对已发布开放）。
	ErrRecipeNotFound = errors.New("配方不存在")
	// ErrCommentNotFound 评论不存在（或已删除）。
	ErrCommentNotFound = errors.New("评论不存在")
	// ErrForbidden 不是评论作者本人。
	ErrForbidden = errors.New("只能操作自己的评论")
	// ErrParentNesting 只允许一层回复：父评论本身是回复。
	ErrParentNesting = errors.New("只能回复顶层评论")
	// ErrParentRecipe parentId 属于另一个配方。
	ErrParentRecipe = errors.New("父评论不属于这个配方")
	// ErrBadCursor 分页游标无法解码。
	ErrBadCursor = errors.New("分页游标无效")
)

// Store 互动数据访问。
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

/* ────────────────────────── 模型 ────────────────────────── */

type UserBrief struct {
	ID          string
	Handle      string
	DisplayName string
	AvatarURL   *string
	IsOfficial  bool
}

type Comment struct {
	ID         uuid.UUID
	RecipeID   uuid.UUID
	UserID     uuid.UUID
	User       *UserBrief // 用户删号后为 nil
	ParentID   *uuid.UUID
	Body       string
	LikeCount  int
	ReplyCount int
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// CommentTree 顶层评论 + 前 3 条回复。
type CommentTree struct {
	Comment Comment
	Replies []Comment
}

// Liker 点赞用户条目。
type Liker struct {
	User     *UserBrief
	LikedAt  time.Time
}

/* ────────────────────────── 配方点赞 ────────────────────────── */

// LikeRecipe 点赞（幂等）：返回最新 like_count。重复点赞不重复计数。
func (s *Store) LikeRecipe(ctx context.Context, userID, recipeID uuid.UUID) (int, error) {
	return s.toggleRecipeLike(ctx, userID, recipeID, true)
}

// UnlikeRecipe 取消点赞（幂等）。
func (s *Store) UnlikeRecipe(ctx context.Context, userID, recipeID uuid.UUID) (int, error) {
	return s.toggleRecipeLike(ctx, userID, recipeID, false)
}

func (s *Store) toggleRecipeLike(ctx context.Context, userID, recipeID uuid.UUID, like bool) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 只对已发布配方开放（草稿不泄露存在性 → 404 语义）
	// 顺带取 author_id：点赞要给作者发通知
	var authorID uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT author_id FROM recipes
		WHERE id = $1 AND status = 'published' AND deleted_at IS NULL`, recipeID).Scan(&authorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrRecipeNotFound
		}
		return 0, fmt.Errorf("查询配方: %w", err)
	}

	sql := `INSERT INTO likes (user_id, recipe_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
	if !like {
		sql = `DELETE FROM likes WHERE user_id = $1 AND recipe_id = $2`
	}
	tag, err := tx.Exec(ctx, sql, userID, recipeID)
	if err != nil {
		return 0, fmt.Errorf("写点赞: %w", err)
	}
	if tag.RowsAffected() == 1 {
		delta := 1
		if !like {
			delta = -1
		}
		if _, err := tx.Exec(ctx,
			`UPDATE recipes SET like_count = like_count + $1 WHERE id = $2`, delta, recipeID); err != nil {
			return 0, fmt.Errorf("更新点赞数: %w", err)
		}
		if err := recipe.TouchHot(ctx, tx, recipeID); err != nil {
			return 0, err
		}
		if like {
			if err := notify.Insert(ctx, tx, authorID, notify.TypeLike, &userID, "recipe", &recipeID, nil); err != nil {
				return 0, err
			}
		}
	}

	var n int
	if err := tx.QueryRow(ctx, `SELECT like_count FROM recipes WHERE id = $1`, recipeID).Scan(&n); err != nil {
		return 0, fmt.Errorf("读取点赞数: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("提交事务: %w", err)
	}
	return n, nil
}

// RecipeLikers 点赞用户列表（created_at DESC, user_id ASC 游标）。
func (s *Store) RecipeLikers(ctx context.Context, recipeID uuid.UUID, cursor string, limit int) ([]Liker, string, error) {
	c, err := decodeTimeCursor(cursor)
	if err != nil {
		return nil, "", ErrBadCursor
	}
	var args []any
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		pred = ` AND (l.created_at < $1 OR (l.created_at = $1 AND l.user_id > $2))`
	}
	args = append(args, recipeID, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT l.created_at, u.id, u.handle, u.display_name, u.avatar_url, u.is_official
		FROM likes l JOIN users u ON u.id = l.user_id
		WHERE l.recipe_id = $`+fmt.Sprint(len(args)-1)+pred+`
		ORDER BY l.created_at DESC, l.user_id
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, "", fmt.Errorf("查询点赞列表: %w", err)
	}
	defer rows.Close()
	out := []Liker{}
	var last time.Time
	var lastID string
	for rows.Next() {
		var l Liker
		u := &UserBrief{}
		if err := rows.Scan(&l.LikedAt, &u.ID, &u.Handle, &u.DisplayName, &u.AvatarURL, &u.IsOfficial); err != nil {
			return nil, "", fmt.Errorf("扫描点赞列表: %w", err)
		}
		l.User = u
		last, lastID = l.LikedAt, u.ID
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("遍历点赞列表: %w", err)
	}
	next := ""
	if len(out) > limit {
		out = out[:limit]
		next = encodeTimeCursor(last, lastID)
	}
	return out, next, nil
}

/* ────────────────────────── 评论读取 ────────────────────────── */

const commentCols = `c.id, c.recipe_id, c.user_id, c.parent_id, c.body,
	c.like_count, c.reply_count, c.created_at, c.updated_at,
	u.id, u.handle, u.display_name, u.avatar_url, u.is_official`

func scanComment(row pgx.Row) (*Comment, error) {
	c := &Comment{}
	u := &UserBrief{}
	var uid, handle, name string
	err := row.Scan(&c.ID, &c.RecipeID, &c.UserID, &c.ParentID, &c.Body,
		&c.LikeCount, &c.ReplyCount, &c.CreatedAt, &c.UpdatedAt,
		&uid, &handle, &name, &u.AvatarURL, &u.IsOfficial)
	if err != nil {
		return nil, err
	}
	u.ID, u.Handle, u.DisplayName = uid, handle, name
	c.User = u
	return c, nil
}

func scanComments(rows pgx.Rows) ([]Comment, error) {
	var out []Comment
	for rows.Next() {
		c := Comment{}
		u := &UserBrief{}
		var uid, handle, name string
		if err := rows.Scan(&c.ID, &c.RecipeID, &c.UserID, &c.ParentID, &c.Body,
			&c.LikeCount, &c.ReplyCount, &c.CreatedAt, &c.UpdatedAt,
			&uid, &handle, &name, &u.AvatarURL, &u.IsOfficial); err != nil {
			return nil, fmt.Errorf("扫描评论: %w", err)
		}
		u.ID, u.Handle, u.DisplayName = uid, handle, name
		c.User = u
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListComments 顶层评论（created_at DESC, id ASC 游标）+ 每条前 3 条回复。
// 只对已发布配方开放。
func (s *Store) ListComments(ctx context.Context, recipeID uuid.UUID, cursor string, limit int) ([]CommentTree, string, error) {
	var ok bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM recipes
			WHERE id = $1 AND status = 'published' AND deleted_at IS NULL)`, recipeID).Scan(&ok); err != nil {
		return nil, "", fmt.Errorf("查询配方: %w", err)
	}
	if !ok {
		return nil, "", ErrRecipeNotFound
	}

	c, err := decodeTimeCursor(cursor)
	if err != nil {
		return nil, "", ErrBadCursor
	}
	var args []any
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		pred = ` AND (c.created_at < $1 OR (c.created_at = $1 AND c.id > $2))`
	}
	args = append(args, recipeID, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT `+commentCols+` FROM comments c LEFT JOIN users u ON u.id = c.user_id
		WHERE c.recipe_id = $`+fmt.Sprint(len(args)-1)+` AND c.parent_id IS NULL AND c.deleted_at IS NULL`+pred+`
		ORDER BY c.created_at DESC, c.id
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, "", fmt.Errorf("查询评论: %w", err)
	}
	tops, err := scanComments(rows)
	rows.Close()
	if err != nil {
		return nil, "", fmt.Errorf("扫描评论: %w", err)
	}

	next := ""
	if len(tops) > limit {
		tops = tops[:limit]
		last := tops[limit-1]
		next = encodeTimeCursor(last.CreatedAt, last.ID.String())
	}

	trees := make([]CommentTree, 0, len(tops))
	for _, t := range tops {
		trees = append(trees, CommentTree{Comment: t, Replies: []Comment{}})
	}
	if len(tops) == 0 {
		return trees, "", nil
	}

	// 每条前 3 条回复（时间正序）。一次查全再分组——回复量 v1 可接受。
	ids := make([]uuid.UUID, 0, len(tops))
	for _, t := range tops {
		ids = append(ids, t.ID)
	}
	rrows, err := s.pool.Query(ctx, `
		SELECT `+commentCols+` FROM comments c LEFT JOIN users u ON u.id = c.user_id
		WHERE c.parent_id = ANY($1) AND c.deleted_at IS NULL
		ORDER BY c.created_at, c.id`, ids)
	if err != nil {
		return nil, "", fmt.Errorf("查询回复: %w", err)
	}
	replies, err := scanComments(rrows)
	rrows.Close()
	if err != nil {
		return nil, "", fmt.Errorf("扫描回复: %w", err)
	}
	byParent := make(map[uuid.UUID][]Comment, len(tops))
	for _, r := range replies {
		byParent[*r.ParentID] = append(byParent[*r.ParentID], r)
	}
	for i := range trees {
		if rs := byParent[trees[i].Comment.ID]; len(rs) > 3 {
			trees[i].Replies = rs[:3]
		} else {
			trees[i].Replies = rs
		}
		if trees[i].Replies == nil {
			trees[i].Replies = []Comment{}
		}
	}
	return trees, next, nil
}

// Replies 某条评论的全部回复（时间正序游标）。
func (s *Store) Replies(ctx context.Context, commentID uuid.UUID, cursor string, limit int) ([]Comment, string, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM comments WHERE id = $1 AND deleted_at IS NULL)`,
		commentID).Scan(&exists); err != nil {
		return nil, "", fmt.Errorf("查询评论: %w", err)
	}
	if !exists {
		return nil, "", ErrCommentNotFound
	}

	c, err := decodeTimeCursor(cursor)
	if err != nil {
		return nil, "", ErrBadCursor
	}
	var args []any
	args = append(args, commentID)
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		n := len(args)
		pred = fmt.Sprintf(` AND (c.created_at > $%d OR (c.created_at = $%d AND c.id > $%d))`, n-1, n-1, n)
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `
		SELECT `+commentCols+` FROM comments c LEFT JOIN users u ON u.id = c.user_id
		WHERE c.parent_id = $1 AND c.deleted_at IS NULL`+pred+`
		ORDER BY c.created_at, c.id
		LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, "", fmt.Errorf("查询回复: %w", err)
	}
	items, err := scanComments(rows)
	rows.Close()
	if err != nil {
		return nil, "", fmt.Errorf("扫描回复: %w", err)
	}
	next := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[limit-1]
		next = encodeTimeCursor(last.CreatedAt, last.ID.String())
	}
	if items == nil {
		items = []Comment{}
	}
	return items, next, nil
}

/* ────────────────────────── 评论写入 ────────────────────────── */

// CreateComment 发评论（可带 parentId，只允许一层回复）。
func (s *Store) CreateComment(ctx context.Context, userID, recipeID uuid.UUID, body string, parentID *uuid.UUID) (*Comment, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var authorID uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT author_id FROM recipes
		WHERE id = $1 AND status = 'published' AND deleted_at IS NULL`, recipeID).Scan(&authorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRecipeNotFound
		}
		return nil, fmt.Errorf("查询配方: %w", err)
	}

	var parentAuthor *uuid.UUID // 回复要通知父评论作者
	if parentID != nil {
		var parentRecipe uuid.UUID
		var grandParent *uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT recipe_id, parent_id, user_id FROM comments WHERE id = $1 AND deleted_at IS NULL`, *parentID).
			Scan(&parentRecipe, &grandParent, &parentAuthor)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCommentNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("查询父评论: %w", err)
		}
		if grandParent != nil {
			return nil, ErrParentNesting
		}
		if parentRecipe != recipeID {
			return nil, ErrParentRecipe
		}
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("生成 UUIDv7: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO comments (id, recipe_id, user_id, parent_id, body)
		VALUES ($1, $2, $3, $4, $5)`, id, recipeID, userID, parentID, body); err != nil {
		return nil, fmt.Errorf("写评论: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE recipes SET comment_count = comment_count + 1 WHERE id = $1`, recipeID); err != nil {
		return nil, fmt.Errorf("更新评论数: %w", err)
	}
	if parentID != nil {
		if _, err := tx.Exec(ctx,
			`UPDATE comments SET reply_count = reply_count + 1 WHERE id = $1`, *parentID); err != nil {
			return nil, fmt.Errorf("更新回复数: %w", err)
		}
	}
	if err := recipe.TouchHot(ctx, tx, recipeID); err != nil {
		return nil, err
	}
	// 通知：回复 → 父评论作者（type=reply，entity=评论）；顶层 → 配方作者（type=comment，entity=配方）。
	// notify.Insert 自动静默「自己通知自己」。
	cid := id
	if parentID != nil {
		if err := notify.Insert(ctx, tx, *parentAuthor, notify.TypeReply, &userID, "comment", &cid, nil); err != nil {
			return nil, err
		}
	} else {
		if err := notify.Insert(ctx, tx, authorID, notify.TypeComment, &userID, "recipe", &recipeID, nil); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}

	c, err := scanComment(s.pool.QueryRow(ctx, `
		SELECT `+commentCols+` FROM comments c LEFT JOIN users u ON u.id = c.user_id
		WHERE c.id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("读取评论: %w", err)
	}
	return c, nil
}

// UpdateComment 编辑自己的评论。
func (s *Store) UpdateComment(ctx context.Context, userID, commentID uuid.UUID, body string) (*Comment, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var owner uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT user_id FROM comments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, commentID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCommentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("锁定评论: %w", err)
	}
	if owner != userID {
		return nil, ErrForbidden
	}
	if _, err := tx.Exec(ctx, `UPDATE comments SET body = $2 WHERE id = $1`, commentID, body); err != nil {
		return nil, fmt.Errorf("更新评论: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return scanComment(s.pool.QueryRow(ctx, `
		SELECT `+commentCols+` FROM comments c LEFT JOIN users u ON u.id = c.user_id
		WHERE c.id = $1`, commentID))
}

// DeleteComment 软删自己的评论。顶层评论连回复一起软删，计数同步回退。
func (s *Store) DeleteComment(ctx context.Context, userID, commentID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var owner, recipeID uuid.UUID
	var parentID *uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT user_id, recipe_id, parent_id FROM comments
		WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, commentID).
		Scan(&owner, &recipeID, &parentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrCommentNotFound
	}
	if err != nil {
		return fmt.Errorf("锁定评论: %w", err)
	}
	if owner != userID {
		return ErrForbidden
	}

	if parentID == nil {
		// 顶层：连未删回复一起软删，count 回退 = 实删行数
		tag, err := tx.Exec(ctx, `
			UPDATE comments SET deleted_at = now()
			WHERE (id = $1 OR parent_id = $1) AND deleted_at IS NULL`, commentID)
		if err != nil {
			return fmt.Errorf("删除评论: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE recipes SET comment_count = comment_count - $1 WHERE id = $2`,
			int(tag.RowsAffected()), recipeID); err != nil {
			return fmt.Errorf("回退评论数: %w", err)
		}
	} else {
		if _, err := tx.Exec(ctx,
			`UPDATE comments SET deleted_at = now() WHERE id = $1`, commentID); err != nil {
			return fmt.Errorf("删除评论: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE comments SET reply_count = reply_count - 1 WHERE id = $1`, *parentID); err != nil {
			return fmt.Errorf("回退回复数: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE recipes SET comment_count = comment_count - 1 WHERE id = $1`, recipeID); err != nil {
			return fmt.Errorf("回退评论数: %w", err)
		}
	}
	if err := recipe.TouchHot(ctx, tx, recipeID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

/* ────────────────────────── 评论点赞 ────────────────────────── */

// LikeComment 评论点赞（幂等），返回最新 like_count。
func (s *Store) LikeComment(ctx context.Context, userID, commentID uuid.UUID) (int, error) {
	return s.toggleCommentLike(ctx, userID, commentID, true)
}

// UnlikeComment 取消评论点赞（幂等）。
func (s *Store) UnlikeComment(ctx context.Context, userID, commentID uuid.UUID) (int, error) {
	return s.toggleCommentLike(ctx, userID, commentID, false)
}

func (s *Store) toggleCommentLike(ctx context.Context, userID, commentID uuid.UUID, like bool) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var commentAuthor uuid.UUID // 点赞要通知评论作者
	if err := tx.QueryRow(ctx, `
		SELECT user_id FROM comments WHERE id = $1 AND deleted_at IS NULL`,
		commentID).Scan(&commentAuthor); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrCommentNotFound
		}
		return 0, fmt.Errorf("查询评论: %w", err)
	}

	sql := `INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
	if !like {
		sql = `DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2`
	}
	tag, err := tx.Exec(ctx, sql, userID, commentID)
	if err != nil {
		return 0, fmt.Errorf("写评论点赞: %w", err)
	}
	if tag.RowsAffected() == 1 {
		delta := 1
		if !like {
			delta = -1
		}
		if _, err := tx.Exec(ctx,
			`UPDATE comments SET like_count = like_count + $1 WHERE id = $2`, delta, commentID); err != nil {
			return 0, fmt.Errorf("更新评论点赞数: %w", err)
		}
		if like {
			if err := notify.Insert(ctx, tx, commentAuthor, notify.TypeLike, &userID, "comment", &commentID, nil); err != nil {
				return 0, err
			}
		}
	}

	var n int
	if err := tx.QueryRow(ctx, `SELECT like_count FROM comments WHERE id = $1`, commentID).Scan(&n); err != nil {
		return 0, fmt.Errorf("读取评论点赞数: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("提交事务: %w", err)
	}
	return n, nil
}

/* ────────────────────────── 评论点赞状态批量 ────────────────────────── */

// CommentLikedMap 批量取用户对一组评论的点赞状态（列表页高亮用）。
func (s *Store) CommentLikedMap(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT comment_id FROM comment_likes WHERE user_id = $1 AND comment_id = ANY($2)`, userID, ids)
	if err != nil {
		return nil, fmt.Errorf("批量查询评论点赞: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("扫描批量评论点赞: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

/* ────────────────────────── 内部辅助 ────────────────────────── */

func encodeTimeCursor(t time.Time, id string) string {
	return cursor.Encode(cursor.Time{T: t.UnixNano(), ID: id})
}

func decodeTimeCursor(s string) (*cursor.Time, error) {
	return cursor.Decode[cursor.Time](s)
}
