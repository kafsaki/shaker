package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kafsaki/shaker/apps/api/internal/agent"
)

const agentDraftPath = "/api/v1/agent/recipe-draft"

// 酒保助手（ADR-028）：自然语言 → 结构化配方草稿。只生成不落库，用户在编辑器里过目后自己保存。
func (a *API) registerAgent(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "agent-status",
		Method:      http.MethodGet,
		Path:        "/api/v1/agent/status",
		Summary:     "酒保助手是否可用",
		Description: "部署未配置模型密钥时 enabled 为 false，前端据此隐藏入口。",
	}, a.agentStatusHandler)

	huma.Register(api, huma.Operation{
		OperationID: "agent-recipe-draft",
		Method:      http.MethodPost,
		Path:        agentDraftPath,
		Summary:     "用自然语言生成配方草稿",
		Description: "需要登录，每用户 20 次/小时。带 current 时在当前配方基础上按 prompt 修改。" +
			"服务端会用 irv 校验并让模型自我修复（最多 3 轮），一次调用通常 5–40 秒。" +
			"返回的 ir 结构一定合法；残留的业务规则问题放在 issues 里。草稿不落库。",
		Security: bearerSecurity,
	}, a.agentDraftHandler)
}

type agentStatusOutput struct {
	Body struct {
		Enabled bool `json:"enabled"`
	}
}

func (a *API) agentStatusHandler(ctx context.Context, _ *struct{}) (*agentStatusOutput, error) {
	out := &agentStatusOutput{}
	out.Body.Enabled = a.agent.Enabled()
	return out, nil
}

type agentRecipeBody struct {
	Title         string            `json:"title" maxLength:"120"`
	Subtitle      string            `json:"subtitle" maxLength:"120"`
	DescriptionMd string            `json:"descriptionMd" maxLength:"20000"`
	Family        *string           `json:"family,omitempty" maxLength:"64"`
	Difficulty    int               `json:"difficulty" minimum:"1" maximum:"5"`
	TasteProfile  tasteProfileInput `json:"tasteProfile"`
	Tags          []string          `json:"tags" maxItems:"20"`
	IR            json.RawMessage   `json:"ir"`
}

type agentDraftInput struct {
	Body struct {
		Prompt  string           `json:"prompt" minLength:"1" maxLength:"2000" doc:"想要的酒，或对 current 的修改要求"`
		Current *agentRecipeBody `json:"current,omitempty" doc:"编辑器里的当前配方；带上即为修改模式"`
	}
}

type agentDraftOutput struct {
	// 字段与 agentRecipeBody 相同但不能内嵌：huma 的 $schema 链接转换不展开匿名字段
	Body struct {
		Title         string            `json:"title"`
		Subtitle      string            `json:"subtitle"`
		DescriptionMd string            `json:"descriptionMd"`
		Family        *string           `json:"family"`
		Difficulty    int               `json:"difficulty"`
		TasteProfile  tasteProfileInput `json:"tasteProfile"`
		Tags          []string          `json:"tags"`
		IR            json.RawMessage   `json:"ir"`
		Reply         string            `json:"reply" doc:"助手给用户的说明（替代原料、取舍等）"`
		Issues        []errorDetailBody `json:"issues" doc:"修复轮用完后残留的业务规则问题"`
		Attempts      int               `json:"attempts"`
	}
}

func (a *API) agentDraftHandler(ctx context.Context, in *agentDraftInput) (*agentDraftOutput, error) {
	if _, herr := requireClaims(ctx); herr != nil {
		return nil, herr
	}
	if !a.agent.Enabled() {
		return nil, newErr(http.StatusServiceUnavailable, "agent.disabled", "酒保助手暂未开放")
	}
	var current *agent.Draft
	if c := in.Body.Current; c != nil {
		current = &agent.Draft{
			Title: c.Title, Subtitle: c.Subtitle, DescriptionMd: c.DescriptionMd,
			Family: c.Family, Difficulty: c.Difficulty, Tags: c.Tags, IR: c.IR,
			TasteProfile: agent.Taste(c.TasteProfile),
		}
	}
	res, err := a.agent.Generate(ctx, in.Body.Prompt, current)
	if err != nil {
		return nil, agentErr(ctx, err)
	}
	out := &agentDraftOutput{}
	b := &out.Body
	b.Title, b.Subtitle, b.DescriptionMd = res.Title, res.Subtitle, res.DescriptionMd
	b.Family, b.Difficulty, b.Tags, b.IR = res.Family, res.Difficulty, res.Tags, res.IR
	b.TasteProfile = tasteProfileInput(res.TasteProfile)
	b.Reply, b.Attempts = res.Reply, res.Attempts
	b.Issues = diagsToDetails(res.Issues)
	return out, nil
}

func agentErr(ctx context.Context, err error) error {
	var ue *agent.UpstreamError
	switch {
	case errors.Is(err, agent.ErrDisabled):
		return newErr(http.StatusServiceUnavailable, "agent.disabled", "酒保助手暂未开放")
	case errors.Is(err, agent.ErrFailed):
		return newErr(http.StatusBadGateway, "agent.failed", "助手没能写出合法的配方，换个说法再试试")
	case ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded):
		return newErr(http.StatusGatewayTimeout, "agent.timeout", "助手想得太久了，请稍后再试")
	case errors.As(err, &ue) && ue.Status == http.StatusTooManyRequests:
		return newErr(http.StatusServiceUnavailable, "agent.busy", "助手太忙了，请稍后再试")
	default:
		slog.Error("酒保助手调用失败", "err", err)
		return newErr(http.StatusBadGateway, "agent.upstream", "助手暂时联系不上，请稍后再试")
	}
}
