package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
	"github.com/kafsaki/shaker/apps/api/internal/irv"
	"github.com/kafsaki/shaker/apps/api/internal/recipe"
)

func (a *API) registerRecipes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "recipes-create",
		Method:      http.MethodPost,
		Path:        "/api/v1/recipes",
		Summary:     "创建草稿",
		Description: "只校验 IR 结构（JSON Schema）；业务规则的 error 降级为 warnings 返回，发布时才强制（API 定义 §3）。",
		Security:    bearerSecurity,
	}, a.createRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/recipes/{id}",
		Summary:     "按 UUID 取配方",
		Description: "expand=viz 附带 IR 引用到的原料/杯型视觉数据。viewerState 仅认证时出现。",
	}, a.getRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-get-by-code",
		Method:      http.MethodGet,
		Path:        "/api/v1/r/{code}",
		Summary:     "按短号取已发布配方",
		Description: "公开页面 /r/{code} 用；只返回已发布配方。code 为 6 位 base58 短号。",
	}, a.getRecipeByCodeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-update",
		Method:      http.MethodPatch,
		Path:        "/api/v1/recipes/{id}",
		Summary:     "修改草稿或已发布配方",
		Description: "需 If-Match: <irVersion>（乐观锁）。已发布配方的 IR 变更会重跑完整校验并重建投影。",
		Security:    bearerSecurity,
	}, a.updateRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-publish",
		Method:      http.MethodPost,
		Path:        "/api/v1/recipes/{id}/publish",
		Summary:     "发布配方",
		Description: "跑完整校验（结构 + 业务规则），算派生值、投影原料。限每用户 10 次/小时。",
		Security:    bearerSecurity,
	}, a.publishRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-unpublish",
		Method:      http.MethodPost,
		Path:        "/api/v1/recipes/{id}/unpublish",
		Summary:     "撤回为草稿",
		Security:    bearerSecurity,
	}, a.unpublishRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-delete",
		Method:      http.MethodDelete,
		Path:        "/api/v1/recipes/{id}",
		Summary:     "软删除配方",
		Security:    bearerSecurity,
	}, a.deleteRecipeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-revisions",
		Method:      http.MethodGet,
		Path:        "/api/v1/recipes/{id}/revisions",
		Summary:     "版本历史",
		Security:    bearerSecurity, // 未发布配方仅作者可见；已发布的历史公开
	}, a.listRevisionsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "recipes-revision-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/recipes/{id}/revisions/{version}",
		Summary:     "某个历史版本的 IR",
		Security:    bearerSecurity,
	}, a.getRevisionHandler)
}

/* ─────────────────────────────── 响应体 ─────────────────────────────── */

