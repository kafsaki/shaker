package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/vocab"
)

func (a *API) registerVocab(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "vocab-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/vocab",
		Summary:     "全量受控词表",
		Description: "编辑器一次性拉全量词表做选择与校验；配 ETag 强缓存（If-None-Match → 304）。",
	}, a.getVocabHandler)

	huma.Register(api, huma.Operation{
		OperationID: "ingredients-list",
		Method:      http.MethodGet,
		Path:        "/api/v1/ingredients",
		Summary:     "原料列表",
		Description: "分类浏览 + 中英文名/别名模糊搜索；cursor 翻页。",
	}, a.listIngredientsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "ingredients-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/ingredients/{id}",
		Summary:     "原料详情",
	}, a.getIngredientHandler)

	huma.Register(api, huma.Operation{
		OperationID: "glassware-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/glassware/{id}",
		Summary:     "杯型详情",
	}, a.getGlassHandler)
}

// ─────────────────────────────── GET /vocab ───────────────────────────────

type vocabBody struct {
	Version     string           `json:"version" format:"date-time"`
	Ingredients []IngredientBody `json:"ingredients"`
	Glassware   []glassBody      `json:"glassware"`
	Techniques  []techniqueBody  `json:"techniques"`
	Tags        []tagBody        `json:"tags"`
}

type IngredientBody struct {
	ID          string          `json:"id"`
	NameZh      string          `json:"nameZh"`
	NameEn      string          `json:"nameEn"`
	Category    string          `json:"category"`
	Subcategory *string         `json:"subcategory,omitempty"`
	ABV         *float64        `json:"abv"`
	Density     *float64        `json:"density"`
	Viz         json.RawMessage `json:"viz"`
	Aliases     []string        `json:"aliases"`
}

type ingredientDetailBody struct {
	IngredientBody
	DescriptionZh *string `json:"descriptionZh,omitempty"`
	DescriptionEn *string `json:"descriptionEn,omitempty"`
	RecipeCount   int     `json:"recipeCount"`
}

type glassBody struct {
	ID         string          `json:"id"`
	NameZh     string          `json:"nameZh"`
	NameEn     string          `json:"nameEn"`
	CapacityMl int             `json:"capacityMl"`
	Shape      json.RawMessage `json:"shape"`
}

type techniqueBody struct {
	ID     string  `json:"id"`
	NameZh string  `json:"nameZh"`
	NameEn string  `json:"nameEn"`
	IconID *string `json:"iconId,omitempty"`
}

type tagBody struct {
	ID     string `json:"id"`
	NameZh string `json:"nameZh"`
	NameEn string `json:"nameEn"`
	Kind   string `json:"kind"`
}

func ingredientToBody(i vocab.Ingredient) IngredientBody {
	return IngredientBody{
		ID: i.ID, NameZh: i.NameZh, NameEn: i.NameEn,
		Category: i.Category, Subcategory: i.Subcategory,
		ABV: i.ABV, Density: i.Density, Viz: i.Viz, Aliases: i.Aliases,
	}
}

type vocabInput struct {
	IfNoneMatch string `header:"If-None-Match"`
}

type vocabOutput struct {
	Body         vocabBody
	Status       int
	ETag         string `header:"ETag"`
	CacheControl string `header:"Cache-Control"`
}

// vocabETag 由词表版本派生。强 ETag；304 判定用宽松匹配
// （容忍 W/ 前缀与多值头 —— 反正不匹配就重建一次，代价可忽略）。
func vocabETag(version time.Time) string {
	sum := sha256.Sum256([]byte(version.UTC().Format(time.RFC3339Nano)))
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}

func etagMatches(ifNoneMatch, etag string) bool {
	for _, part := range strings.Split(ifNoneMatch, ",") {
		part = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(part), "W/"))
		if part == etag || part == "*" {
			return true
		}
	}
	return false
}

func (a *API) getVocabHandler(ctx context.Context, in *vocabInput) (*vocabOutput, error) {
	full, err := a.vocab.Full(ctx)
	if err != nil {
		return nil, internalErr(err)
	}

	etag := vocabETag(full.Version)
	out := &vocabOutput{
		Status:       http.StatusOK, // 有 Status 字段时 huma 不再用默认值，两条路径都要显式设置
		ETag:         etag,
		CacheControl: "public, max-age=3600",
	}
	if etagMatches(in.IfNoneMatch, etag) {
		out.Status = http.StatusNotModified
		return out, nil
	}

	body := vocabBody{
		Version:     full.Version.UTC().Format(time.RFC3339Nano),
		Ingredients: make([]IngredientBody, 0, len(full.Ingredients)),
		Glassware:   make([]glassBody, 0, len(full.Glassware)),
		Techniques:  make([]techniqueBody, 0, len(full.Techniques)),
		Tags:        make([]tagBody, 0, len(full.Tags)),
	}
	for _, i := range full.Ingredients {
		body.Ingredients = append(body.Ingredients, ingredientToBody(i))
	}
	for _, g := range full.Glassware {
		body.Glassware = append(body.Glassware, glassBody{
			ID: g.ID, NameZh: g.NameZh, NameEn: g.NameEn, CapacityMl: g.CapacityMl, Shape: g.Shape,
		})
	}
	for _, t := range full.Techniques {
		body.Techniques = append(body.Techniques, techniqueBody{
			ID: t.ID, NameZh: t.NameZh, NameEn: t.NameEn, IconID: t.IconID,
		})
	}
	for _, t := range full.Tags {
		body.Tags = append(body.Tags, tagBody{ID: t.ID, NameZh: t.NameZh, NameEn: t.NameEn, Kind: t.Kind})
	}
	out.Body = body
	return out, nil
}

