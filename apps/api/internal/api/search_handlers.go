package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/recipe"
	"github.com/kafsaki/shaker/apps/api/internal/vocab"
)

func (a *API) registerSearch(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "search",
		Method:      http.MethodGet,
		Path:        "/api/v1/search",
		Summary:     "全站搜索",
		Description: "type=all 返回分组（每组前 5 条 + total + 查看全部链接）；" +
			"专用类型（recipe/user/ingredient）返回对应分组并带 nextCursor 翻页。" +
			"配方搜索支持多维筛选：ingredient 可重复传（AND 语义），ingredientRole 限定角色，" +
			"relevance 排序把权威条目置顶后按 trgm 相似度（ADR-012）。menu 分组随酒单功能填充。",
	}, a.searchHandler)
}

/* ────────────────────────── 请求 / 响应体 ────────────────────────── */

type searchInput struct {
	Q              string   `query:"q" maxLength:"100"`
	Type           string   `query:"type" enum:"recipe,user,ingredient,menu,all" default:"all"`
	Ingredient     []string `query:"ingredient,explode" maxItems:"10"` // 重复传参（API 定义 §2.7），explode 让 huma 读全部值而非仅首个
	IngredientRole string   `query:"ingredientRole" enum:"base,modifier,sweetener,souring,bittering,lengthener,texture,rinse"`
	Family         string   `query:"family" maxLength:"64"`
	Method         string   `query:"method" maxLength:"32"`
	Glass          string   `query:"glass" maxLength:"64"`
	Tag            string   `query:"tag" maxLength:"64"`
	AbvMin         float64  `query:"abvMin" minimum:"0" maximum:"100"`
	AbvMax         float64  `query:"abvMax" minimum:"0" maximum:"100"`
	DifficultyMax  int      `query:"difficultyMax" minimum:"1" maximum:"5"`
	Sort           string   `query:"sort" enum:"relevance,hot,new" default:"relevance"`
	Cursor         string   `query:"cursor"`
	Limit          int      `query:"limit" minimum:"1" maximum:"50"`
}

type searchRecipeGroup struct {
	Items      []recipeBody `json:"items"`
	Total      *int         `json:"total,omitempty"`
	More       *string      `json:"more,omitempty"`
	NextCursor *string      `json:"nextCursor,omitempty"`
}

type searchUserGroup struct {
	Items      []userCardBody `json:"items"`
	Total      *int           `json:"total,omitempty"`
	More       *string        `json:"more,omitempty"`
	NextCursor *string        `json:"nextCursor,omitempty"`
}

// searchIngredientBody 轻量原料卡片（viz 留给 /vocab 与原料详情）。
type searchIngredientBody struct {
	ID          string   `json:"id"`
	NameZh      string   `json:"nameZh"`
	NameEn      string   `json:"nameEn"`
	Category    string   `json:"category"`
	Subcategory *string  `json:"subcategory,omitempty"`
	ABV         *float64 `json:"abv"`
}

type searchIngredientGroup struct {
	Items      []searchIngredientBody `json:"items"`
	Total      *int                   `json:"total,omitempty"`
	More       *string                `json:"more,omitempty"`
	NextCursor *string                `json:"nextCursor,omitempty"`
}

type searchMenuGroup struct {
	Items      []recipeBody `json:"items"` // 酒单分组随任务 11 填充，先占住契约
	Total      *int         `json:"total,omitempty"`
	More       *string      `json:"more,omitempty"`
	NextCursor *string      `json:"nextCursor,omitempty"`
}

type searchOutput struct {
	Body struct {
		Recipes     *searchRecipeGroup     `json:"recipes,omitempty"`
		Users       *searchUserGroup       `json:"users,omitempty"`
		Ingredients *searchIngredientGroup `json:"ingredients,omitempty"`
		Menus       *searchMenuGroup       `json:"menus,omitempty"`
	}
}

/* ────────────────────────── handler ────────────────────────── */

func (a *API) searchHandler(ctx context.Context, in *searchInput) (*searchOutput, error) {
	limit := limitOf(in.Limit)
	out := &searchOutput{}

	switch in.Type {
	case "all":
		if err := a.searchGroups(ctx, in, out, limit); err != nil {
			return nil, err
		}
	case "recipe":
		g, err := a.searchRecipes(ctx, in, limit)
		if err != nil {
			return nil, err
		}
		out.Body.Recipes = g
	case "user":
		g, err := a.searchUsers(ctx, in, limit)
		if err != nil {
			return nil, err
		}
		out.Body.Users = g
	case "ingredient":
		g, err := a.searchIngredients(ctx, in, limit)
		if err != nil {
			return nil, err
		}
		out.Body.Ingredients = g
	case "menu":
		out.Body.Menus = &searchMenuGroup{Items: []recipeBody{}, Total: intPtr(0)}
	}
	return out, nil
}