type recipeAuthorBody struct {
	ID          string  `json:"id"`
	Handle      string  `json:"handle"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
	IsOfficial  bool    `json:"isOfficial"`
}

type recipeTasteBody struct {
	Sweet    int `json:"sweet"`
	Sour     int `json:"sour"`
	Bitter   int `json:"bitter"`
	Strength int `json:"strength"`
}

type recipeCountsBody struct {
	Like    int `json:"like"`
	Comment int `json:"comment"`
	Collect int `json:"collect"`
	View    int `json:"view"`
}

type recipeViewerStateBody struct {
	Liked            bool     `json:"liked"`
	CollectedInMenus []string `json:"collectedInMenus"`
}

type recipeVizIngredientBody struct {
	NameZh string          `json:"nameZh"`
	NameEn string          `json:"nameEn"`
	Viz    json.RawMessage `json:"viz"`
}

type recipeVizGlassBody struct {
	NameZh     string          `json:"nameZh"`
	NameEn     string          `json:"nameEn"`
	CapacityMl int             `json:"capacityMl"`
	Shape      json.RawMessage `json:"shape"`
}

type recipeVizBody struct {
	Ingredients map[string]recipeVizIngredientBody `json:"ingredients"`
	Glassware   map[string]recipeVizGlassBody      `json:"glassware"`
}

type recipeBody struct {
	ID            string              `json:"id"`
	Code          string              `json:"code"`
	Title         string              `json:"title"`
	Subtitle      *string             `json:"subtitle"`
	DescriptionMd *string             `json:"descriptionMd"`
	Lang          string              `json:"lang"`
	Author        *recipeAuthorBody   `json:"author"`
	IR            json.RawMessage     `json:"ir"`
	IRVersion     int                 `json:"irVersion"`
	Family        *string             `json:"family"`
	Source        string              `json:"source"`
	IsCanonical   bool                `json:"isCanonical"`
	ClassicKey    *string             `json:"classicKey"`
	IbaCategory   *string             `json:"ibaCategory"`
	DerivedFrom   *string             `json:"derivedFrom"`
	DerivedCount  int                 `json:"derivedCount"`
	AbvEst        *float64            `json:"abvEst"`
	TotalVolumeMl *float64            `json:"totalVolumeMl"`
	TasteProfile  *recipeTasteBody    `json:"tasteProfile"`
	Difficulty    *int                `json:"difficulty"`
	Servings      int                 `json:"servings"`
	Tags          []string            `json:"tags"`
	CoverURL      *string             `json:"coverUrl"`
	Status        string              `json:"status"`
	Counts        recipeCountsBody    `json:"counts"`
	ViewerState   *recipeViewerStateBody `json:"viewerState,omitempty"`
	PublishedAt   *string             `json:"publishedAt"`
	CreatedAt     string              `json:"createdAt"`
	UpdatedAt     string              `json:"updatedAt"`
	Viz           *recipeVizBody      `json:"viz,omitempty"`
}

type recipeOutput struct {
	Body recipeBody
}

// recipeSaveOutput 创建/更新响应：配方 + 宽松校验的 warnings（编辑器提示用）。
type recipeSaveOutput struct {
	Status int
	Body   struct {
		Recipe   recipeBody        `json:"recipe"`
		Warnings []errorDetailBody `json:"warnings"`
	}
}

func recipeToBody(r *recipe.Recipe) recipeBody {
	b := recipeBody{
		ID: r.ID.String(), Code: r.Code(), Title: r.Title,
		Subtitle: r.Subtitle, DescriptionMd: r.DescriptionMd, Lang: r.Lang,
		IR: json.RawMessage(r.IR), IRVersion: r.IRVersion,
		Family: r.Family, Source: r.Source,
		IsCanonical: r.IsCanonical, ClassicKey: r.ClassicKey,
		IbaCategory: r.IbaCategory, DerivedCount: r.DerivedCount,
		AbvEst: r.AbvEst, TotalVolumeMl: r.TotalVolumeMl,
		Difficulty: r.Difficulty, Servings: 1,
		Tags:   r.Tags,
		CoverURL: r.CoverURL, Status: r.Status,
		Counts: recipeCountsBody{Like: r.LikeCount, Comment: r.CommentCount, Collect: r.CollectCount, View: r.ViewCount},
		CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: r.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if r.Tags == nil {
		b.Tags = []string{}
	}
	if r.Author != nil {
		b.Author = &recipeAuthorBody{
			ID: r.Author.ID, Handle: r.Author.Handle, DisplayName: r.Author.DisplayName,
			AvatarURL: r.Author.AvatarURL, IsOfficial: r.Author.IsOfficial,
		}
	}
	if r.DerivedFrom != nil {
		s := r.DerivedFrom.String()
		b.DerivedFrom = &s
	}
	if r.TasteProfile != nil {
		b.TasteProfile = &recipeTasteBody{
			Sweet: r.TasteProfile.Sweet, Sour: r.TasteProfile.Sour,
			Bitter: r.TasteProfile.Bitter, Strength: r.TasteProfile.Strength,
		}
	}
	if r.PublishedAt != nil {
		s := r.PublishedAt.UTC().Format(time.RFC3339Nano)
		b.PublishedAt = &s
	}
	if ir, err := irv.ParseIR(r.IR); err == nil && ir.Servings != nil {
		b.Servings = *ir.Servings
	}
	return b
}

// canView 可见性：已发布人人可见；草稿/隐藏仅作者（404 而非 403，不泄露存在性）。
func canView(r *recipe.Recipe, claims *auth.Claims) bool {
	if r.Status == "published" {
		return true
	}
	if claims == nil || r.AuthorID == nil {
		return false
	}
	return claims.UserUUID() == *r.AuthorID
}

// recipeDetail 组装详情响应：浏览计数、viewerState、expand=viz。
func (a *API) recipeDetail(ctx context.Context, r *recipe.Recipe, claims *auth.Claims, expand bool) (*recipeOutput, error) {
	if r.Status == "published" {
		a.recipes.IncrementView(ctx, r.ID)
		r.ViewCount++
	}
	body := recipeToBody(r)

	if claims != nil {
		vs, err := a.recipes.ViewerState(ctx, claims.UserUUID(), r.ID)
		if err != nil {
			return nil, internalErr(err)
		}
		collected := vs.CollectedInMenus
		if collected == nil {
			collected = []string{}
		}
		body.ViewerState = &recipeViewerStateBody{Liked: vs.Liked, CollectedInMenus: collected}
	}

	if expand {
		if ir, err := irv.ParseIR(r.IR); err == nil {
			vz, err := a.recipes.VizFor(ctx, ir)
			if err != nil {
				return nil, internalErr(err)
			}
			viz := &recipeVizBody{
				Ingredients: make(map[string]recipeVizIngredientBody, len(vz.Ingredients)),
				Glassware:   make(map[string]recipeVizGlassBody, len(vz.Glassware)),
			}
			for id, ing := range vz.Ingredients {
				viz.Ingredients[id] = recipeVizIngredientBody{NameZh: ing.NameZh, NameEn: ing.NameEn, Viz: ing.Viz}
			}
			for id, g := range vz.Glassware {
				viz.Glassware[id] = recipeVizGlassBody{NameZh: g.NameZh, NameEn: g.NameEn, CapacityMl: g.CapacityMl, Shape: g.Shape}
			}
			body.Viz = viz
		}
	}
	return &recipeOutput{Body: body}, nil
}

/* ─────────────────────────────── 创建 ─────────────────────────────── */

type tasteProfileInput struct {
	Sweet    int `json:"sweet" minimum:"0" maximum:"5"`
	Sour     int `json:"sour" minimum:"0" maximum:"5"`
	Bitter   int `json:"bitter" minimum:"0" maximum:"5"`
	Strength int `json:"strength" minimum:"0" maximum:"5"`
}

type createRecipeInput struct {
	Body struct {
		Title         string             `json:"title" minLength:"1" maxLength:"120"`
		Subtitle      *string            `json:"subtitle,omitempty" maxLength:"120"`
		DescriptionMd *string            `json:"descriptionMd,omitempty" maxLength:"20000"`
		Lang          *string            `json:"lang,omitempty" enum:"zh,en"`
		Family        *string            `json:"family,omitempty" maxLength:"64"`
		ClassicKey    *string            `json:"classicKey,omitempty" maxLength:"64"`
		DerivedFrom   *string            `json:"derivedFrom,omitempty" format:"uuid"`
		TasteProfile  *tasteProfileInput `json:"tasteProfile,omitempty"`
		Difficulty    *int               `json:"difficulty,omitempty" minimum:"1" maximum:"5"`
		Tags          []string           `json:"tags,omitempty" maxItems:"20"`
		IR            json.RawMessage    `json:"ir"`
	}
}

// checkIR 草稿级校验：schema 错误硬拒（400），业务 error 降级为 warnings。
// 返回解析后的 IR（供投影与派生计算）与词表快照。
func (a *API) checkIR(ctx context.Context, irRaw []byte) (*irv.IR, *irv.Vocab, []errorDetailBody, error) {
	vocab, err := a.vocab.IrvVocab(ctx)
	if err != nil {
		return nil, nil, nil, internalErr(err)
	}
	ir, res := irv.Check(irRaw, vocab)
	if ir == nil { // schema 层失败
		return nil, nil, nil, newErr(http.StatusBadRequest, "recipe.ir_invalid",
			"配方 IR 结构校验未通过", diagsToDetails(res.Errors)...)
	}
	warns := diagsToDetails(res.Warnings)
	for _, e := range res.Errors { // 草稿宽松：业务 error 降级为 warn（API 定义 §3）
		warns = append(warns, errorDetailBody{Code: e.Code, Message: e.Message, Path: e.Path})
	}
	return ir, vocab, warns, nil
}

func (a *API) createRecipeHandler(ctx context.Context, in *createRecipeInput) (*recipeSaveOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	ir, vocab, warns, err := a.checkIR(ctx, in.Body.IR)
	if err != nil {
		return nil, err
	}

	ci := recipe.CreateInput{
		Title: in.Body.Title, Subtitle: in.Body.Subtitle, DescriptionMd: in.Body.DescriptionMd,
		Lang: "zh", Family: in.Body.Family, ClassicKey: in.Body.ClassicKey,
		TasteProfile: tasteToDomain(in.Body.TasteProfile), Difficulty: in.Body.Difficulty,
		Tags: in.Body.Tags, IR: ir, IRRaw: in.Body.IR, Vocab: vocab,
	}
	if in.Body.Lang != nil {
		ci.Lang = *in.Body.Lang
	}
	if in.Body.DerivedFrom != nil {
		id, err := uuid.Parse(*in.Body.DerivedFrom)
		if err != nil {
			return nil, newErr(http.StatusBadRequest, "recipe.derived_invalid", "derivedFrom 不是合法的 UUID")
		}
		ci.DerivedFrom = &id
	}

	r, err := a.recipes.Create(ctx, claims.UserUUID(), ci)
	if err != nil {
		return nil, recipeErr(err)
	}
	out := &recipeSaveOutput{Status: http.StatusCreated}
	out.Body.Recipe = recipeToBody(r)
	out.Body.Warnings = warns
	if out.Body.Warnings == nil {
		out.Body.Warnings = []errorDetailBody{}
	}
	return out, nil
}

func tasteToDomain(t *tasteProfileInput) *recipe.TasteProfile {
	if t == nil {
		return nil
	}
	return &recipe.TasteProfile{Sweet: t.Sweet, Sour: t.Sour, Bitter: t.Bitter, Strength: t.Strength}
}

/* ─────────────────────────────── 读取 ─────────────────────────────── */

type recipeGetInput struct {
	ID     string `path:"id" format:"uuid"`
	Expand string `query:"expand" enum:"viz"`
}

func (a *API) getRecipeHandler(ctx context.Context, in *recipeGetInput) (*recipeOutput, error) {
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	r, err := a.recipes.Get(ctx, id)
	if err != nil {
		return nil, recipeErr(err)
	}
	if !canView(r, claims) {
		return nil, newErr(http.StatusNotFound, "recipe.not_found", "配方不存在")
	}
	return a.recipeDetail(ctx, r, claims, in.Expand == "viz")
}

type recipeCodeGetInput struct {
	Code   string `path:"code" minLength:"6" maxLength:"11" pattern:"^[1-9A-HJ-NP-Za-km-z]+$"`
	Expand string `query:"expand" enum:"viz"`
}

func (a *API) getRecipeByCodeHandler(ctx context.Context, in *recipeCodeGetInput) (*recipeOutput, error) {
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	r, err := a.recipes.GetByCode(ctx, in.Code)
	if err != nil {
		return nil, recipeErr(err)
	}
	return a.recipeDetail(ctx, r, claims, in.Expand == "viz")
}

/* ─────────────────────────────── 更新 ─────────────────────────────── */

type updateRecipeInput struct {
	ID     string `path:"id" format:"uuid"`
	IfMatch string `header:"If-Match"`
	Body    struct {
		Title         *string            `json:"title,omitempty" minLength:"1" maxLength:"120"`
		Subtitle      *string            `json:"subtitle,omitempty" maxLength:"120"`
		DescriptionMd *string            `json:"descriptionMd,omitempty" maxLength:"20000"`
		Lang          *string            `json:"lang,omitempty" enum:"zh,en"`
		Family        *string            `json:"family,omitempty" maxLength:"64"`
		ClassicKey    *string            `json:"classicKey,omitempty" maxLength:"64"`
		DerivedFrom   *string            `json:"derivedFrom,omitempty" format:"uuid"`
		TasteProfile  *tasteProfileInput `json:"tasteProfile,omitempty"`
		Difficulty    *int               `json:"difficulty,omitempty" minimum:"1" maximum:"5"`
		CoverURL      *string            `json:"coverUrl,omitempty" maxLength:"500"`
		Tags          []string           `json:"tags,omitempty" maxItems:"20"`
		IR            json.RawMessage    `json:"ir,omitempty"`
	}
}

func (a *API) updateRecipeHandler(ctx context.Context, in *updateRecipeInput) (*recipeSaveOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	ifMatch, err := parseIfMatch(in.IfMatch)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.if_match_invalid",
			"If-Match 必须是当前 irVersion（数字，可带引号）")
	}

	var ir *irv.IR
	var vocab *irv.Vocab
	var warns []errorDetailBody
	if in.Body.IR != nil {
		var ierr error
		if ir, vocab, warns, ierr = a.checkIR(ctx, in.Body.IR); ierr != nil {
			return nil, ierr
		}
	}

	ui := recipe.UpdateInput{
		Title: in.Body.Title, Subtitle: in.Body.Subtitle, DescriptionMd: in.Body.DescriptionMd,
		Lang: in.Body.Lang, Family: in.Body.Family, ClassicKey: in.Body.ClassicKey,
		TasteProfile: tasteToDomain(in.Body.TasteProfile), Difficulty: in.Body.Difficulty,
		CoverURL: in.Body.CoverURL, Tags: in.Body.Tags,
		IR: ir, IRRaw: in.Body.IR, IfMatch: ifMatch,
		EditorID: claims.UserUUID(), Vocab: vocab,
	}
	if in.Body.DerivedFrom != nil {
		did, err := uuid.Parse(*in.Body.DerivedFrom)
		if err != nil {
			return nil, newErr(http.StatusBadRequest, "recipe.derived_invalid", "derivedFrom 不是合法的 UUID")
		}
		ui.DerivedFrom = &did
	}

	r, err := a.recipes.Update(ctx, id, claims.UserUUID(), ui)
	if err != nil {
		return nil, recipeErr(err)
	}
	out := &recipeSaveOutput{Status: http.StatusOK}
	out.Body.Recipe = recipeToBody(r)
	out.Body.Warnings = warns
	if out.Body.Warnings == nil {
		out.Body.Warnings = []errorDetailBody{}
	}
	return out, nil
}

// parseIfMatch 接受 `3` 与 `"3"` 两种形式（ETag 习惯带引号）。
func parseIfMatch(v string) (int, error) {
	return strconv.Atoi(strings.Trim(strings.TrimSpace(v), `"`))
}

