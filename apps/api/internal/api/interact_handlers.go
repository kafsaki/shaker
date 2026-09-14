package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
	"github.com/kafsaki/shaker/apps/api/internal/interact"
)

func (a *API) registerInteract(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "recipes-like",
		Method:      http.MethodPut,
		Path:        "/api/v1/recipes/{id}/like",
		Summary:     "点赞（幂等）",
		Description: "状态设置而非事件追加：重复 PUT 返回 200，不重复计数（API 定义 §1.5）。",
		Security:    bearerSecurity,
	}, a.likeRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-unlike",
		Method:      http.MethodDelete,
		Path:        "/api/v1/recipes/{id}/like",
		Summary:     "取消点赞（幂等）",
		Security:    bearerSecurity,
	}, a.unlikeRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-likers",
		Method:      http.MethodGet,
		Path:        "/api/v1/recipes/{id}/likes",
		Summary:     "点赞用户列表",
	}, a.likersHandler)

	huma.Register(api, huma.Operation{
		OperationID: "comments-list",
		Method:      http.MethodGet,
		Path:        "/api/v1/recipes/{id}/comments",
		Summary:     "顶层评论 + 每条前 3 条回复",
	}, a.listCommentsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "comments-create",
		Method:      http.MethodPost,
		Path:        "/api/v1/recipes/{id}/comments",
		Summary:     "发评论",
		Description: "body 可带 parentId 回复某条顶层评论——只允许一层回复（API 定义 §2.4）。",
		Security:    bearerSecurity,
	}, a.createCommentHandler)

	huma.Register(api, huma.Operation{
		OperationID: "comments-replies",
		Method:      http.MethodGet,
		Path:        "/api/v1/comments/{id}/replies",
		Summary:     "展开某条评论的全部回复",
	}, a.repliesHandler)

	huma.Register(api, huma.Operation{
		OperationID: "comments-update",
		Method:      http.MethodPatch,
		Path:        "/api/v1/comments/{id}",
		Summary:     "编辑自己的评论",
		Security:    bearerSecurity,
	}, a.updateCommentHandler)

	huma.Register(api, huma.Operation{
		OperationID: "comments-delete",
		Method:      http.MethodDelete,
		Path:        "/api/v1/comments/{id}",
		Summary:     "软删自己的评论",
		Description: "顶层评论连回复一起软删，计数同步回退。",
		Security:    bearerSecurity,
	}, a.deleteCommentHandler)

	huma.Register(api, huma.Operation{
		OperationID: "comments-like",
		Method:      http.MethodPut,
		Path:        "/api/v1/comments/{id}/like",
		Summary:     "评论点赞（幂等）",
		Security:    bearerSecurity,
	}, a.likeCommentHandler)

	huma.Register(api, huma.Operation{
		OperationID: "comments-unlike",
		Method:      http.MethodDelete,
		Path:        "/api/v1/comments/{id}/like",
		Summary:     "取消评论点赞（幂等）",
		Security:    bearerSecurity,
	}, a.unlikeCommentHandler)
}

/* ────────────────────────── 响应体 ────────────────────────── */

type likerBody struct {
	User     recipeAuthorBody `json:"user"`
	LikedAt  string           `json:"likedAt"`
}

type likersOutput struct {
	Body struct {
		Items      []likerBody `json:"items"`
		NextCursor *string     `json:"nextCursor"`
	}
}

type commentViewerStateBody struct {
	Liked bool `json:"liked"`
}

type commentBody struct {
	ID          string                 `json:"id"`
	Body        string                 `json:"body"`
	Author      recipeAuthorBody       `json:"author"`
	LikeCount   int                    `json:"likeCount"`
	ReplyCount  int                    `json:"replyCount"`
	CreatedAt   string                 `json:"createdAt"`
	UpdatedAt   string                 `json:"updatedAt"`
	ViewerState *commentViewerStateBody `json:"viewerState,omitempty"`
	Replies     []commentBody          `json:"replies,omitempty"` // 仅顶层评论
}

type commentsOutput struct {
	Body struct {
		Items      []commentBody `json:"items"`
		NextCursor *string       `json:"nextCursor"`
	}
}

type commentOutput struct {
	Status int
	Body   commentBody
}

type countOutput struct {
	Body struct {
		Like int `json:"like"`
	}
}

