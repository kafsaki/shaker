package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
	"github.com/kafsaki/shaker/apps/api/internal/menu"
)

func (a *API) registerMenus(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "menus-create",
		Method:      http.MethodPost,
		Path:        "/api/v1/menus",
		Summary:     "建酒单",
		Security:    bearerSecurity,
	}, a.createMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/menus/{id}",
		Summary:     "酒单详情",
		Description: "按 visibility 鉴权：public 对所有人；private 仅主人。",
	}, a.getMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-update",
		Method:      http.MethodPatch,
		Path:        "/api/v1/menus/{id}",
		Summary:     "改标题/描述/可见性",
		Security:    bearerSecurity,
	}, a.updateMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-delete",
		Method:      http.MethodDelete,
		Path:        "/api/v1/menus/{id}",
		Summary:     "删除酒单（软删）",
		Security:    bearerSecurity,
	}, a.deleteMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menu-items-add",
		Method:      http.MethodPut,
		Path:        "/api/v1/menus/{id}/items/{recipeId}",
		Summary:     "配方加入酒单",
		Description: "幂等：已在酒单里则刷新 note。body 可带 note。",
		Security:    bearerSecurity,
	}, a.addMenuItemHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menu-items-remove",
		Method:      http.MethodDelete,
		Path:        "/api/v1/menus/{id}/items/{recipeId}",
		Summary:     "配方移出酒单",
		Description: "幂等。",
		Security:    bearerSecurity,
	}, a.removeMenuItemHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menu-items-reorder",
		Method:      http.MethodPost,
		Path:        "/api/v1/menus/{id}/items/reorder",
		Summary:     "重排酒单条目",
		Description: "{recipeId, afterRecipeId?}——afterRecipeId 省略则移到最前；服务端取中点插值。",
		Security:    bearerSecurity,
	}, a.reorderMenuItemHandler)

	huma.Register(api, huma.Operation{
		OperationID: "me-menus",
		Method:      http.MethodGet,
		Path:        "/api/v1/me/menus",
		Summary:     "我的全部酒单",
		Description: "含私密。containsRecipe=<uuid> 时附带每个酒单是否已含该配方（「加进酒单」弹层用）。",
		Security:    bearerSecurity,
	}, a.myMenusHandler)

	huma.Register(api, huma.Operation{
		OperationID: "users-menus",
		Method:      http.MethodGet,
		Path:        "/api/v1/users/{handle}/menus",
		Summary:     "某人的酒单",
		Description: "本人（携带 Bearer）可见全部含私密；他人仅公开。",
	}, a.userMenusHandler)
}

/* ────────────────────────── 响应体 ────────────────────────── */

type menuVisibility string