/* ─────────────────────────────── 发布 / 撤回 / 删除 ─────────────────────────────── */

type recipeActionInput struct {
	ID string `path:"id" format:"uuid"`
}

func (a *API) publishRecipeHandler(ctx context.Context, in *recipeActionInput) (*recipeOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	vocab, err := a.vocab.IrvVocab(ctx)
	if err != nil {
		return nil, internalErr(err)
	}
	r, err := a.recipes.Publish(ctx, id, claims.UserUUID(), vocab)
	if err != nil {
		return nil, recipeErr(err)
	}
	return a.recipeDetail(ctx, r, claims, false)
}

func (a *API) unpublishRecipeHandler(ctx context.Context, in *recipeActionInput) (*recipeOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	r, err := a.recipes.Unpublish(ctx, id, claims.UserUUID())
	if err != nil {
		return nil, recipeErr(err)
	}
	return a.recipeDetail(ctx, r, claims, false)
}

func (a *API) deleteRecipeHandler(ctx context.Context, in *recipeActionInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	if err := a.recipes.Delete(ctx, id, claims.UserUUID()); err != nil {
		return nil, recipeErr(err)
	}
	return &emptyOutput{}, nil
}

/* ─────────────────────────────── 版本历史 ─────────────────────────────── */

type revisionBody struct {
	Version   int     `json:"version"`
	Title     string  `json:"title"`
	Note      *string `json:"note"`
	EditorID  *string `json:"editorId"`
	CreatedAt string  `json:"createdAt"`
}