func userToAuthorBody(u *interact.UserBrief) recipeAuthorBody {
	return recipeAuthorBody{
		ID: u.ID, Handle: u.Handle, DisplayName: u.DisplayName,
		AvatarURL: u.AvatarURL, IsOfficial: u.IsOfficial,
	}
}

func commentToBody(c interact.Comment, liked *bool) commentBody {
	b := commentBody{
		ID: c.ID.String(), Body: c.Body, Author: userToAuthorBody(c.User),
		LikeCount: c.LikeCount, ReplyCount: c.ReplyCount,
		CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: c.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if liked != nil {
		b.ViewerState = &commentViewerStateBody{Liked: *liked}
	}
	return b
}

/* ────────────────────────── 配方点赞 ────────────────────────── */

type recipeLikeInput struct {
	ID string `path:"id" format:"uuid"`
}

func (a *API) likeRecipeHandler(ctx context.Context, in *recipeLikeInput) (*countOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	n, err := a.interact.LikeRecipe(ctx, claims.UserUUID(), id)
	if err != nil {
		return nil, interactErr(err)
	}
	out := &countOutput{}
	out.Body.Like = n
	return out, nil
}

func (a *API) unlikeRecipeHandler(ctx context.Context, in *recipeLikeInput) (*countOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	n, err := a.interact.UnlikeRecipe(ctx, claims.UserUUID(), id)
	if err != nil {
		return nil, interactErr(err)
	}
	out := &countOutput{}
	out.Body.Like = n
	return out, nil
}

type likersInput struct {
	ID     string `path:"id" format:"uuid"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}

func (a *API) likersHandler(ctx context.Context, in *likersInput) (*likersOutput, error) {
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	likers, next, err := a.interact.RecipeLikers(ctx, id, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, interactErr(err)
	}
	out := &likersOutput{}
	out.Body.Items = make([]likerBody, 0, len(likers))
	for _, l := range likers {
		out.Body.Items = append(out.Body.Items, likerBody{
			User:    userToAuthorBody(l.User),
			LikedAt: l.LikedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	if next != "" {
		out.Body.NextCursor = &next
	}
	return out, nil
}

/* ────────────────────────── 评论 ────────────────────────── */

type listCommentsInput struct {
	ID     string `path:"id" format:"uuid"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}

func (a *API) listCommentsHandler(ctx context.Context, in *listCommentsInput) (*commentsOutput, error) {
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	trees, next, err := a.interact.ListComments(ctx, id, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, interactErr(err)
	}

	var liked map[uuid.UUID]bool
	if claims != nil {
		ids := make([]uuid.UUID, 0, len(trees)*2)
		for _, t := range trees {
			ids = append(ids, t.Comment.ID)
			for _, r := range t.Replies {
				ids = append(ids, r.ID)
			}
		}
		if liked, err = a.interact.CommentLikedMap(ctx, claims.UserUUID(), ids); err != nil {
			return nil, internalErr(err)
		}
	}

	out := &commentsOutput{}
	out.Body.Items = make([]commentBody, 0, len(trees))
	for _, t := range trees {
		b := commentToBodyTree(t, liked)
		out.Body.Items = append(out.Body.Items, b)
	}
	if next != "" {
		out.Body.NextCursor = &next
	}
	return out, nil
}

func commentToBodyTree(t interact.CommentTree, liked map[uuid.UUID]bool) commentBody {
	l := liked[t.Comment.ID]
	b := commentToBody(t.Comment, &l)
	b.Replies = make([]commentBody, 0, len(t.Replies))
	for _, r := range t.Replies {
		rl := liked[r.ID]
		b.Replies = append(b.Replies, commentToBody(r, &rl))
	}
	return b
}

type createCommentInput struct {
	ID   string `path:"id" format:"uuid"`
	Body struct {
		Body     string  `json:"body" minLength:"1" maxLength:"4000"`
		ParentID *string `json:"parentId,omitempty" format:"uuid"`
	}
}

func (a *API) createCommentHandler(ctx context.Context, in *createCommentInput) (*commentOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	var parentID *uuid.UUID
	if in.Body.ParentID != nil {
		pid, err := uuid.Parse(*in.Body.ParentID)
		if err != nil {
			return nil, newErr(http.StatusBadRequest, "comment.parent_invalid", "parentId 不是合法的 UUID")
		}
		parentID = &pid
	}
	c, err := a.interact.CreateComment(ctx, claims.UserUUID(), id, in.Body.Body, parentID)
	if err != nil {
		return nil, interactErr(err)
	}
	out := &commentOutput{Status: http.StatusCreated}
	out.Body = commentToBody(*c, nil)
	return out, nil
}

type repliesInput struct {
	ID     string `path:"id" format:"uuid"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}

func (a *API) repliesHandler(ctx context.Context, in *repliesInput) (*commentsOutput, error) {
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "comment.id_invalid", "评论 ID 不是合法的 UUID")
	}
	items, next, err := a.interact.Replies(ctx, id, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, interactErr(err)
	}

	var liked map[uuid.UUID]bool
	if claims != nil {
		ids := make([]uuid.UUID, 0, len(items))
		for _, c := range items {
			ids = append(ids, c.ID)
		}
		if liked, err = a.interact.CommentLikedMap(ctx, claims.UserUUID(), ids); err != nil {
			return nil, internalErr(err)
		}
	}

	out := &commentsOutput{}
	out.Body.Items = make([]commentBody, 0, len(items))
	for _, c := range items {
		l := liked[c.ID]
		out.Body.Items = append(out.Body.Items, commentToBody(c, &l))
	}
	if next != "" {
		out.Body.NextCursor = &next
	}
	return out, nil
}

type updateCommentInput struct {
	ID   string `path:"id" format:"uuid"`
	Body struct {
		Body string `json:"body" minLength:"1" maxLength:"4000"`
	}
}

func (a *API) updateCommentHandler(ctx context.Context, in *updateCommentInput) (*commentOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "comment.id_invalid", "评论 ID 不是合法的 UUID")
	}
	c, err := a.interact.UpdateComment(ctx, claims.UserUUID(), id, in.Body.Body)
	if err != nil {
		return nil, interactErr(err)
	}
	out := &commentOutput{Status: http.StatusOK}
	out.Body = commentToBody(*c, nil)
	return out, nil
}

type commentIDInput struct {
	ID string `path:"id" format:"uuid"`
}

func (a *API) deleteCommentHandler(ctx context.Context, in *commentIDInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "comment.id_invalid", "评论 ID 不是合法的 UUID")
	}
	if err := a.interact.DeleteComment(ctx, claims.UserUUID(), id); err != nil {
		return nil, interactErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) likeCommentHandler(ctx context.Context, in *commentIDInput) (*countOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "comment.id_invalid", "评论 ID 不是合法的 UUID")
	}
	n, err := a.interact.LikeComment(ctx, claims.UserUUID(), id)
	if err != nil {
		return nil, interactErr(err)
	}
	out := &countOutput{}
	out.Body.Like = n
	return out, nil
}

func (a *API) unlikeCommentHandler(ctx context.Context, in *commentIDInput) (*countOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "comment.id_invalid", "评论 ID 不是合法的 UUID")
	}
	n, err := a.interact.UnlikeComment(ctx, claims.UserUUID(), id)
	if err != nil {
		return nil, interactErr(err)
	}
	out := &countOutput{}
	out.Body.Like = n
	return out, nil
}

/* ────────────────────────── 错误映射 ────────────────────────── */

func interactErr(err error) error {
	switch {
	case errors.Is(err, interact.ErrRecipeNotFound):
		return newErr(http.StatusNotFound, "recipe.not_found", "配方不存在")
	case errors.Is(err, interact.ErrCommentNotFound):
		return newErr(http.StatusNotFound, "comment.not_found", "评论不存在")
	case errors.Is(err, interact.ErrForbidden):
		return newErr(http.StatusForbidden, "comment.forbidden", "只能操作自己的评论")
	case errors.Is(err, interact.ErrParentNesting):
		return newErr(http.StatusUnprocessableEntity, "comment.nesting_not_allowed", "只能回复顶层评论")
	case errors.Is(err, interact.ErrParentRecipe):
		return newErr(http.StatusUnprocessableEntity, "comment.parent_mismatch", "父评论不属于这个配方")
	case errors.Is(err, interact.ErrBadCursor):
		return newErr(http.StatusBadRequest, "cursor.invalid", "分页游标无效")
	default:
		return internalErr(err)
	}
}
