// Package recipe 之 Feed 部分（API 定义 §2.5）。
//
// 三条流：hot（时间衰减热度）/ new（发布时间）/ following（关注的人）。
// 分页一律 cursor（§1.3）：base64 编码的排序键元组 + id tiebreaker。
//
// classic_key 折叠（ADR-013）：同一 classic_key 单页最多 2 条，其余折叠进
// 首条目标的 collapsedVariants。放在应用层而非数据库层——调参便宜。
// 折叠会吞掉扫描到的行，nextCursor 因此指向「最后输出的行」；被跳过的行
// 下一页重新评估（折叠是按页算的，重扫无害）。
package recipe

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kafsaki/shaker/apps/api/internal/cursor"
)

/* ────────────────────────── 结果类型 ────────────────────────── */

// CollapsedVariants 折叠信息：count = 该 key 全部已发布数 − 本页已展示数。
type CollapsedVariants struct {
	Count int
	URL   string
}

// FeedItem 一张 Feed 卡片。
type FeedItem struct {
	Recipe            *Recipe
	CollapsedVariants *CollapsedVariants // 仅折叠发生的 key 的首条
}

// FeedResult NextCursor 为 "" 表示到底。
type FeedResult struct {
	Items      []FeedItem
	NextCursor string
}

/* ────────────────────────── 三条流 ────────────────────────── */

// feedScanLimit 单批扫描行数。折叠意味着发出 limit 条可能要扫更多行。
const feedScanLimit = 50

// FeedHot 热门流。window ∈ {24h,7d,30d,all}。
func (s *Store) FeedHot(ctx context.Context, window, cur string, limit int) (*FeedResult, error) {
	var since string
	switch window {
	case "24h":
		since = " AND published_at >= now() - interval '24 hours'"
	case "7d", "":
		since = " AND published_at >= now() - interval '7 days'"
	case "30d":
		since = " AND published_at >= now() - interval '30 days'"
	case "all":
	default:
		return nil, fmt.Errorf("未知时间窗 %q", window)
	}
	if _, err := cursor.Decode[cursor.Hot](cur); err != nil {
		return nil, ErrBadCursor
	}
	fetch := func(cur string) ([]*Recipe, error) {
		c, err := cursor.Decode[cursor.Hot](cur)
		if err != nil {
			return nil, ErrBadCursor
		}
		var args []any
		pred := ""
		if c != nil {
			args = append(args, c.H, c.ID)
			n := len(args)
			pred = fmt.Sprintf(" AND (r.hot_score < $%d OR (r.hot_score = $%d AND r.id > $%d))", n-1, n-1, n)
		}
		args = append(args, feedScanLimit)
		return s.queryRecipes(ctx, `
			SELECT `+recipeCols+authorCols+`
			FROM recipes r LEFT JOIN users u ON u.id = r.author_id
			WHERE r.status = 'published' AND r.deleted_at IS NULL`+since+pred+`
			ORDER BY r.hot_score DESC, r.id
			LIMIT $`+fmt.Sprint(len(args)), args...)
	}
	cursorOf := func(r *Recipe) string {
		return cursor.Encode(cursor.Hot{H: r.HotScore, ID: r.ID.String()})
	}
	return s.scanFeed(ctx, fetch, cursorOf, cur, limit)
}

// FeedNew 最新流。
func (s *Store) FeedNew(ctx context.Context, cur string, limit int) (*FeedResult, error) {
	if _, err := cursor.Decode[cursor.Time](cur); err != nil {
		return nil, ErrBadCursor
	}
	fetch := func(cur string) ([]*Recipe, error) {
		c, err := cursor.Decode[cursor.Time](cur)
		if err != nil {
			return nil, ErrBadCursor
		}
		return s.queryRecipesAfter(ctx, c, `
			SELECT `+recipeCols+authorCols+`
			FROM recipes r LEFT JOIN users u ON u.id = r.author_id
			WHERE r.status = 'published' AND r.deleted_at IS NULL`, `r.published_at`)
	}
	cursorOf := func(r *Recipe) string {
		return cursor.Encode(cursor.Time{T: r.PublishedAt.UnixNano(), ID: r.ID.String()})
	}
	return s.scanFeed(ctx, fetch, cursorOf, cur, limit)
}

// FeedFollowing 关注的人的发布流。
func (s *Store) FeedFollowing(ctx context.Context, userID uuid.UUID, cur string, limit int) (*FeedResult, error) {
	if _, err := cursor.Decode[cursor.Time](cur); err != nil {
		return nil, ErrBadCursor
	}
	fetch := func(cur string) ([]*Recipe, error) {
		c, err := cursor.Decode[cursor.Time](cur)
		if err != nil {
			return nil, ErrBadCursor
		}
		return s.queryRecipesAfter(ctx, c, `
			SELECT `+recipeCols+authorCols+`
			FROM recipes r LEFT JOIN users u ON u.id = r.author_id
			WHERE r.status = 'published' AND r.deleted_at IS NULL
				AND r.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1)`, `r.published_at`, userID)
	}
	cursorOf := func(r *Recipe) string {
		return cursor.Encode(cursor.Time{T: r.PublishedAt.UnixNano(), ID: r.ID.String()})
	}
	return s.scanFeed(ctx, fetch, cursorOf, cur, limit)
}