type revisionListOutput struct {
	Body struct {
		Items []revisionBody `json:"items"`
	}
}

type revisionGetInput struct {
	ID      string `path:"id" format:"uuid"`
	Version int    `path:"version" minimum:"1"`
}

type revisionDetailOutput struct {
	Body struct {
		Version   int             `json:"version"`
		Title     string          `json:"title"`
		Note      *string         `json:"note"`
		EditorID  *string         `json:"editorId"`
		CreatedAt string          `json:"createdAt"`
		IR        json.RawMessage `json:"ir"`
	}
}

func (a *API) listRevisionsHandler(ctx context.Context, in *recipeGetInput) (*revisionListOutput, error) {
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	r, err := a.recipes.Get(ctx, id)
	if err != nil {
		return nil, recipeErr(err)
	}
	if !canView(r, claims) {
		return nil, newErr(http.StatusNotFound, "recipe.not_found", "配方不存在")
	}
	revs, err := a.recipes.Revisions(ctx, id)
	if err != nil {
		return nil, internalErr(err)
	}
	out := &revisionListOutput{}
	out.Body.Items = make([]revisionBody, 0, len(revs))
	for _, rev := range revs {
		out.Body.Items = append(out.Body.Items, revisionToBody(rev))
	}
	return out, nil
}

