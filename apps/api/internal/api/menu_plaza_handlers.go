package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/menu"
)

// 酒单广场（ADR-029）：发现、收藏、复制公开酒单。
func (a *API) registerMenuPlaza(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "menus-plaza",
		Method:      http.MethodGet,
		Path:        "/api/v1/menus",
		Summary:     "酒单广场",
		Description: "社区公开酒单（不含官方精选与空酒单）。sort=hot 按收藏数，sort=new 按最近更新。",
	}, a.menuPlazaHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-featured",
		Method:      http.MethodGet,
		Path:        "/api/v1/menus/featured",
		Summary:     "官方精选酒单",
		Description: "由种子以官方账号维护（seed.json 的 officialMenus），按种子顺序，不分页。",
	}, a.featuredMenusHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-save",
		Method:      http.MethodPut,
		Path:        "/api/v1/menus/{id}/save",
		Summary:     "收藏酒单",
		Description: "幂等。只能收藏别人的公开酒单（自己的 → 422 menu.self_save）。",
		Security:    bearerSecurity,
	}, a.saveMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-unsave",
		Method:      http.MethodDelete,
		Path:        "/api/v1/menus/{id}/save",
		Summary:     "取消收藏酒单",
		Description: "幂等。",
		Security:    bearerSecurity,
	}, a.unsaveMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-fork",
		Method:      http.MethodPost,
		Path:        "/api/v1/menus/{id}/fork",
		Summary:     "复制成我的酒单",
		Description: "把看得见的酒单复制成自己的私密酒单（条目顺序与笔记一并复制，已删配方跳过）。",
		Security:    bearerSecurity,
	}, a.forkMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "me-saved-menus",
		Method:      http.MethodGet,
		Path:        "/api/v1/me/saved-menus",
		Summary:     "我收藏的酒单",
		Description: "收藏时间倒序。酒单被主人转为私密或删除后不再出现。",
		Security:    bearerSecurity,
	}, a.savedMenusHandler)
}

type menuSaveOutput struct {
	Body struct {
		Saved     bool `json:"saved"`
		SaveCount int  `json:"saveCount"`
	}
}

type featuredMenusOutput struct {
	Body struct {
		Items []menuBody `json:"items"`
	}
}

func menuListOut(items []menuBody, next string) *menuListOutput {
	out := &menuListOutput{}
	out.Body.Items = items
	if next != "" {
		out.Body.NextCursor = &next
	}
	return out
}

func (a *API) menuPlazaHandler(ctx context.Context, in *struct {
	Sort   string `query:"sort" enum:"hot,new" default:"hot"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}) (*menuListOutput, error) {
	res, err := a.menus.ListPublic(ctx, in.Sort, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, menuErr(err)
	}
	items, err := a.menusToBodies(ctx, res.Items, false)
	if err != nil {
		return nil, err
	}
	return menuListOut(items, res.NextCursor), nil
}

func (a *API) featuredMenusHandler(ctx context.Context, _ *struct{}) (*featuredMenusOutput, error) {
	list, err := a.menus.Featured(ctx)
	if err != nil {
		return nil, menuErr(err)
	}
	items, err := a.menusToBodies(ctx, list, false)
	if err != nil {
		return nil, err
	}
	out := &featuredMenusOutput{}
	out.Body.Items = items
	return out, nil
}

func (a *API) saveMenuHandler(ctx context.Context, in *menuIDInput) (*menuSaveOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	n, err := a.menus.Save(ctx, claims.UserUUID(), in.ID)
	if err != nil {
		return nil, menuErr(err)
	}
	out := &menuSaveOutput{}
	out.Body.Saved, out.Body.SaveCount = true, n
	return out, nil
}

func (a *API) unsaveMenuHandler(ctx context.Context, in *menuIDInput) (*menuSaveOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	n, err := a.menus.Unsave(ctx, claims.UserUUID(), in.ID)
	if err != nil {
		return nil, menuErr(err)
	}
	out := &menuSaveOutput{}
	out.Body.SaveCount = n
	return out, nil
}

func (a *API) forkMenuHandler(ctx context.Context, in *menuIDInput) (*menuCreateOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	m, err := a.menus.Fork(ctx, claims.UserUUID(), in.ID)
	if err != nil {
		return nil, menuErr(err)
	}
	bodies, err := a.menusToBodies(ctx, []menu.Menu{*m}, true)
	if err != nil {
		return nil, err
	}
	return &menuCreateOutput{Status: http.StatusCreated, Body: bodies[0]}, nil
}

func (a *API) savedMenusHandler(ctx context.Context, in *struct {
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}) (*menuListOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	res, err := a.menus.ListSaved(ctx, claims.UserUUID(), in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, menuErr(err)
	}
	items, err := a.menusToBodies(ctx, res.Items, false)
	if err != nil {
		return nil, err
	}
	return menuListOut(items, res.NextCursor), nil
}
