package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/auth"
)

// bearerSecurity 标注「需要登录」的 operation（体现在 OpenAPI 文档里）。
var bearerSecurity = []map[string][]string{{"bearerAuth": {}}}

// userBody 用户资料的对外表示。
type userBody struct {
	ID             string  `json:"id" format:"uuid"`
	Handle         string  `json:"handle"`
	DisplayName    string  `json:"displayName"`
	Email          string  `json:"email"`
	EmailVerified  bool    `json:"emailVerified"`
	AvatarURL      *string `json:"avatarUrl"`
	Bio            *string `json:"bio"`
	Location       *string `json:"location"`
	Website        *string `json:"website"`
	UnitPreference string  `json:"unitPreference"`
	IsOfficial     bool    `json:"isOfficial"`
	FollowerCount  int     `json:"followerCount"`
	FollowingCount int     `json:"followingCount"`
	RecipeCount    int     `json:"recipeCount"`
	CreatedAt      string  `json:"createdAt" format:"date-time"`
}

func userToBody(u *auth.User) userBody {
	return userBody{
		ID: u.ID.String(), Handle: u.Handle, DisplayName: u.DisplayName,
		Email: u.Email, EmailVerified: u.EmailVerified,
		AvatarURL: u.AvatarURL, Bio: u.Bio, Location: u.Location, Website: u.Website,
		UnitPreference: u.UnitPreference, IsOfficial: u.IsOfficial,
		FollowerCount: u.FollowerCount, FollowingCount: u.FollowingCount, RecipeCount: u.RecipeCount,
		CreatedAt: u.CreatedAt.Format(time.RFC3339Nano),
	}
}

// tokenPairBody 注册/登录/刷新的响应体。
type tokenPairBody struct {
	User         userBody `json:"user"`
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	ExpiresIn    int      `json:"expiresIn" doc:"访问令牌寿命（秒）"`
}

func tokenPairOut(s *auth.SessionInfo) *tokenPairOutput {
	return &tokenPairOutput{Body: tokenPairBody{
		User:         userToBody(s.User),
		AccessToken:  s.AccessToken,
		RefreshToken: s.RefreshToken,
		ExpiresIn:    int(auth.AccessTokenTTL.Seconds()),
	}}
}

type tokenPairOutput struct {
	Body tokenPairBody
}

// emptyOutput 无响应体（204）。
type emptyOutput struct{}

func (a *API) registerAuth(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "auth-register",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/register",
		Summary:     "注册账号",
		Description: "创建账号并返回令牌对。刷新令牌仅此一次返回，客户端须妥善保存。",
	}, a.registerHandler)

	huma.Register(api, huma.Operation{
		OperationID: "auth-login",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/login",
		Summary:     "登录",
		Description: "identifier 接受 handle 或 email。",
	}, a.loginHandler)

	huma.Register(api, huma.Operation{
		OperationID: "auth-refresh",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/refresh",
		Summary:     "刷新令牌",
		Description: "旧刷新令牌立即失效。检测到旧令牌重放会撤销该账号全部会话。",
	}, a.refreshHandler)

	huma.Register(api, huma.Operation{
		OperationID: "auth-logout",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/logout",
		Summary:     "登出",
		Description: "撤销当前会话链（含其刷新令牌）。",
		Security:    bearerSecurity,
	}, a.logoutHandler)

	huma.Register(api, huma.Operation{
		OperationID: "auth-logout-all",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/logout-all",
		Summary:     "登出全部设备",
		Security:    bearerSecurity,
	}, a.logoutAllHandler)
}

type registerInput struct {
	Body struct {
		Handle      string `json:"handle" minLength:"3" maxLength:"24" pattern:"^[a-zA-Z0-9_]{3,24}$"`
		Email       string `json:"email" format:"email" maxLength:"255"`
		Password    string `json:"password" minLength:"8" maxLength:"128"`
		DisplayName string `json:"displayName" minLength:"1" maxLength:"48"`
	}
}

func (a *API) registerHandler(ctx context.Context, in *registerInput) (*tokenPairOutput, error) {
	s, err := a.auth.Register(ctx, in.Body.Handle, in.Body.Email, in.Body.Password,
		in.Body.DisplayName, ctxUserAgent(ctx), ctxIPAddr(ctx))
	if err != nil {
		return nil, authErr(err)
	}
	return tokenPairOut(s), nil
}

type loginInput struct {
	Body struct {
		Identifier string `json:"identifier" minLength:"3" maxLength:"255"`
		Password   string `json:"password" minLength:"1" maxLength:"128"`
	}
}

func (a *API) loginHandler(ctx context.Context, in *loginInput) (*tokenPairOutput, error) {
	s, err := a.auth.Login(ctx, in.Body.Identifier, in.Body.Password,
		ctxUserAgent(ctx), ctxIPAddr(ctx))
	if err != nil {
		return nil, authErr(err)
	}
	return tokenPairOut(s), nil
}

type refreshInput struct {
	Body struct {
		RefreshToken string `json:"refreshToken" minLength:"20" maxLength:"128"`
	}
}

func (a *API) refreshHandler(ctx context.Context, in *refreshInput) (*tokenPairOutput, error) {
	s, err := a.auth.Refresh(ctx, in.Body.RefreshToken, ctxUserAgent(ctx), ctxIPAddr(ctx))
	if err != nil {
		return nil, authErr(err)
	}
	return tokenPairOut(s), nil
}

type authInput struct{}

func (a *API) logoutHandler(ctx context.Context, _ *authInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	if err := a.auth.Logout(ctx, claims.ChainUUID()); err != nil {
		return nil, authErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) logoutAllHandler(ctx context.Context, _ *authInput) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	if err := a.auth.LogoutAll(ctx, claims.UserUUID()); err != nil {
		return nil, authErr(err)
	}
	return &emptyOutput{}, nil
}

// authErr 把 auth 包的业务错误映射为 HTTP 错误码。
func authErr(err error) error {
	switch {
	case errors.Is(err, auth.ErrHandleTaken):
		return newErr(http.StatusConflict, "auth.handle_taken", err.Error())
	case errors.Is(err, auth.ErrEmailTaken):
		return newErr(http.StatusConflict, "auth.email_taken", err.Error())
	case errors.Is(err, auth.ErrPasswordPolicy):
		return newErr(http.StatusBadRequest, "auth.password_policy", err.Error())
	case errors.Is(err, auth.ErrInvalidCreds):
		return newErr(http.StatusUnauthorized, "auth.invalid_credentials", err.Error())
	case errors.Is(err, auth.ErrAccountSuspended):
		return newErr(http.StatusForbidden, "auth.account_suspended", err.Error())
	case errors.Is(err, auth.ErrRefreshInvalid), errors.Is(err, auth.ErrRefreshExpired):
		return newErr(http.StatusUnauthorized, "auth.refresh_invalid", err.Error())
	case errors.Is(err, auth.ErrRefreshReused):
		return newErr(http.StatusUnauthorized, "auth.refresh_reused", err.Error())
	case errors.Is(err, auth.ErrWrongPassword):
		return newErr(http.StatusForbidden, "auth.wrong_password", err.Error())
	default:
		slog.Error("auth 内部错误", "err", err)
		return newErr(http.StatusInternalServerError, "internal_error", messageForStatus(http.StatusInternalServerError))
	}
}
