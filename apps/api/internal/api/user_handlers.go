package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
	"github.com/kafsaki/shaker/apps/api/internal/recipe"
	"github.com/kafsaki/shaker/apps/api/internal/user"
)

func (a *API) registerUsers(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "users-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/users/{handle}",
		Summary:     "公开资料",
		Description: "含计数；认证且非本人时附带 viewerIsFollowing。/users/{handle}/menus 随酒单功能提供。",
	}, a.getUserHandler)

	huma.Register(api, huma.Operation{
		OperationID: "users-recipes",
		Method:      http.MethodGet,
		Path:        "/api/v1/users/{handle}/recipes",
		Summary:     "某用户的已发布配方",
	}, a.userRecipesHandler)

	huma.Register(api, huma.Operation{
		OperationID: "users-likes",
		Method:      http.MethodGet,
		Path:        "/api/v1/users/{handle}/likes",
		Summary:     "某人点赞过的配方",
		Description: "按点赞时间倒序。",
	}, a.userLikesHandler)

	huma.Register(api, huma.Operation{
		OperationID: "users-followers",
		Method:      http.MethodGet,
		Path:        "/api/v1/users/{handle}/followers",
		Summary:     "粉丝列表",
	}, a.userFollowersHandler)

	huma.Register(api, huma.Operation{
		OperationID: "users-following",
		Method:      http.MethodGet,
		Path:        "/api/v1/users/{handle}/following",
		Summary:     "关注列表",
	}, a.userFollowingHandler)

	huma.Register(api, huma.Operation{
		OperationID: "users-follow",
		Method:      http.MethodPut,
		Path:        "/api/v1/users/{handle}/follow",
		Summary:     "关注",
		Description: "幂等：重复关注返回当前资料。不能关注自己（422）。",
		Security:    bearerSecurity,
	}, a.followHandler)

	huma.Register(api, huma.Operation{
		OperationID: "users-unfollow",
		Method:      http.MethodDelete,
		Path:        "/api/v1/users/{handle}/follow",
		Summary:     "取关",
		Description: "幂等。",
		Security:    bearerSecurity,
	}, a.unfollowHandler)

	huma.Register(api, huma.Operation{
		OperationID: "me-drafts",
		Method:      http.MethodGet,
		Path:        "/api/v1/me/drafts",
		Summary:     "我的草稿",
		Description: "按更新时间倒序。",
		Security:    bearerSecurity,
	}, a.myDraftsHandler)
}

/* ────────────────────────── 响应体 ────────────────────────── */

type userCountsBody struct {
	Follower  int `json:"follower"`
	Following int `json:"following"`
	Recipe    int `json:"recipe"`
}

type publicUserBody struct {
	ID               string         `json:"id" format:"uuid"`
	Handle           string         `json:"handle"`
	DisplayName      string         `json:"displayName"`
	AvatarURL        *string        `json:"avatarUrl"`
	Bio              *string        `json:"bio"`
	Location         *string        `json:"location"`
	Website          *string        `json:"website"`
	IsOfficial       bool           `json:"isOfficial"`
	Counts           userCountsBody `json:"counts"`
	ViewerIsFollowing *bool         `json:"viewerIsFollowing,omitempty"`
	CreatedAt        string         `json:"createdAt" format:"date-time"`
}

type userCardBody struct {
	ID            string  `json:"id" format:"uuid"`
	Handle        string  `json:"handle"`
	DisplayName   string  `json:"displayName"`
	AvatarURL     *string `json:"avatarUrl"`
	IsOfficial    bool    `json:"isOfficial"`
	FollowerCount int     `json:"followerCount"`
	RecipeCount   int     `json:"recipeCount"`
}

// recipeListOutput 配方列表页（用户主页 / 搜索 / 经典变体共用）。
type recipeListOutput struct {
	Body struct {
		Items      []recipeBody `json:"items"`
		NextCursor *string      `json:"nextCursor"`
	}
}

type userListOutput struct {
	Body struct {
		Items      []userCardBody `json:"items"`
		NextCursor *string        `json:"nextCursor"`
	}
}

