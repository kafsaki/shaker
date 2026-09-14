package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/kafsaki/shaker/apps/api/internal/notify"
	"github.com/kafsaki/shaker/apps/api/internal/report"
)

func (a *API) registerNotifications(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "notifications-list",
		Method:      http.MethodGet,
		Path:        "/api/v1/notifications",
		Summary:     "通知收件箱",
		Description: "created_at 倒序。unreadOnly=true 只取未读。",
		Security:    bearerSecurity,
	}, a.listNotificationsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "notifications-unread-count",
		Method:      http.MethodGet,
		Path:        "/api/v1/notifications/unread-count",
		Summary:     "未读数（小红点）",
		Security:    bearerSecurity,
	}, a.unreadCountHandler)

	huma.Register(api, huma.Operation{
		OperationID: "notifications-read",
		Method:      http.MethodPost,
		Path:        "/api/v1/notifications/read",
		Summary:     "标读",
		Description: "{ids} 省略则全部标读。",
		Security:    bearerSecurity,
	}, a.markReadHandler)
}

func (a *API) registerReports(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "reports-create",
		Method:      http.MethodPost,
		Path:        "/api/v1/reports",
		Summary:     "举报",
		Description: "v1 只收单留档，不接审核流（ADR-007）。",
		Security:    bearerSecurity,
	}, a.createReportHandler)
}

/* ────────────────────────── 通知响应体 ────────────────────────── */

type notificationActorBody struct {
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
}

type notificationBody struct {
	ID         string                `json:"id" format:"uuid"`
	Type       string                `json:"type" enum:"like,comment,reply,follow,mention,system"`
	Actor      *notificationActorBody `json:"actor"` // 删号作者为 null
	EntityType *string               `json:"entityType"`
	EntityID   *string               `json:"entityId" format:"uuid"`
	Payload    json.RawMessage       `json:"payload"`
	ReadAt     *string               `json:"readAt" format:"date-time"`
	CreatedAt  string                `json:"createdAt" format:"date-time"`
}

type notificationListOutput struct {
	Body struct {
		Items      []notificationBody `json:"items"`
		NextCursor *string            `json:"nextCursor"`
	}
}

func notificationOut(items []notify.Item) *notificationListOutput {
	out := &notificationListOutput{}
	out.Body.Items = make([]notificationBody, 0, len(items))
	for _, it := range items {
		b := notificationBody{
			ID: it.ID.String(), Type: it.Type,
			EntityType: it.EntityType,
			Payload:    json.RawMessage(it.Payload),
			CreatedAt:  it.CreatedAt.UTC().Format(time.RFC3339Nano),
		}
		if it.EntityID != nil {
			s := it.EntityID.String()
			b.EntityID = &s
		}
		if it.ReadAt != nil {
			s := it.ReadAt.UTC().Format(time.RFC3339Nano)
			b.ReadAt = &s
		}
		if it.ActorHandle != nil { // actor 删号 → null
			b.Actor = &notificationActorBody{Handle: *it.ActorHandle, DisplayName: deref(it.ActorName)}
		}
		if b.Payload == nil {
			b.Payload = json.RawMessage("null")
		}
		out.Body.Items = append(out.Body.Items, b)
	}
	return out
}

/* ────────────────────────── handler ────────────────────────── */

func (a *API) listNotificationsHandler(ctx context.Context, in *struct {
	UnreadOnly bool   `query:"unreadOnly"`
	Cursor     string `query:"cursor"`
	Limit      int    `query:"limit" minimum:"1" maximum:"50"`
}) (*notificationListOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	res, err := a.notifies.List(ctx, claims.UserUUID(), in.UnreadOnly, in.Cursor, limitOf(in.Limit))
	if err != nil {
		return nil, notifyErr(err)
	}
	out := notificationOut(res.Items)
	if res.NextCursor != "" {
		s := res.NextCursor
		out.Body.NextCursor = &s
	}
	return out, nil
}

func (a *API) unreadCountHandler(ctx context.Context, _ *struct{}) (*struct {
	Body struct {
		Count int `json:"count"`
	}
}, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	n, err := a.notifies.UnreadCount(ctx, claims.UserUUID())
	if err != nil {
		return nil, notifyErr(err)
	}
	return &struct {
		Body struct {
			Count int `json:"count"`
		}
	}{Body: struct {
		Count int `json:"count"`
	}{Count: n}}, nil
}

func (a *API) markReadHandler(ctx context.Context, in *struct {
	Body struct {
		IDs *[]uuid.UUID `json:"ids" required:"false"`
	}
}) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	var ids []uuid.UUID
	if in.Body.IDs != nil {
		ids = *in.Body.IDs
	}
	if _, err := a.notifies.MarkRead(ctx, claims.UserUUID(), ids); err != nil {
		return nil, notifyErr(err)
	}
	return &emptyOutput{}, nil
}

func (a *API) createReportHandler(ctx context.Context, in *struct {
	Body struct {
		EntityType string  `json:"entityType" enum:"recipe,comment,user,menu"`
		EntityID   string  `json:"entityId" format:"uuid"`
		Reason     string  `json:"reason" minLength:"1" maxLength:"64"`
		Detail     *string `json:"detail" maxLength:"2000" required:"false"`
	}
}) (*emptyOutput, error) {
	claims, herr := requireClaims(ctx)
	if herr != nil {
		return nil, herr
	}
	entityID, err := uuid.Parse(in.Body.EntityID)
	if err != nil {
		return nil, newErr(http.StatusBadRequest, "report.entity_id_invalid", "entityId 不是合法的 UUID")
	}
	if err := a.reports.Create(ctx, claims.UserUUID(), in.Body.EntityType, entityID, in.Body.Reason, in.Body.Detail); err != nil {
		switch {
		case errors.Is(err, report.ErrBadEntity):
			return nil, newErr(http.StatusUnprocessableEntity, "report.bad_entity", "举报对象类型不合法")
		case errors.Is(err, report.ErrNotFound):
			return nil, newErr(http.StatusNotFound, "report.entity_not_found", "举报对象不存在")
		default:
			return nil, internalErr(err)
		}
	}
	return &emptyOutput{}, nil
}

func notifyErr(err error) error {
	if errors.Is(err, notify.ErrBadCursor) {
		return newErr(http.StatusBadRequest, "cursor.invalid", "分页游标无效")
	}
	return internalErr(err)
}
