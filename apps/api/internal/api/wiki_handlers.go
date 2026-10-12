package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/wiki"
)

// 百科式维护（ADR-027）。经典配方的修订复用 PATCH /recipes/{id}（编辑身份走编辑通道），
// 这里是原料词条、修订动态、编辑名册与身份管理。
func (a *API) registerWiki(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "ingredients-update",
		Method:      http.MethodPatch,
		Path:        "/api/v1/ingredients/{id}",
		Summary:     "修订原料词条",
		Description: "仅编辑/管理员。整表提交名称、别名与介绍；If-Match 为当前 wikiVersion。" +
			"ABV、品类与视觉样式 v1 不开放修订。",
		Security: bearerSecurity,
	}, a.updateIngredientHandler)

	huma.Register(api, huma.Operation{
		OperationID: "ingredients-revisions",
		Method:      http.MethodGet,
		Path:        "/api/v1/ingredients/{id}/revisions",
		Summary:     "原料词条修订历史",
		Description: "新→旧，含每一版的完整快照。第 0 版是种子原文（首次修订时存档）。",
	}, a.ingredientRevisionsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "ingredients-revision-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/ingredients/{id}/revisions/{version}",
		Summary:     "原料词条的某一版",
	}, a.ingredientRevisionHandler)

	huma.Register(api, huma.Operation{
		OperationID: "wiki-changes",
		Method:      http.MethodGet,
		Path:        "/api/v1/wiki/changes",
		Summary:     "最近修订",
		Description: "经典配方与原料词条的修订动态，新→旧。",
	}, a.wikiChangesHandler)

	huma.Register(api, huma.Operation{
		OperationID: "wiki-editors",
		Method:      http.MethodGet,
		Path:        "/api/v1/wiki/editors",
		Summary:     "编辑名册",
	}, a.wikiEditorsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "admin-set-role",
		Method:      http.MethodPut,
		Path:        "/api/v1/admin/users/{handle}/role",
		Summary:     "授予/撤销编辑身份",
		Description: "仅管理员。只在 user 与 editor 之间切换；管理员由部署配置 SHAKER_ADMIN_HANDLES 产生。",
		Security:    bearerSecurity,
	}, a.setRoleHandler)
}

/* ────────────────────────── 响应体 ────────────────────────── */

type ingredientSnapshotBody struct {
	NameZh        string   `json:"nameZh"`
	NameEn        string   `json:"nameEn"`
	Aliases       []string `json:"aliases"`
	DescriptionZh *string  `json:"descriptionZh"`
	DescriptionEn *string  `json:"descriptionEn"`
}

type ingredientRevisionBody struct {
	Version      int                    `json:"version"`
	Note         *string                `json:"note"`
	EditorHandle *string                `json:"editorHandle"`
	EditorName   *string                `json:"editorName"`
	Snapshot     ingredientSnapshotBody `json:"snapshot"`
	CreatedAt    string                 `json:"createdAt" format:"date-time"`
}

type wikiChangeBody struct {
	Kind         string  `json:"kind" enum:"recipe,ingredient"`
	TargetID     string  `json:"targetId" doc:"配方 UUID 或原料 ID"`
	TargetKey    string  `json:"targetKey" doc:"classicKey 或原料 ID（前端路由用）"`
	Title        string  `json:"title"`
	Version      int     `json:"version"`
	Note         *string `json:"note"`
	EditorHandle *string `json:"editorHandle"`
	EditorName   *string `json:"editorName"`
	CreatedAt    string  `json:"createdAt" format:"date-time"`
}

