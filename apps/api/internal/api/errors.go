package api

import (
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// 错误信封（API 定义 §1.4）。huma 默认输出 RFC 9457 problem+json，
// 这里整体替换成项目格式 —— 包括 huma 自己的请求体校验错误，
// 所以所有 4xx/5xx 都长一个样。
type errorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Details []errorDetailBody `json:"details,omitempty"`
}

// errorDetailBody 对齐 packages/recipe-ir 的 Diagnostic：编辑器能把
// 错误定位到具体字段（path 相对请求体根）。
type errorDetailBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

type apiError struct {
	status int
	Err    errorBody `json:"error"`
}

func (e *apiError) Error() string  { return e.Err.Message }
func (e *apiError) GetStatus() int { return e.status }

func codeForStatus(s int) string {
	switch s {
	case http.StatusBadRequest:
		return "bad_request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusMethodNotAllowed:
		return "method_not_allowed"
	case http.StatusConflict:
		return "conflict"
	case http.StatusUnprocessableEntity:
		return "validation_failed"
	case http.StatusTooManyRequests:
		return "rate_limited"
	default:
		return "internal_error"
	}
}

func messageForStatus(s int) string {
	switch s {
	case http.StatusBadRequest:
		return "请求格式错误"
	case http.StatusUnauthorized:
		return "未认证"
	case http.StatusForbidden:
		return "无权限"
	case http.StatusNotFound:
		return "资源不存在"
	case http.StatusConflict:
		return "请求冲突"
	case http.StatusUnprocessableEntity:
		return "校验未通过"
	case http.StatusTooManyRequests:
		return "请求过于频繁，请稍后再试"
	default:
		return "服务器内部错误"
	}
}

// newErr 构造带业务错误码的错误。details 可选。
func newErr(status int, code, message string, details ...errorDetailBody) huma.StatusError {
	return &apiError{status: status, Err: errorBody{Code: code, Message: message, Details: details}}
}

// installErrorFormat 覆写 huma.NewError：统一错误信封。
func installErrorFormat() {
	huma.NewError = func(status int, msg string, errs ...error) huma.StatusError {
		message := msg
		if message == "" {
			message = messageForStatus(status)
		}
		var details []errorDetailBody
		for _, e := range errs {
			if e == nil {
				continue
			}
			if d, ok := e.(huma.ErrorDetailer); ok {
				ed := d.ErrorDetail()
				path := strings.TrimPrefix(ed.Location, "body.") // body.foo → foo
				details = append(details, errorDetailBody{
					Code:    "validation",
					Message: ed.Message,
					Path:    path,
				})
			} else {
				details = append(details, errorDetailBody{Code: "validation", Message: e.Error()})
			}
		}
		return &apiError{status: status, Err: errorBody{
			Code:    codeForStatus(status),
			Message: message,
			Details: details,
		}}
	}
}