func publicUserToBody(p *user.Profile) publicUserBody {
	return publicUserBody{
		ID: p.ID.String(), Handle: p.Handle, DisplayName: p.DisplayName,
		AvatarURL: p.AvatarURL, Bio: p.Bio, Location: p.Location, Website: p.Website,
		IsOfficial: p.IsOfficial,
		Counts:     userCountsBody{Follower: p.FollowerCount, Following: p.FollowingCount, Recipe: p.RecipeCount},
		CreatedAt:  p.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func userCardToBody(c user.Card) userCardBody {
	return userCardBody{
		ID: c.ID.String(), Handle: c.Handle, DisplayName: c.DisplayName,
		AvatarURL: c.AvatarURL, IsOfficial: c.IsOfficial,
		FollowerCount: c.FollowerCount, RecipeCount: c.RecipeCount,
	}
}

// recipeListOut 组装配方列表页。
func recipeListOut(items []*recipe.Recipe, next string) *recipeListOutput {
	out := &recipeListOutput{}
	out.Body.Items = make([]recipeBody, 0, len(items))
	for _, r := range items {
		out.Body.Items = append(out.Body.Items, recipeToBody(r))
	}
	if next != "" {
		s := next
		out.Body.NextCursor = &s
	}
	return out
}

func userListOut(cards []user.Card, next string) *userListOutput {
	out := &userListOutput{}
	out.Body.Items = make([]userCardBody, 0, len(cards))
	for _, c := range cards {
		out.Body.Items = append(out.Body.Items, userCardToBody(c))
	}
	if next != "" {
		s := next
		out.Body.NextCursor = &s
	}
	return out
}

/* ────────────────────────── handler ────────────────────────── */

type handleInput struct {
	Handle string `path:"handle" pattern:"^[a-zA-Z0-9_]{3,24}$"`
}

type handleListInput struct {
	Handle string `path:"handle" pattern:"^[a-zA-Z0-9_]{3,24}$"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}

func (a *API) getUserHandler(ctx context.Context, in *handleInput) (*struct {
	Body publicUserBody
}, error) {
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	body := publicUserToBody(p)
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	if claims != nil && claims.UserUUID() != p.ID {
		following, err := a.users.IsFollowing(ctx, claims.UserUUID(), p.ID)
		if err != nil {
			return nil, internalErr(err)
		}
		body.ViewerIsFollowing = &following
	}
	return &struct{ Body publicUserBody }{Body: body}, nil
}

func (a *API) userRecipesHandler(ctx context.Context, in *handleListInput) (*recipeListOutput, error) {
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	res, err := a.recipes.ListByAuthor(ctx, p.ID, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, listErr(err)
	}
	return recipeListOut(res.Items, res.NextCursor), nil
}

func (a *API) userLikesHandler(ctx context.Context, in *handleListInput) (*recipeListOutput, error) {
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	res, err := a.recipes.LikedBy(ctx, p.ID, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, listErr(err)
	}
	return recipeListOut(res.Items, res.NextCursor), nil
}

func (a *API) userFollowersHandler(ctx context.Context, in *handleListInput) (*userListOutput, error) {
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	res, err := a.users.Followers(ctx, p.ID, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, listErr(err)
	}
	return userListOut(res.Items, res.NextCursor), nil
}

func (a *API) userFollowingHandler(ctx context.Context, in *handleListInput) (*userListOutput, error) {
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	res, err := a.users.Following(ctx, p.ID, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, listErr(err)
	}
	return userListOut(res.Items, res.NextCursor), nil
}

func (a *API) followHandler(ctx context.Context, in *handleInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	if _, err := a.users.Follow(ctx, claims.UserUUID(), p.ID); err != nil {
		return nil, userErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) unfollowHandler(ctx context.Context, in *handleInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	if _, err := a.users.Unfollow(ctx, claims.UserUUID(), p.ID); err != nil {
		return nil, userErr(err)
	}
	return &emptyOutput{}, nil
}

// cursorListInput 无筛选的游标列表参数。
type cursorListInput struct {
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}

func (a *API) myDraftsHandler(ctx context.Context, in *cursorListInput) (*recipeListOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	res, err := a.recipes.ListDrafts(ctx, claims.UserUUID(), in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, listErr(err)
	}
	return recipeListOut(res.Items, res.NextCursor), nil
}

/* ────────────────────────── 错误映射 ────────────────────────── */

func userErr(err error) error {
	switch {
	case errors.Is(err, user.ErrNotFound):
		return newErr(http.StatusNotFound, "user.not_found", "用户不存在")
	case errors.Is(err, user.ErrSelfFollow):
		return newErr(http.StatusUnprocessableEntity, "follow.self", "不能关注自己")
	case errors.Is(err, user.ErrBadCursor):
		return newErr(http.StatusBadRequest, "cursor.invalid", "分页游标无效")
	default:
		return internalErr(err)
	}
}

// listErr 列表查询的公共错误（坏游标 → 400，其余 500）。
func listErr(err error) error {
	if errors.Is(err, recipe.ErrBadCursor) || errors.Is(err, user.ErrBadCursor) {
		return newErr(http.StatusBadRequest, "cursor.invalid", "分页游标无效")
	}
	return internalErr(err)
}
