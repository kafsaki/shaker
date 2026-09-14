package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/media"
)

func (a *API) registerMedia(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "media-upload-url",
		Method:      http.MethodPost,
		Path:        "/api/v1/media/upload-url",
		Summary:     "签发预签名直传 URL",
		Description: "三步直传的第一步（§2.10）：签发 → 客户端 PUT 直传 MinIO → /media/{assetId}/commit 确认。key 服务端生成，客户端不能自选路径。",
		Security:    bearerSecurity,
	}, a.uploadURLHandler)

	huma.Register(api, huma.Operation{
		OperationID: "media-commit",
		Method:      http.MethodPost,
		Path:        "/api/v1/media/{assetId}/commit",
		Summary:     "确认直传完成",
		Description: "HEAD 校验对象已存在后置 committed_at，返回公网 URL。幂等：已确认的直接返回。",
		Security:    bearerSecurity,
	}, a.commitMediaHandler)
}

func (a *API) uploadURLHandler(ctx context.Context, in *struct {
	Body struct {
		Purpose  string `json:"purpose" enum:"recipe_cover,user_avatar,menu_cover"`
		EntityID string `json:"entityId" format:"uuid"`
		MimeType string `json:"mimeType" enum:"image/png,image/jpeg,image/webp"`
		ByteSize int64  `json:"byteSize" minimum:"1" maximum:"10485760"`
	}
}) (*struct {
	Status int
	Body   struct {
		AssetID    string `json:"assetId" format:"uuid"`
		UploadURL  string `json:"uploadUrl"`
		StorageKey string `json:"storageKey"`
		ExpiresIn  int    `json:"expiresIn"`
	}
}, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	entityID, err := uuid.Parse(in.Body.EntityID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "media.entity_id_invalid", "entityId 不是合法的 UUID")
	}
	asset, err := a.media.Presign(ctx, claims.UserUUID(), in.Body.Purpose, entityID, in.Body.MimeType, in.Body.ByteSize)
	if err != nil {
		return nil, mediaErr(err)
	}
	out := &struct {
		Status int
		Body   struct {
			AssetID    string `json:"assetId" format:"uuid"`
			UploadURL  string `json:"uploadUrl"`
			StorageKey string `json:"storageKey"`
			ExpiresIn  int    `json:"expiresIn"`
		}
	}{Status: http.StatusCreated}
	out.Body.AssetID = asset.ID.String()
	out.Body.UploadURL = asset.UploadURL
	out.Body.StorageKey = asset.StorageKey
	out.Body.ExpiresIn = asset.ExpiresIn
	return out, nil
}

func (a *API) commitMediaHandler(ctx context.Context, in *struct {
	AssetID string `path:"assetId" format:"uuid"`
}) (*struct {
	Body struct {
		URL string `json:"url"`
	}
}, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	assetID, err := uuid.Parse(in.AssetID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "media.asset_id_invalid", "assetId 不是合法的 UUID")
	}
	url, err := a.media.Commit(ctx, claims.UserUUID(), assetID)
	if err != nil {
		return nil, mediaErr(err)
	}
	out := &struct {
		Body struct {
			URL string `json:"url"`
		}
	}{}
	out.Body.URL = url
	return out, nil
}

func mediaErr(err error) error {
	switch {
	case errors.Is(err, media.ErrBadPurpose):
		return newErr(http.StatusUnprocessableEntity, "media.bad_purpose", "未知媒体用途")
	case errors.Is(err, media.ErrBadMime):
		return newErr(http.StatusUnprocessableEntity, "media.bad_mime", "不支持的媒体类型")
	case errors.Is(err, media.ErrTooLarge):
		return newErr(http.StatusUnprocessableEntity, "media.too_large", "文件超过 10MB 上限")
	case errors.Is(err, media.ErrNotFound):
		return newErr(http.StatusNotFound, "media.not_found", "对象不存在")
	case errors.Is(err, media.ErrForbidden):
		return newErr(http.StatusForbidden, "media.forbidden", "只能给自己的对象上传媒体")
	case errors.Is(err, media.ErrNotUploaded):
		return newErr(http.StatusConflict, "media.not_uploaded", "对象尚未上传，请先完成直传")
	default:
		return internalErr(err)
	}
}