// ─────────────────────────────── GET /ingredients ───────────────────────────────

type ingredientCursor struct {
	Cat  string `json:"c"`
	Name string `json:"n"`
	ID   string `json:"id"`
}

type listIngredientsInput struct {
	Category    string `query:"category"`
	Subcategory string `query:"subcategory"`
	Q           string `query:"q"`
	Cursor      string `query:"cursor"`
	Limit       int    `query:"limit" minimum:"1" maximum:"50" default:"20"`
}

type ingredientListOutput struct {
	Body struct {
		Items      []IngredientBody `json:"items"`
		NextCursor *string          `json:"nextCursor"`
	}
}

func (a *API) listIngredientsHandler(ctx context.Context, in *listIngredientsInput) (*ingredientListOutput, error) {
	f := vocab.IngredientFilter{
		Category:    in.Category,
		Subcategory: in.Subcategory,
		Q:           in.Q,
		Limit:       in.Limit + 1, // 多取一条判断是否还有下一页
	}
	if in.Cursor != "" {
		var c ingredientCursor
		if err := decodeCursor(in.Cursor, &c); err != nil {
			return nil, newErr(http.StatusBadRequest, "cursor.invalid", "游标格式错误")
		}
		f.AfterCat, f.AfterName, f.AfterID = c.Cat, c.Name, c.ID
	}

	list, err := a.vocab.ListIngredients(ctx, f)
	if err != nil {
		return nil, internalErr(err)
	}

	out := &ingredientListOutput{}
	if len(list) > in.Limit {
		list = list[:in.Limit]
		last := list[len(list)-1]
		next := encodeCursor(ingredientCursor{Cat: last.Category, Name: last.NameEn, ID: last.ID})
		out.Body.NextCursor = &next
	}
	out.Body.Items = make([]IngredientBody, 0, len(list))
	for _, i := range list {
		out.Body.Items = append(out.Body.Items, ingredientToBody(i))
	}
	return out, nil
}

// ─────────────────────────────── 单查 ───────────────────────────────

type ingredientGetInput struct {
	ID string `path:"id" maxLength:"64"`
}

type ingredientGetOutput struct {
	Body ingredientDetailBody
}

func (a *API) getIngredientHandler(ctx context.Context, in *ingredientGetInput) (*ingredientGetOutput, error) {
	ing, err := a.vocab.Ingredient(ctx, in.ID)
	if err != nil {
		if errors.Is(err, vocab.ErrNotFound) {
			return nil, newErr(http.StatusNotFound, "ingredient.not_found", "原料不存在")
		}
		return nil, internalErr(err)
	}
	b := ingredientDetailBody{
		IngredientBody: ingredientToBody(*ing),
		DescriptionZh:  ing.DescriptionZh,
		DescriptionEn:  ing.DescriptionEn,
		RecipeCount:    ing.RecipeCount,
	}
	return &ingredientGetOutput{Body: b}, nil
}

type glassGetInput struct {
	ID string `path:"id" maxLength:"64"`
}

type glassGetOutput struct {
	Body glassBody
}

func (a *API) getGlassHandler(ctx context.Context, in *glassGetInput) (*glassGetOutput, error) {
	g, err := a.vocab.Glass(ctx, in.ID)
	if err != nil {
		if errors.Is(err, vocab.ErrNotFound) {
			return nil, newErr(http.StatusNotFound, "glassware.not_found", "杯型不存在")
		}
		return nil, internalErr(err)
	}
	return &glassGetOutput{Body: glassBody{
		ID: g.ID, NameZh: g.NameZh, NameEn: g.NameEn, CapacityMl: g.CapacityMl, Shape: g.Shape,
	}}, nil
}

// internalErr 统一的 500 包装（不向客户端泄露内部错误细节）。
func internalErr(err error) error {
	slog.Error("内部错误", "err", err)
	return newErr(http.StatusInternalServerError, "internal_error", "服务器内部错误")
}
