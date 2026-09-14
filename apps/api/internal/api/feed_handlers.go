package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
	"github.com/kafsaki/shaker/apps/api/internal/recipe"
)

func (a *API) registerFeed(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "feed-hot",
		Method:      http.MethodGet,
		Path:        "/api/v1/feed/hot",
		Summary:     "热门流",
		Description: "时间衰减热度排序（DB 设计 §5 公式）。window 限定时间范围；classic_key 单页最多 2 条，其余折叠进 collapsedVariants（ADR-013）。",
	}, a.feedHotHandler)

	huma.Register(api, huma.Operation{
		OperationID: "feed-new",
		Method:      http.MethodGet,
		Path:        "/api/v1/feed/new",
		Summary:     "最新流",
		Description: "按发布时间倒序。折叠规则同 hot。",
	}, a.feedNewHandler)

	huma.Register(api, huma.Operation{
		OperationID: "feed-following",
		Method:      http.MethodGet,
		Path:        "/api/v1/feed/following",
		Summary:     "关注流",
		Description: "关注的人的发布，按时间倒序。需认证。",
		Security:    bearerSecurity,
	}, a.feedFollowingHandler)
}

/* ────────────────────────── 响应体 ────────────────────────── */

// feedCard 嵌入完整配方体（动画是产品核心，Feed 卡片直接可渲染）
// + 折叠信息（仅折叠发生时出现）。
type feedCard struct {
	recipeBody
	CollapsedVariants *collapsedVariantsBody `json:"collapsedVariants,omitempty"`
}

type collapsedVariantsBody struct {
	Count int    `json:"count"`
	URL   string `json:"url"`
}

type feedOutput struct {
	Body struct {
		Items      []feedCard `json:"items"`
		NextCursor *string    `json:"nextCursor"`
	}
}

type feedQueryInput struct {
	Window string `query:"window" enum:"24h,7d,30d,all" default:"7d"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}

// limitOf huma 的 default 只进 OpenAPI 文档不进运行时，这里兜底。
func limitOf(n int) int {
	if n <= 0 {
		return 20
	}
	return n
}

func (a *API) feedHotHandler(ctx context.Context, in *feedQueryInput) (*feedOutput, error) {
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	res, err := a.recipes.FeedHot(ctx, in.Window, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, feedErr(err)
	}
	return a.feedOut(ctx, res, claims)
}

func (a *API) feedNewHandler(ctx context.Context, in *feedQueryInput) (*feedOutput, error) {
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	res, err := a.recipes.FeedNew(ctx, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, feedErr(err)
	}
	return a.feedOut(ctx, res, claims)
}

func (a *API) feedFollowingHandler(ctx context.Context, in *feedQueryInput) (*feedOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	res, err := a.recipes.FeedFollowing(ctx, claims.UserUUID(), in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, feedErr(err)
	}
	return a.feedOut(ctx, res, claims)
}

// feedOut 组装卡片：配方体 + viewerState 批量（认证时）+ 折叠信息。
func (a *API) feedOut(ctx context.Context, res *recipe.FeedResult, claims *auth.Claims) (*feedOutput, error) {
	out := &feedOutput{}
	out.Body.Items = make([]feedCard, 0, len(res.Items))

	var states map[uuid.UUID]*recipe.ViewerState
	if claims != nil && len(res.Items) > 0 {
		ids := make([]uuid.UUID, 0, len(res.Items))
		for _, it := range res.Items {
			ids = append(ids, it.Recipe.ID)
		}
		var err error
		states, err = a.recipes.ViewerStates(ctx, claims.UserUUID(), ids)
		if err != nil {
			return nil, internalErr(err)
		}
	}

	for _, it := range res.Items {
		card := feedCard{recipeBody: recipeToBody(it.Recipe)}
		if it.CollapsedVariants != nil {
			card.CollapsedVariants = &collapsedVariantsBody{
				Count: it.CollapsedVariants.Count, URL: it.CollapsedVariants.URL,
			}
		}
		if states != nil {
			if vs, ok := states[it.Recipe.ID]; ok {
				card.ViewerState = &recipeViewerStateBody{
					Liked: vs.Liked, CollectedInMenus: vs.CollectedInMenus,
				}
			}
		}
		out.Body.Items = append(out.Body.Items, card)
	}
	if res.NextCursor != "" {
		s := res.NextCursor
		out.Body.NextCursor = &s
	}
	return out, nil
}

func feedErr(err error) error {
	if errors.Is(err, recipe.ErrBadCursor) {
		return newErr(http.StatusBadRequest, "cursor.invalid", "分页游标无效")
	}
	return internalErr(err)
}