// queryRecipesAfter 时间游标（DESC, id ASC）版的通用查询。
// extraArgs 先于游标参数占位（$1 起），游标谓词接在其后。
func (s *Store) queryRecipesAfter(ctx context.Context, c *cursor.Time, base, timeCol string, extraArgs ...any) ([]*Recipe, error) {
	args := append([]any{}, extraArgs...)
	pred := ""
	if c != nil {
		args = append(args, time.Unix(0, c.T).UTC(), c.ID)
		n := len(args)
		pred = fmt.Sprintf(" AND (%s < $%d OR (%s = $%d AND r.id > $%d))", timeCol, n-1, timeCol, n-1, n)
	}
	args = append(args, feedScanLimit)
	return s.queryRecipes(ctx, base+pred+`
		ORDER BY `+timeCol+` DESC, r.id
		LIMIT $`+fmt.Sprint(len(args)), args...)
}

// queryRecipes 执行并扫描配方行（含作者 + 批量标签）。
func (s *Store) queryRecipes(ctx context.Context, sql string, args ...any) ([]*Recipe, error) {
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("查询 Feed: %w", err)
	}
	defer rows.Close()
	var out []*Recipe
	for rows.Next() {
		r, err := scanRecipeWithAuthorRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.loadTagsBatch(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

// loadTagsBatch 一次查询填满整批配方的 Tags（Feed 卡片带标签展示）。
func (s *Store) loadTagsBatch(ctx context.Context, rs []*Recipe) error {
	if len(rs) == 0 {
		return nil
	}
	byID := make(map[uuid.UUID]*Recipe, len(rs))
	ids := make([]uuid.UUID, 0, len(rs))
	for _, r := range rs {
		r.Tags = []string{}
		ids = append(ids, r.ID)
		byID[r.ID] = r
	}
	rows, err := s.pool.Query(ctx, `
		SELECT recipe_id, tag_id FROM recipe_tags WHERE recipe_id = ANY($1) ORDER BY tag_id`, ids)
	if err != nil {
		return fmt.Errorf("批量查询标签: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var rid uuid.UUID
		var t string
		if err := rows.Scan(&rid, &t); err != nil {
			return fmt.Errorf("扫描批量标签: %w", err)
		}
		byID[rid].Tags = append(byID[rid].Tags, t)
	}
	return rows.Err()
}

// scanFeed 折叠主循环。
//
// fetch 按游标取一批；cursorOf 从行编码游标。每批整批处理（折叠计数），
// 输出到 limit 为止。到底判定：批不满且没有未消费的行——注意页满提前停
// 时本批剩余行（含被折叠的）属于下一页，必须给 nextCursor，否则翻页死路。
// 极端情况（前 1000 行全是同一 key 的折叠项）封顶返回，防止长循环。
func (s *Store) scanFeed(ctx context.Context, fetch func(string) ([]*Recipe, error), cursorOf func(*Recipe) string, cursor string, limit int) (*FeedResult, error) {
	res := &FeedResult{Items: []FeedItem{}}
	shown := map[string]int{}   // classic_key → 本页已输出
	firstOf := map[string]int{} // classic_key → 首条输出下标（折叠信息挂这）
	folded := map[string]bool{} // 本页发生过折叠的 key
	var lastEmitted *Recipe

	for batch := 0; batch < 20; batch++ {
		rows, err := fetch(cursor)
		if err != nil {
			return nil, err
		}
		batchFull := len(rows) == feedScanLimit
		hasRemaining := false // 页满停时，本批还有未消费的行
		for i, r := range rows {
			if len(res.Items) >= limit {
				hasRemaining = i < len(rows)
				break // 后面的行留给下一页重评（折叠按页算）
			}
			if r.ClassicKey != nil {
				key := *r.ClassicKey
				if shown[key] >= 2 { // ADR-013：单页每 key 最多 2 条
					folded[key] = true
					continue
				}
				if _, ok := firstOf[key]; !ok {
					firstOf[key] = len(res.Items)
				}
				shown[key]++
			}
			res.Items = append(res.Items, FeedItem{Recipe: r})
			lastEmitted = r
		}
		if len(res.Items) >= limit {
			next := ""
			if lastEmitted != nil && (hasRemaining || batchFull) {
				next = cursorOf(lastEmitted)
			}
			return s.finishFeed(ctx, res, shown, firstOf, folded, next)
		}
		if !batchFull { // 批不满且页未满 → 真到底
			return s.finishFeed(ctx, res, shown, firstOf, folded, "")
		}
		// 批满但没凑够（大量折叠）→ 用本批最后行推进游标继续
		cursor = cursorOf(rows[len(rows)-1])
	}
	// 封顶：前 20 批（1000 行）都没凑满一页
	next := ""
	if lastEmitted != nil {
		next = cursorOf(lastEmitted)
	}
	return s.finishFeed(ctx, res, shown, firstOf, folded, next)
}

// finishFeed 折叠计数落位。nextCursor 为 "" 表示到底。
func (s *Store) finishFeed(ctx context.Context, res *FeedResult, shown, firstOf map[string]int, folded map[string]bool, nextCursor string) (*FeedResult, error) {
	if len(folded) > 0 {
		keys := make([]string, 0, len(folded))
		for k := range folded {
			keys = append(keys, k)
		}
		rows, err := s.pool.Query(ctx, `
			SELECT classic_key, count(*) FROM recipes
			WHERE classic_key = ANY($1) AND status = 'published' AND deleted_at IS NULL
			GROUP BY classic_key`, keys)
		if err != nil {
			return nil, fmt.Errorf("查询折叠计数: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			var total int
			if err := rows.Scan(&key, &total); err != nil {
				return nil, fmt.Errorf("扫描折叠计数: %w", err)
			}
			if idx, ok := firstOf[key]; ok {
				count := total - shown[key]
				if count < 0 {
					count = 0
				}
				res.Items[idx].CollapsedVariants = &CollapsedVariants{
					Count: count, URL: "/api/v1/classics/" + key + "/variants",
				}
			}
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("遍历折叠计数: %w", err)
		}
	}
	res.NextCursor = nextCursor
	return res, nil
}

// scanRecipeWithAuthorRow rows 版（scanRecipeWithAuthor 只收 pgx.Row）。
func scanRecipeWithAuthorRow(rows pgx.Rows) (*Recipe, error) {
	r := &Recipe{}
	var authorID, authorHandle, authorName, authorAvatar *string
	var authorOfficial *bool
	var taste []byte
	err := rows.Scan(&r.ID, &r.AuthorID, &r.Slug, &r.Title, &r.Subtitle, &r.DescriptionMd, &r.Lang,
		&r.IR, &r.IRVersion, &r.GlassID, &r.Method, &r.Family, &r.Source, &r.IsCanonical, &r.ClassicKey,
		&r.DerivedFrom, &r.DerivedCount, &r.IbaCategory, &r.CoverURL, &r.Status,
		&r.AbvEst, &r.TotalVolumeMl, &taste, &r.Difficulty,
		&r.LikeCount, &r.CommentCount, &r.CollectCount, &r.ViewCount, &r.HotScore,
		&r.CreatedAt, &r.UpdatedAt, &r.PublishedAt, &r.DeletedAt,
		&authorID, &authorHandle, &authorName, &authorAvatar, &authorOfficial)
	if err != nil {
		return nil, fmt.Errorf("扫描 Feed 行: %w", err)
	}
	if authorID != nil {
		r.Author = &AuthorBrief{
			ID: *authorID, Handle: *authorHandle, DisplayName: *authorName,
			AvatarURL: authorAvatar, IsOfficial: *authorOfficial,
		}
	}
	return scanRecipeErr(nil, r, taste)
}

/* ────────────────────────── viewerState 批量 ────────────────────────── */

// ViewerStates 批量取认证用户对一组配方的互动状态（Feed 卡片免去逐张反查）。
func (s *Store) ViewerStates(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]*ViewerState, error) {
	out := make(map[uuid.UUID]*ViewerState, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT recipe_id FROM likes WHERE user_id = $1 AND recipe_id = ANY($2)`, userID, ids)
	if err != nil {
		return nil, fmt.Errorf("批量查询点赞: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var rid uuid.UUID
		if err := rows.Scan(&rid); err != nil {
			return nil, fmt.Errorf("扫描批量点赞: %w", err)
		}
		out[rid] = &ViewerState{Liked: true, CollectedInMenus: []string{}}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历批量点赞: %w", err)
	}

	mrows, err := s.pool.Query(ctx, `
		SELECT mi.recipe_id, m.id FROM menus m
		JOIN menu_items mi ON mi.menu_id = m.id
		WHERE m.owner_id = $1 AND mi.recipe_id = ANY($2) AND m.deleted_at IS NULL`, userID, ids)
	if err != nil {
		return nil, fmt.Errorf("批量查询酒单收藏: %w", err)
	}
	defer mrows.Close()
	for mrows.Next() {
		var rid, menuID uuid.UUID
		if err := mrows.Scan(&rid, &menuID); err != nil {
			return nil, fmt.Errorf("扫描批量酒单收藏: %w", err)
		}
		vs := out[rid]
		if vs == nil {
			vs = &ViewerState{}
			out[rid] = vs
		}
		vs.CollectedInMenus = append(vs.CollectedInMenus, menuID.String())
	}
	if err := mrows.Err(); err != nil {
		return nil, fmt.Errorf("遍历批量酒单收藏: %w", err)
	}
	for _, id := range ids { // 没点赞也没收藏的 → 默认值
		if _, ok := out[id]; !ok {
			out[id] = &ViewerState{CollectedInMenus: []string{}}
		}
	}
	return out, nil
}