type wikiMemberBody struct {
	ID          string  `json:"id" format:"uuid"`
	Handle      string  `json:"handle"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
	Role        string  `json:"role" enum:"user,editor,admin"`
	EditCount   int     `json:"editCount"`
	LastEditAt  *string `json:"lastEditAt" format:"date-time"`
}

func ingredientRevisionToBody(r wiki.IngredientRevision) ingredientRevisionBody {
	b := ingredientRevisionBody{
		Version: r.Version, Note: r.Note, EditorHandle: r.EditorHandle, EditorName: r.EditorName,
		CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	_ = json.Unmarshal(r.Snapshot, &b.Snapshot) // 快照由本服务写入，结构固定
	if b.Snapshot.Aliases == nil {
		b.Snapshot.Aliases = []string{}
	}
	return b
}

func memberToBody(m wiki.Member) wikiMemberBody {
	b := wikiMemberBody{
		ID: m.ID.String(), Handle: m.Handle, DisplayName: m.DisplayName, AvatarURL: m.AvatarURL,
		Role: m.Role, EditCount: m.EditCount,
	}
	if m.LastEditAt != nil {
		s := m.LastEditAt.UTC().Format(time.RFC3339Nano)
		b.LastEditAt = &s
	}
	return b
}

/* ────────────────────────── handler ────────────────────────── */

type updateIngredientInput struct {
	ID      string `path:"id" maxLength:"64"`
	IfMatch string `header:"If-Match"`
	Body    struct {
		NameZh        string   `json:"nameZh" minLength:"1" maxLength:"60"`
		NameEn        string   `json:"nameEn" minLength:"1" maxLength:"80"`
		Aliases       []string `json:"aliases" maxItems:"30"`
		DescriptionZh *string  `json:"descriptionZh,omitempty" maxLength:"8000"`
		DescriptionEn *string  `json:"descriptionEn,omitempty" maxLength:"8000"`
		Note          *string  `json:"note,omitempty" maxLength:"200" doc:"修订摘要"`
	}
}

func (a *API) updateIngredientHandler(ctx context.Context, in *updateIngredientInput) (*ingredientGetOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	ifMatch, err := parseIfMatch(in.IfMatch)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "wiki.if_match_invalid",
			"If-Match 必须是当前 wikiVersion（数字，可带引号）")
	}
	role, err := a.wiki.Role(ctx, claims.UserUUID())
	if err != nil {
		return nil, internalErr(err)
	}
	if !wiki.CanEdit(role) {
		return nil, wikiErr(wiki.ErrForbidden)
	}
	for _, alias := range in.Body.Aliases {
		if len([]rune(alias)) > 60 {
			return nil, newErr(http.StatusBadRequest, "wiki.alias_too_long", "单个别名不能超过 60 字")
		}
	}
	if _, err := a.wiki.UpdateIngredient(ctx, in.ID, claims.UserUUID(), wiki.IngredientEdit{
		NameZh: in.Body.NameZh, NameEn: in.Body.NameEn, Aliases: in.Body.Aliases,
		DescriptionZh: in.Body.DescriptionZh, DescriptionEn: in.Body.DescriptionEn,
		Note: in.Body.Note, IfMatch: ifMatch,
	}); err != nil {
		return nil, wikiErr(err)
	}
	return a.getIngredientHandler(ctx, &ingredientGetInput{ID: in.ID})
}

type ingredientRevisionsOutput struct {
	Body struct {
		Items []ingredientRevisionBody `json:"items"`
	}
}

func (a *API) ingredientRevisionsHandler(ctx context.Context, in *ingredientGetInput) (*ingredientRevisionsOutput, error) {
	revs, err := a.wiki.IngredientRevisions(ctx, in.ID)
	if err != nil {
		return nil, wikiErr(err)
	}
	out := &ingredientRevisionsOutput{}
	out.Body.Items = make([]ingredientRevisionBody, 0, len(revs))
	for _, r := range revs {
		out.Body.Items = append(out.Body.Items, ingredientRevisionToBody(r))
	}
	return out, nil
}

type ingredientRevisionInput struct {
	ID      string `path:"id" maxLength:"64"`
	Version int    `path:"version" minimum:"0"`
}

func (a *API) ingredientRevisionHandler(ctx context.Context, in *ingredientRevisionInput) (*struct {
	Body ingredientRevisionBody
}, error) {
	r, err := a.wiki.IngredientRevisionAt(ctx, in.ID, in.Version)
	if err != nil {
		return nil, wikiErr(err)
	}
	return &struct{ Body ingredientRevisionBody }{Body: ingredientRevisionToBody(*r)}, nil
}

type wikiChangesInput struct {
	Limit int `query:"limit" minimum:"1" maximum:"100" default:"50"`
}

func (a *API) wikiChangesHandler(ctx context.Context, in *wikiChangesInput) (*struct {
	Body struct {
		Items []wikiChangeBody `json:"items"`
	}
}, error) {
	limit := in.Limit
	if limit == 0 {
		limit = 50
	}
	changes, err := a.wiki.RecentChanges(ctx, limit)
	if err != nil {
		return nil, internalErr(err)
	}
	out := &struct {
		Body struct {
			Items []wikiChangeBody `json:"items"`
		}
	}{}
	out.Body.Items = make([]wikiChangeBody, 0, len(changes))
	for _, c := range changes {
		out.Body.Items = append(out.Body.Items, wikiChangeBody{
			Kind: c.Kind, TargetID: c.TargetID, TargetKey: c.TargetKey, Title: c.Title,
			Version: c.Version, Note: c.Note, EditorHandle: c.EditorHandle, EditorName: c.EditorName,
			CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	return out, nil
}

type wikiMembersOutput struct {
	Body struct {
		Items []wikiMemberBody `json:"items"`
	}
}

func (a *API) wikiEditorsHandler(ctx context.Context, _ *struct{}) (*wikiMembersOutput, error) {
	members, err := a.wiki.Editors(ctx)
	if err != nil {
		return nil, internalErr(err)
	}
	out := &wikiMembersOutput{}
	out.Body.Items = make([]wikiMemberBody, 0, len(members))
	for _, m := range members {
		out.Body.Items = append(out.Body.Items, memberToBody(m))
	}
	return out, nil
}

type setRoleInput struct {
	Handle string `path:"handle" pattern:"^[a-zA-Z0-9_]{3,24}$"`
	Body   struct {
		Role string `json:"role" enum:"user,editor"`
	}
}

func (a *API) setRoleHandler(ctx context.Context, in *setRoleInput) (*struct {
	Body wikiMemberBody
}, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	m, err := a.wiki.SetRole(ctx, claims.UserUUID(), in.Handle, in.Body.Role)
	if err != nil {
		return nil, wikiErr(err)
	}
	return &struct{ Body wikiMemberBody }{Body: memberToBody(*m)}, nil
}

/* ────────────────────────── 错误映射 ────────────────────────── */

func wikiErr(err error) error {
	var vc *wiki.VersionConflict
	switch {
	case errors.Is(err, wiki.ErrNotFound):
		return newErr(http.StatusNotFound, "wiki.not_found", "条目不存在")
	case errors.Is(err, wiki.ErrForbidden):
		return newErr(http.StatusForbidden, "wiki.forbidden", "需要编辑身份")
	case errors.Is(err, wiki.ErrSelf):
		return newErr(http.StatusUnprocessableEntity, "wiki.self", "不能修改自己的身份")
	case errors.Is(err, wiki.ErrAdmin):
		return newErr(http.StatusUnprocessableEntity, "wiki.admin_immutable", "管理员的身份只能通过部署配置调整")
	case errors.As(err, &vc):
		return newErr(http.StatusConflict, "wiki.version_conflict", vc.Error(),
			errorDetailBody{Code: "current_version", Message: strconv.Itoa(vc.Current), Path: "wikiVersion"})
	default:
		return internalErr(err)
	}
}