// searchGroups type=all：配方 / 用户 / 原料各前 5 条 + total + 查看全部。
func (a *API) searchGroups(ctx context.Context, in *searchInput, out *searchOutput, _ int) error {
	p := a.searchParams(in)

	rg, err := a.searchRecipes(ctx, in, 5)
	if err != nil {
		return err
	}
	total, err := a.recipes.SearchCount(ctx, p)
	if err != nil {
		return internalErr(err)
	}
	rg.Total = &total
	rg.More = stringPtr("/api/v1/search?type=recipe&q=" + in.Q)
	out.Body.Recipes = rg

	ug, err := a.searchUsers(ctx, in, 5)
	if err != nil {
		return err
	}
	if in.Q != "" {
		utotal, err := a.users.SearchCount(ctx, in.Q)
		if err != nil {
			return internalErr(err)
		}
		ug.Total = &utotal
		ug.More = stringPtr("/api/v1/search?type=user&q=" + in.Q)
	}
	out.Body.Users = ug

	ig, err := a.searchIngredients(ctx, in, 5)
	if err != nil {
		return err
	}
	itotal, err := a.vocab.CountIngredients(ctx, in.Q)
	if err != nil {
		return internalErr(err)
	}
	ig.Total = &itotal
	ig.More = stringPtr("/api/v1/search?type=ingredient&q=" + in.Q)
	out.Body.Ingredients = ig
	return nil
}

// searchRecipes 配方分组（type=all 前 5 条 / type=recipe 翻页）。
func (a *API) searchRecipes(ctx context.Context, in *searchInput, limit int) (*searchRecipeGroup, error) {
	res, err := a.recipes.Search(ctx, a.searchParams(in), in.Cursor, limit)
	if err != nil {
		return nil, listErr(err)
	}
	g := &searchRecipeGroup{Items: make([]recipeBody, 0, len(res.Items))}
	for _, r := range res.Items {
		g.Items = append(g.Items, recipeToBody(r))
	}
	if res.NextCursor != "" {
		g.NextCursor = &res.NextCursor
	}
	return g, nil
}

// searchUsers 用户分组。
func (a *API) searchUsers(ctx context.Context, in *searchInput, limit int) (*searchUserGroup, error) {
	if in.Q == "" { // 没有关键词的用户搜索没有意义（也没有排序依据）
		return &searchUserGroup{Items: []userCardBody{}}, nil
	}
	res, err := a.users.Search(ctx, in.Q, in.Cursor, limit)
	if err != nil {
		return nil, listErr(err)
	}
	g := &searchUserGroup{Items: make([]userCardBody, 0, len(res.Items))}
	for _, c := range res.Items {
		g.Items = append(g.Items, userCardToBody(c))
	}
	if res.NextCursor != "" {
		g.NextCursor = &res.NextCursor
	}
	return g, nil
}

// searchIngredients 原料分组。复用 /ingredients 的 (category, name_en, id) 键序游标。
func (a *API) searchIngredients(ctx context.Context, in *searchInput, limit int) (*searchIngredientGroup, error) {
	f := vocab.IngredientFilter{Q: in.Q, Limit: limit + 1}
	if in.Cursor != "" {
		var c ingredientCursor
		if err := decodeCursor(in.Cursor, &c); err != nil {
			return nil, newErr(http.StatusBadRequest, "cursor.invalid", "分页游标无效")
		}
		f.AfterCat, f.AfterName, f.AfterID = c.Cat, c.Name, c.ID
	}
	list, err := a.vocab.ListIngredients(ctx, f)
	if err != nil {
		return nil, internalErr(err)
	}

	g := &searchIngredientGroup{}
	if len(list) > limit {
		list = list[:limit]
		last := list[len(list)-1]
		next := encodeCursor(ingredientCursor{Cat: last.Category, Name: last.NameEn, ID: last.ID})
		g.NextCursor = &next
	}
	g.Items = make([]searchIngredientBody, 0, len(list))
	for _, i := range list {
		g.Items = append(g.Items, searchIngredientBody{
			ID: i.ID, NameZh: i.NameZh, NameEn: i.NameEn,
			Category: i.Category, Subcategory: i.Subcategory, ABV: i.ABV,
		})
	}
	return g, nil
}

// searchParams 查询参数 → store 参数。数值筛选 0 表示未传。
func (a *API) searchParams(in *searchInput) recipe.SearchParams {
	p := recipe.SearchParams{
		Q: in.Q, Ingredients: in.Ingredient, IngredientRole: in.IngredientRole,
		Family: in.Family, Method: in.Method, Glass: in.Glass, Tag: in.Tag,
		Sort: in.Sort,
	}
	if in.AbvMin > 0 {
		p.AbvMin = &in.AbvMin
	}
	if in.AbvMax > 0 {
		p.AbvMax = &in.AbvMax
	}
	if in.DifficultyMax > 0 {
		p.DifficultyMax = &in.DifficultyMax
	}
	return p
}

func intPtr(v int) *int    { return &v }
func stringPtr(s string) *string { return &s }
