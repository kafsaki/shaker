package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
	"github.com/kafsaki/shaker/apps/api/internal/recipe"
)

func (a *API) registerClassics(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "classics-list",
		Method:      http.MethodGet,
		Path:        "/api/v1/classics",
		Summary:     "经典列表",
		Description: "全部权威条目（is_canonical），按发布时间倒序。",
	}, a.classicsListHandler)

	huma.Register(api, huma.Operation{
		OperationID: "classics-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/classics/{classicKey}",
		Summary:     "权威条目",
		Description: "等价于该 classic_key 下 is_canonical 的配方。",
	}, a.classicGetHandler)

	huma.Register(api, huma.Operation{
		OperationID: "classics-variants",
		Method:      http.MethodGet,
		Path:        "/api/v1/classics/{classicKey}/variants",
		Summary:     "社区变体",
		Description: "该经典的社区配方（不含权威条目），sort=hot|new。",
	}, a.classicVariantsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "classics-distribution",
		Method:      http.MethodGet,
		Path:        "/api/v1/classics/{classicKey}/distribution",
		Summary:     "规格分布",
		Description: "变体的原料用量与 ABV 分位统计（p10/p25/median/p75/p90），" +
			"数据来自 recipe_ingredients 投影的聚合（ADR-013）。",
	}, a.classicDistributionHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-compare",
		Method:      http.MethodGet,
		Path:        "/api/v1/recipes/compare",
		Summary:     "配方对比",
		Description: "ids 是逗号分隔的 UUID（2..5 个），按传入顺序返回已发布配方。",
	}, a.recipesCompareHandler)
}

/* ────────────────────────── handler ────────────────────────── */

type classicsListInput struct {
	IbaCategory string `query:"ibaCategory" enum:"unforgettable,contemporary,new_era"`
	Family      string `query:"family" maxLength:"64"`
	Cursor      string `query:"cursor"`
	Limit       int    `query:"limit" minimum:"1" maximum:"50"`
}

func (a *API) classicsListHandler(ctx context.Context, in *classicsListInput) (*recipeListOutput, error) {
	res, err := a.recipes.Classics(ctx, in.IbaCategory, in.Family, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, listErr(err)
	}
	return recipeListOut(res.Items, res.NextCursor), nil
}

type classicKeyInput struct {
	ClassicKey string `path:"classicKey" minLength:"1" maxLength:"64"`
}

func (a *API) classicGetHandler(ctx context.Context, in *classicKeyInput) (*recipeOutput, error) {
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	r, err := a.recipes.CanonicalByKey(ctx, in.ClassicKey)
	if err != nil {
		return nil, recipeErr(err)
	}
	return a.recipeDetail(ctx, r, claims, false)
}

type classicVariantsInput struct {
	ClassicKey string `path:"classicKey" minLength:"1" maxLength:"64"`
	Sort       string `query:"sort" enum:"hot,new" default:"hot"`
	Cursor     string `query:"cursor"`
	Limit      int    `query:"limit" minimum:"1" maximum:"50"`
}

func (a *API) classicVariantsHandler(ctx context.Context, in *classicVariantsInput) (*recipeListOutput, error) {
	res, err := a.recipes.Variants(ctx, in.ClassicKey, in.Sort, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, listErr(err)
	}
	return recipeListOut(res.Items, res.NextCursor), nil
}

/* ────────────────────────── 规格分布 ────────────────────────── */

type distStatsBody struct {
	P10    *float64 `json:"p10"`
	P25    *float64 `json:"p25"`
	Median *float64 `json:"median"`
	P75    *float64 `json:"p75"`
	P90    *float64 `json:"p90"`
}

type distIngredientBody struct {
	IngredientID string        `json:"ingredientId"`
	Role         string        `json:"role"`
	PresentIn    int           `json:"presentIn"`
	AmountMl     *distStatsBody `json:"amountMl"`
}

type distributionOutput struct {
	Body struct {
		ClassicKey   string              `json:"classicKey"`
		VariantCount int                 `json:"variantCount"`
		Ingredients  []distIngredientBody `json:"ingredients"`
		AbvEst       *distStatsBody      `json:"abvEst"`
	}
}

func distStatsToBody(d *recipe.DistStats) *distStatsBody {
	if d == nil {
		return nil
	}
	return &distStatsBody{P10: d.P10, P25: d.P25, Median: d.Median, P75: d.P75, P90: d.P90}
}

func (a *API) classicDistributionHandler(ctx context.Context, in *classicKeyInput) (*distributionOutput, error) {
	dist, err := a.recipes.Distribution(ctx, in.ClassicKey)
	if err != nil {
		return nil, recipeErr(err)
	}
	out := &distributionOutput{}
	out.Body.ClassicKey = dist.ClassicKey
	out.Body.VariantCount = dist.VariantCount
	out.Body.Ingredients = make([]distIngredientBody, 0, len(dist.Ingredients))
	for _, d := range dist.Ingredients {
		out.Body.Ingredients = append(out.Body.Ingredients, distIngredientBody{
			IngredientID: d.IngredientID, Role: d.Role, PresentIn: d.PresentIn,
			AmountMl: distStatsToBody(d.AmountMl),
		})
	}
	out.Body.AbvEst = distStatsToBody(dist.AbvEst)
	return out, nil
}

/* ────────────────────────── 配方对比 ────────────────────────── */

type compareInput struct {
	IDs string `query:"ids" minLength:"3" maxLength:"400"`
}

type compareOutput struct {
	Body struct {
		Items []recipeBody `json:"items"`
	}
}

func (a *API) recipesCompareHandler(ctx context.Context, in *compareInput) (*compareOutput, error) {
	parts := strings.Split(in.IDs, ",")
	if len(parts) < 2 {
		return nil, newErr(http.StatusBadRequest, "compare.ids_invalid", "ids 需要至少 2 个 UUID（逗号分隔）")
	}
	if len(parts) > 5 {
		return nil, newErr(http.StatusBadRequest, "compare.too_many", "一次最多对比 5 个配方")
	}
	ids := make([]uuid.UUID, 0, len(parts))
	seen := make(map[uuid.UUID]bool, len(parts))
	for _, p := range parts {
		id, err := uuid.Parse(strings.TrimSpace(p))
		if err != nil {
			return nil, newErr(http.StatusBadRequest, "compare.ids_invalid", "ids 含非法 UUID")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}

	list, err := a.recipes.Compare(ctx, ids)
	if err != nil {
		return nil, internalErr(err)
	}
	out := &compareOutput{}
	out.Body.Items = make([]recipeBody, 0, len(list))
	for _, r := range list {
		out.Body.Items = append(out.Body.Items, recipeToBody(r))
	}
	return out, nil
}