type menuOwnerBody struct {
	ID          string  `json:"id"`
	Handle      string  `json:"handle"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
	IsOfficial  bool    `json:"isOfficial"`
}

type menuBody struct {
	ID             uuid.UUID            `json:"id"`
	Title          string               `json:"title"`
	Description    *string              `json:"description"`
	CoverURL       *string              `json:"coverUrl"`
	Visibility     string               `json:"visibility"`
	ItemCount      int                  `json:"itemCount"`
	CoverURLs      []string             `json:"coverUrls"`       // position 前 3 条目的配方暗色封面（展示投影，可为空数组）
	CoverURLsLight []string             `json:"coverUrlsLight"`  // 同上，亮色封面（缺失的版本不补，前端回落）
	ViewerIsOwner  bool                 `json:"viewerIsOwner"`   // 当前请求者是否为酒单主人（前端以此判定属主 UI）
	Owner          *menuOwnerBody       `json:"owner,omitempty"` // 酒单主人（列表/详情展示）
	RecipeCards    []menuRecipeCardBody `json:"recipeCards"`     // position 前 N 张配方卡片（列表行预览，可为空数组）
	CreatedAt      string               `json:"createdAt" format:"date-time"`
	UpdatedAt      string               `json:"updatedAt" format:"date-time"`
}

type menuRecipeCardBody struct {
	ID            uuid.UUID         `json:"id"`
	Code          string            `json:"code"`
	Title         string            `json:"title"`
	ClassicKey    *string           `json:"classicKey"`
	IsCanonical   bool              `json:"isCanonical"`
	Family        *string           `json:"family"`
	CoverURL      *string           `json:"coverUrl"`
	CoverURLLight *string           `json:"coverUrlLight"`
	LikeCount     int               `json:"likeCount"`
	CommentCount  int               `json:"commentCount"`
	CollectCount  int               `json:"collectCount"`
	Deleted       bool              `json:"deleted"`
	Author        *recipeAuthorBody `json:"author"`
}

type menuItemBody struct {
	Recipe  menuRecipeCardBody `json:"recipe"`
	Note    *string            `json:"note"`
	AddedAt string             `json:"addedAt" format:"date-time"`
}

type menuDetailOutput struct {
	Body struct {
		Menu  menuBody       `json:"menu"`
		Items []menuItemBody `json:"items"`
	}
}

type menuListOutput struct {
	Body struct {
		Items      []menuBody `json:"items"`
		NextCursor *string    `json:"nextCursor"`
	}
}

// MenuBody 是 menuBody 的导出别名：huma 只合并「已导出」的匿名嵌入字段，
// 小写类型名会被当作未导出字段跳过，导致 OpenAPI 里 MyMenuBody 丢了全部菜单字段
// （encoding/json 不区分大小写，运行时响应一直是完整的）。
type MenuBody = menuBody

type myMenuBody struct {
	MenuBody
	ContainsRecipe bool `json:"containsRecipe"` // 仅带 containsRecipe 查询时有意义
}

type myMenusOutput struct {
	Body struct {
		Items []myMenuBody `json:"items"`
	}
}

// menuPreviewLimit 列表页每行酒单展示的配方卡片数。
const menuPreviewLimit = 6

func menuToBody(m *menu.Menu, isOwner bool) menuBody {
	return menuBody{
		ID: m.ID, Title: m.Title, Description: m.Description, CoverURL: m.CoverURL,
		Visibility: m.Visibility, ItemCount: m.ItemCount, CoverURLs: []string{}, CoverURLsLight: []string{},
		ViewerIsOwner: isOwner, RecipeCards: []menuRecipeCardBody{},
		CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: m.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func menuOwnerOut(o *menu.OwnerBrief) *menuOwnerBody {
	return &menuOwnerBody{
		ID: o.ID.String(), Handle: o.Handle, DisplayName: o.DisplayName,
		AvatarURL: o.AvatarURL, IsOfficial: o.IsOfficial,
	}
}

func menuCardBody(c menu.RecipeCard) menuRecipeCardBody {
	b := menuRecipeCardBody{
		ID: c.ID, Code: c.Code(), Title: c.Title,
		ClassicKey: c.ClassicKey, IsCanonical: c.IsCanonical, Family: c.Family,
		CoverURL: c.CoverURL, CoverURLLight: c.CoverURLLight,
		LikeCount: c.LikeCount, CommentCount: c.CommentCount, CollectCount: c.CollectCount, Deleted: c.Deleted,
	}
	if c.Author != nil {
		b.Author = &recipeAuthorBody{
			ID: c.Author.ID, Handle: c.Author.Handle, DisplayName: c.Author.DisplayName,
			AvatarURL: c.Author.AvatarURL, IsOfficial: c.Author.IsOfficial,
		}
	}
	return b
}

func menuCardBodies(cards []menu.RecipeCard) []menuRecipeCardBody {
	out := make([]menuRecipeCardBody, 0, len(cards))
	for _, c := range cards {
		out = append(out, menuCardBody(c))
	}
	return out
}

// menuEnrich 批量补齐列表/详情共用的 Owner 与 RecipeCards。
func (a *API) menuEnrich(ctx context.Context, ids []uuid.UUID) (
	map[uuid.UUID]*menuOwnerBody, map[uuid.UUID][]menuRecipeCardBody, error) {
	owners, err := a.menus.Owners(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	previews, err := a.menus.Previews(ctx, ids, menuPreviewLimit)
	if err != nil {
		return nil, nil, err
	}
	ownerOut := make(map[uuid.UUID]*menuOwnerBody, len(owners))
	for id, o := range owners {
		oo := o
		ownerOut[id] = menuOwnerOut(&oo)
	}
	cardOut := make(map[uuid.UUID][]menuRecipeCardBody, len(previews))
	for id, cs := range previews {
		cardOut[id] = menuCardBodies(cs)
	}
	return ownerOut, cardOut, nil
}

// menusToBodies 批量把酒单列表补齐封面投影 / 主人 / 预览卡片，转成响应体。
// isOwner 决定 ViewerIsOwner（列表页/搜索结果页对他人一律 false）。
func (a *API) menusToBodies(ctx context.Context, items []menu.Menu, isOwner bool) ([]menuBody, error) {
	ids := make([]uuid.UUID, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	cov, err := a.menus.Covers(ctx, ids)
	if err != nil {
		return nil, menuErr(err)
	}
	ownerOut, cardOut, err := a.menuEnrich(ctx, ids)
	if err != nil {
		return nil, menuErr(err)
	}
	out := make([]menuBody, 0, len(items))
	for i := range items {
		mb := menuToBody(&items[i], isOwner)
		if set := cov[items[i].ID]; set != nil {
			if len(set.Dark) > 0 {
				mb.CoverURLs = set.Dark
			}
			if len(set.Light) > 0 {
				mb.CoverURLsLight = set.Light
			}
		}
		mb.Owner = ownerOut[items[i].ID]
		if cards := cardOut[items[i].ID]; cards != nil {
			mb.RecipeCards = cards
		}
		out = append(out, mb)
	}
	return out, nil
}

// itemCovers 详情响应的封面投影：items 已按 position 排序，
// 跳过已删条目，暗/亮各最多取 3 张（缺失的版本不补，前端回落）。
func itemCovers(items []menu.Item) (dark, light []string) {
	dark, light = []string{}, []string{}
	for _, it := range items {
		if it.Recipe.Deleted {
			continue
		}
		if it.Recipe.CoverURL != nil && len(dark) < 3 {
			dark = append(dark, *it.Recipe.CoverURL)
		}
		if it.Recipe.CoverURLLight != nil && len(light) < 3 {
			light = append(light, *it.Recipe.CoverURLLight)
		}
		if len(dark) == 3 && len(light) == 3 {
			break
		}
	}
	return dark, light
}

func menuItemsOut(items []menu.Item) []menuItemBody {
	out := make([]menuItemBody, 0, len(items))
	for _, it := range items {
		out = append(out, menuItemBody{
			Recipe:  menuCardBody(it.Recipe),
			Note:    it.Note,
			AddedAt: it.AddedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	return out
}

/* ────────────────────────── handler ────────────────────────── */

// menuIDInput/menuItemInput 直接作输入类型没问题，但嵌入匿名结构时
// huma 不展平未导出嵌入类型的字段（vocab 任务同款坑）→ 路径参数丢失。
// 带请求体的组合一律平铺字段。
type menuIDInput struct {
	ID uuid.UUID `path:"id" format:"uuid"`
}

type menuItemInput struct {
	ID       uuid.UUID `path:"id" format:"uuid"`
	RecipeID uuid.UUID `path:"recipeId" format:"uuid"`
}

type menuUpdateInput struct {
	ID   uuid.UUID `path:"id" format:"uuid"`
	Body struct {
		Title       *string         `json:"title" minLength:"1" maxLength:"120" required:"false"`
		Description *string         `json:"description" maxLength:"2000" required:"false"`
		Visibility  *menuVisibility `json:"visibility" enum:"private,public" required:"false"`
	}
}

type menuAddItemInput struct {
	ID     uuid.UUID `path:"id" format:"uuid"`
	Recipe uuid.UUID `path:"recipeId" format:"uuid"`
	Body   struct {
		Note *string `json:"note" maxLength:"500" required:"false"`
	}
}

type menuReorderInput struct {
	ID   uuid.UUID `path:"id" format:"uuid"`
	Body struct {
		RecipeID      uuid.UUID  `json:"recipeId" format:"uuid"`
		AfterRecipeID *uuid.UUID `json:"afterRecipeId" format:"uuid" required:"false"`
	}
}

type menuCreateOutput struct {
	Status int
	Body   menuBody
}

func (a *API) createMenuHandler(ctx context.Context, in *struct {
	Body struct {
		Title       string         `json:"title" minLength:"1" maxLength:"120"`
		Description *string        `json:"description" maxLength:"2000" required:"false"`
		Visibility  menuVisibility `json:"visibility" enum:"private,public" default:"private" required:"false"`
	}
}) (*menuCreateOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	m, err := a.menus.Create(ctx, claims.UserUUID(), in.Body.Title, in.Body.Description, string(in.Body.Visibility))
	if err != nil {
		return nil, menuErr(err)
	}
	return &menuCreateOutput{Status: http.StatusCreated, Body: menuToBody(m, true)}, nil
}

// canViewMenu 可见性规则：public → 所有人；private → 主人。
func canViewMenu(m *menu.Menu, viewer *uuid.UUID) bool {
	return m.Visibility == "public" || (viewer != nil && *viewer == m.OwnerID)
}

func (a *API) getMenuHandler(ctx context.Context, in *menuIDInput) (*menuDetailOutput, error) {
	m, err := a.menus.Get(ctx, in.ID)
	if err != nil {
		return nil, menuErr(err)
	}
	viewer := viewerID(ctx)
	if !canViewMenu(m, viewer) {
		return nil, newErr(http.StatusNotFound, "menu.not_found", "酒单不存在")
	}
	items, err := a.menus.Items(ctx, in.ID)
	if err != nil {
		return nil, menuErr(err)
	}
	ownerOut, _, err := a.menuEnrich(ctx, []uuid.UUID{m.ID})
	if err != nil {
		return nil, menuErr(err)
	}
	out := &menuDetailOutput{}
	out.Body.Menu = menuToBody(m, viewer != nil && *viewer == m.OwnerID)
	out.Body.Menu.Owner = ownerOut[m.ID]
	out.Body.Menu.CoverURLs, out.Body.Menu.CoverURLsLight = itemCovers(items)
	out.Body.Items = menuItemsOut(items)
	return out, nil
}

func (a *API) updateMenuHandler(ctx context.Context, in *menuUpdateInput) (*struct {
	Body menuBody
}, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	var vis *string
	if in.Body.Visibility != nil {
		v := string(*in.Body.Visibility)
		vis = &v
	}
	m, err := a.menus.Update(ctx, in.ID, claims.UserUUID(), menu.UpdateInput{
		Title: in.Body.Title, Description: in.Body.Description, Visibility: vis,
	})
	if err != nil {
		return nil, menuErr(err)
	}
	return &struct{ Body menuBody }{Body: menuToBody(m, true)}, nil
}

func (a *API) deleteMenuHandler(ctx context.Context, in *menuIDInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	if err := a.menus.Delete(ctx, in.ID, claims.UserUUID()); err != nil {
		return nil, menuErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) addMenuItemHandler(ctx context.Context, in *menuAddItemInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	if err := a.menus.AddItem(ctx, in.ID, claims.UserUUID(), in.Recipe, in.Body.Note); err != nil {
		return nil, menuErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) removeMenuItemHandler(ctx context.Context, in *menuItemInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	if err := a.menus.RemoveItem(ctx, in.ID, claims.UserUUID(), in.RecipeID); err != nil {
		return nil, menuErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) reorderMenuItemHandler(ctx context.Context, in *menuReorderInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	if err := a.menus.ReorderItem(ctx, in.ID, claims.UserUUID(), in.Body.RecipeID, in.Body.AfterRecipeID); err != nil {
		return nil, menuErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) myMenusHandler(ctx context.Context, in *struct {
	ContainsRecipe string `query:"containsRecipe"`
}) (*myMenusOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	var contains *uuid.UUID
	if in.ContainsRecipe != "" {
		id, err := uuid.Parse(in.ContainsRecipe)
		if err != nil {
			return nil, newErr(http.StatusBadRequest, "menu.bad_recipe_id", "containsRecipe 不是合法 UUID")
		}
		contains = &id
	}
	menus, err := a.menus.ListMine(ctx, claims.UserUUID(), contains)
	if err != nil {
		return nil, menuErr(err)
	}
	ids := make([]uuid.UUID, len(menus))
	for i := range menus {
		ids[i] = menus[i].Menu.ID
	}
	cov, err := a.menus.Covers(ctx, ids)
	if err != nil {
		return nil, menuErr(err)
	}
	out := &myMenusOutput{}
	out.Body.Items = make([]myMenuBody, 0, len(menus))
	for _, m := range menus {
		mb := myMenuBody{MenuBody: menuToBody(&m.Menu, true), ContainsRecipe: m.ContainsRecipe}
		if set := cov[m.Menu.ID]; set != nil {
			if len(set.Dark) > 0 {
				mb.CoverURLs = set.Dark
			}
			if len(set.Light) > 0 {
				mb.CoverURLsLight = set.Light
			}
		}
		out.Body.Items = append(out.Body.Items, mb)
	}
	return out, nil
}

func (a *API) userMenusHandler(ctx context.Context, in *struct {
	Handle string `path:"handle" pattern:"^[a-zA-Z0-9_]{3,24}$"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"50"`
}) (*menuListOutput, error) {
	p, err := a.users.ProfileByHandle(ctx, in.Handle)
	if err != nil {
		return nil, userErr(err)
	}
	// 本人视角返回全部酒单（含 private）；他人仅公开。
	viewer := viewerID(ctx)
	isSelf := viewer != nil && *viewer == p.ID
	res, err := a.menus.ListByUser(ctx, p.ID, in.Cursor, limitOf(in.Limit), !isSelf)
	if err != nil {
		return nil, listErr(err)
	}
	items, err := a.menusToBodies(ctx, res.Items, isSelf)
	if err != nil {
		return nil, err
	}
	out := &menuListOutput{}
	out.Body.Items = items
	if res.NextCursor != "" {
		s := res.NextCursor
		out.Body.NextCursor = &s
	}
	return out, nil
}

/* ────────────────────────── 辅助 ────────────────────────── */

func viewerID(ctx context.Context) *uuid.UUID {
	if c, ok := ctx.Value(ctxClaims).(*auth.Claims); ok && c != nil {
		id := c.UserUUID()
		return &id
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func menuErr(err error) error {
	switch {
	case errors.Is(err, menu.ErrNotFound):
		return newErr(http.StatusNotFound, "menu.not_found", "酒单不存在")
	case errors.Is(err, menu.ErrForbidden):
		return newErr(http.StatusForbidden, "menu.forbidden", "只能操作自己的酒单")
	case errors.Is(err, menu.ErrRecipeGone):
		return newErr(http.StatusNotFound, "recipe.not_found", "配方不存在")
	case errors.Is(err, menu.ErrNotInMenu):
		return newErr(http.StatusNotFound, "menu.item_not_found", "配方不在酒单里")
	case errors.Is(err, menu.ErrBadReorder):
		return newErr(http.StatusUnprocessableEntity, "menu.bad_anchor", "锚点配方不在酒单里")
	case errors.Is(err, menu.ErrBadCursor):
		return newErr(http.StatusBadRequest, "cursor.invalid", "分页游标无效")
	default:
		return internalErr(err)
	}
}
