package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
)

func (a *API) registerMe(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "me-get",
		Method:      http.MethodGet,
		Path:        "/api/v1/me",
		Summary:     "当前用户资料",
		Security:    bearerSecurity,
	}, a.getMeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "me-update",
		Method:      http.MethodPatch,
		Path:        "/api/v1/me",
		Summary:     "修改资料与偏好",
		Description: "只传要改的字段；单位偏好影响前端展示，换算纯前端完成（ADR-014）。",
		Security:    bearerSecurity,
	}, a.updateMeHandler)

	huma.Register(api, huma.Operation{
		OperationID: "me-change-password",
		Method:      http.MethodPost,
		Path:        "/api/v1/me/password",
		Summary:     "修改密码",
		Description: "成功后撤销除当前会话以外的全部会话。",
		Security:    bearerSecurity,
	}, a.changePasswordHandler)
}

type meOutput struct {
	Body userBody
}

func (a *API) getMeHandler(ctx context.Context, _ *struct{}) (*meOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	u, err := a.auth.GetMe(ctx, claims.UserUUID())
	if err != nil {
		return nil, authErr(err)
	}
	return &meOutput{Body: userToBody(u)}, nil
}

type updateMeInput struct {
	Body struct {
		DisplayName    *string `json:"displayName,omitempty" minLength:"1" maxLength:"48"`
		Bio            *string `json:"bio,omitempty" maxLength:"500"`
		Location       *string `json:"location,omitempty" maxLength:"60"`
		Website        *string `json:"website,omitempty" maxLength:"200"`
		AvatarURL      *string `json:"avatarUrl,omitempty" maxLength:"500"`
		UnitPreference *string `json:"unitPreference,omitempty" enum:"ml,oz"`
	}
}

func (a *API) updateMeHandler(ctx context.Context, in *updateMeInput) (*meOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	u, err := a.auth.UpdateMe(ctx, claims.UserUUID(), auth.UpdateProfile{
		DisplayName:    in.Body.DisplayName,
		Bio:            in.Body.Bio,
		Location:       in.Body.Location,
		Website:        in.Body.Website,
		AvatarURL:      in.Body.AvatarURL,
		UnitPreference: in.Body.UnitPreference,
	})
	if err != nil {
		return nil, authErr(err)
	}
	return &meOutput{Body: userToBody(u)}, nil
}

type changePasswordInput struct {
	Body struct {
		CurrentPassword string `json:"currentPassword" minLength:"1" maxLength:"128"`
		NewPassword     string `json:"newPassword" minLength:"8" maxLength:"128"`
	}
}

func (a *API) changePasswordHandler(ctx context.Context, in *changePasswordInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	if err := a.auth.ChangePassword(ctx, claims.UserUUID(), claims.ChainUUID(),
		in.Body.CurrentPassword, in.Body.NewPassword); err != nil {
		return nil, authErr(err)
	}
	return &emptyOutput{}, nil
}