func (a *API) getRevisionHandler(ctx context.Context, in *revisionGetInput) (*revisionDetailOutput, error) {
	id, err := uuid.Parse(in.ID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "recipe.id_invalid", "配方 ID 不是合法的 UUID")
	}
	claims, _ := ctx.Value(ctxClaims).(*auth.Claims)
	r, err := a.recipes.Get(ctx, id)
	if err != nil {
		return nil, recipeErr(err)
	}
	if !canView(r, claims) {
		return nil, newErr(http.StatusNotFound, "recipe.not_found", "配方不存在")
	}
	rev, ir, err := a.recipes.Revision(ctx, id, in.Version)
	if err != nil {
		return nil, recipeErr(err)
	}
	out := &revisionDetailOutput{}
	out.Body.Version = rev.Version
	out.Body.Title = rev.Title
	out.Body.Note = rev.Note
	out.Body.CreatedAt = rev.CreatedAt.UTC().Format(time.RFC3339Nano)
	out.Body.IR = ir
	if rev.EditorID != nil {
		s := rev.EditorID.String()
		out.Body.EditorID = &s
	}
	return out, nil
}

func revisionToBody(rev recipe.Revision) revisionBody {
	b := revisionBody{
		Version: rev.Version, Title: rev.Title, Note: rev.Note,
		CreatedAt: rev.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if rev.EditorID != nil {
		s := rev.EditorID.String()
		b.EditorID = &s
	}
	return b
}

/* ─────────────────────────────── 错误映射 ─────────────────────────────── */

func diagsToDetails(diags []irv.Diagnostic) []errorDetailBody {
	out := make([]errorDetailBody, 0, len(diags))
	for _, d := range diags {
		out = append(out, errorDetailBody{Code: d.Code, Message: d.Message, Path: d.Path})
	}
	return out
}

// recipeErr recipe 包业务错误 → HTTP。
func recipeErr(err error) error {
	var vc *recipe.VersionConflict
	var ve *recipe.ValidationError
	switch {
	case errors.Is(err, recipe.ErrNotFound):
		return newErr(http.StatusNotFound, "recipe.not_found", "配方不存在")
	case errors.Is(err, recipe.ErrForbidden):
		return newErr(http.StatusForbidden, "recipe.forbidden", "只能操作自己的配方")
	case errors.Is(err, recipe.ErrUnknownGlass):
		return newErr(http.StatusBadRequest, "vocab.unknown_glass", "杯型不在词表中")
	case errors.Is(err, recipe.ErrUnknownTag):
		return newErr(http.StatusBadRequest, "tag.not_found", "标签不存在")
	case errors.Is(err, recipe.ErrUnknownDerived):
		return newErr(http.StatusBadRequest, "recipe.derived_not_found", "血缘配方不存在")
	case errors.Is(err, recipe.ErrUnknownClassicKey):
		return newErr(http.StatusBadRequest, "recipe.classic_key_not_found", "经典锚点不存在")
	case errors.Is(err, recipe.ErrNotPublishable):
		return newErr(http.StatusConflict, "recipe.not_publishable", "当前状态不能发布")
	case errors.As(err, &vc):
		return newErr(http.StatusConflict, "recipe.version_conflict", vc.Error(),
			errorDetailBody{Code: "current_version", Message: strconv.Itoa(vc.Current), Path: "irVersion"})
	case errors.As(err, &ve):
		return newErr(http.StatusBadRequest, "recipe.validation_failed", "配方校验未通过", diagsToDetails(ve.Details)...)
	default:
		return internalErr(err)
	}
}
