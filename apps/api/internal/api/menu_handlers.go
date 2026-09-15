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
		Description: "按 visibility 鉴权：public 对所有人；private/unlisted 仅主人（分享访问走 /menus/shared/{shareToken}）。",
	}, a.getMenuHandler)

	huma.Register(api, huma.Operation{
		OperationID: "menus-get-shared",
		Method:      http.MethodGet,
		Path:        "/api/v1/menus/shared/{shareToken}",
		Summary:     "分享链接访问 unlisted 酒单",
	}, a.getSharedMenuHandler)

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
		OperationID: "menus-share",
		Method:      http.MethodPost,
		Path:        "/api/v1/menus/{id}/share",
		Summary:     "生成/轮换分享令牌",
		Security:    bearerSecurity,
	}, a.shareMenuHandler)

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
		Description: "本人（携带 Bearer）可见全部含私密；他人仅公开。unlisted 的分享链接走 /menus/shared/{shareToken}。",
	}, a.userMenusHandler)
}

/* ────────────────────────── 响应体 ────────────────────────── */

type menuVisibility string

type menuBody struct {
	ID          uuid.UUID  `json:"id"`
	Title       string     `json:"title"`
	Description *string    `json:"description"`
	CoverURL    *string    `json:"coverUrl"`
	Visibility  string     `json:"visibility"`
	ItemCount   int        `json:"itemCount"`
	ShareToken  *string    `json:"shareToken,omitempty"` // 仅主人可见
	CreatedAt   string     `json:"createdAt" format:"date-time"`
	UpdatedAt   string     `json:"updatedAt" format:"date-time"`
}

type menuRecipeCardBody struct {
	ID           uuid.UUID `json:"id"`
	Code         string    `json:"code"`
	Title        string    `json:"title"`
	ClassicKey   *string   `json:"classicKey"`
	IsCanonical  bool      `json:"isCanonical"`
	CoverURL     *string   `json:"coverUrl"`
	LikeCount    int       `json:"likeCount"`
	CommentCount int       `json:"commentCount"`
	Deleted      bool      `json:"deleted"`
}

type menuItemBody struct {
	Recipe  menuRecipeCardBody `json:"recipe"`
	Note    *string            `json:"note"`
	AddedAt string             `json:"addedAt" format:"date-time"`
}

type menuDetailOutput struct {
	Body struct {
		Menu  menuBody      `json:"menu"`
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
//（encoding/json 不区分大小写，运行时响应一直是完整的）。
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

func menuToBody(m *menu.Menu, isOwner bool) menuBody {
	b := menuBody{
		ID: m.ID, Title: m.Title, Description: m.Description, CoverURL: m.CoverURL,
		Visibility: m.Visibility, ItemCount: m.ItemCount,
		CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: m.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if isOwner {
		b.ShareToken = m.ShareToken
	}
	return b
}

func menuItemsOut(items []menu.Item) []menuItemBody {
	out := make([]menuItemBody, 0, len(items))
	for _, it := range items {
		out = append(out, menuItemBody{
			Recipe: menuRecipeCardBody{
				ID: it.Recipe.ID, Code: it.Recipe.Code(), Title: it.Recipe.Title,
				ClassicKey: it.Recipe.ClassicKey, IsCanonical: it.Recipe.IsCanonical,
				CoverURL: it.Recipe.CoverURL, LikeCount: it.Recipe.LikeCount, CommentCount: it.Recipe.CommentCount,
				Deleted: it.Recipe.Deleted,
			},
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
	ID     uuid.UUID `path:"id" format:"uuid"`
	Body   struct {
		Title       *string         `json:"title" minLength:"1" maxLength:"120" required:"false"`
		Description *string         `json:"description" maxLength:"2000" required:"false"`
		Visibility  *menuVisibility `json:"visibility" enum:"private,unlisted,public" required:"false"`
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
		Title       string          `json:"title" minLength:"1" maxLength:"120"`
		Description *string         `json:"description" maxLength:"2000" required:"false"`
		Visibility  menuVisibility  `json:"visibility" enum:"private,unlisted,public" default:"private" required:"false"`
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

// canViewMenu 可见性规则：public → 所有人；其余 → 主人（unlisted 分享另走 token）。
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
	out := &menuDetailOutput{}
	out.Body.Menu = menuToBody(m, viewer != nil && *viewer == m.OwnerID)
	out.Body.Items = menuItemsOut(items)
	return out, nil
}

type shareTokenInput struct {
	ShareToken string `path:"shareToken" minLength:"16" maxLength:"64"`
}

func (a *API) getSharedMenuHandler(ctx context.Context, in *shareTokenInput) (*menuDetailOutput, error) {
	m, err := a.menus.GetByShareToken(ctx, in.ShareToken)
	if err != nil {
		return nil, menuErr(err)
	}
	items, err := a.menus.Items(ctx, m.ID)
	if err != nil {
		return nil, menuErr(err)
	}
	out := &menuDetailOutput{}
	out.Body.Menu = menuToBody(m, false)
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

func (a *API) shareMenuHandler(ctx context.Context, in *menuIDInput) (*struct {
	Body struct {
		ShareToken string `json:"shareToken"`
	}
}, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	m, err := a.menus.RotateShareToken(ctx, in.ID, claims.UserUUID())
	if err != nil {
		return nil, menuErr(err)
	}
	return &struct {
		Body struct {
			ShareToken string `json:"shareToken"`
		}
	}{Body: struct {
		ShareToken string `json:"shareToken"`
	}{ShareToken: deref(m.ShareToken)}}, nil
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
	out := &myMenusOutput{}
	out.Body.Items = make([]myMenuBody, 0, len(menus))
	for _, m := range menus {
		out.Body.Items = append(out.Body.Items, myMenuBody{MenuBody: menuToBody(&m.Menu, true), ContainsRecipe: m.ContainsRecipe})
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
	// 本人视角返回全部酒单（含 private/unlisted）并附 shareToken；他人仅公开。
	viewer := viewerID(ctx)
	isSelf := viewer != nil && *viewer == p.ID
	res, err := a.menus.ListByUser(ctx, p.ID, in.Cursor, limitOf(in.Limit), !isSelf)
	if err != nil {
		return nil, listErr(err)
	}
	out := &menuListOutput{}
	out.Body.Items = make([]menuBody, 0, len(res.Items))
	for i := range res.Items {
		out.Body.Items = append(out.Body.Items, menuToBody(&res.Items[i], isSelf))
	}
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
