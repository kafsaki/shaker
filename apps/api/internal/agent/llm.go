// Package agent 酒保助手（ADR-028）：用自然语言描述一杯酒，服务端调大模型生成
// 结构化配方（Recipe IR + 元数据），irv 校验不过就把诊断喂回去让模型自己修。
//
// 模型走 OpenAI 兼容的 /chat/completions；密钥只在服务端环境变量里，永不下发前端。
package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Endpoint 一个可调用的模型服务：地址 + 模型 + 密钥。主备可以是不同服务商。
type Endpoint struct {
	BaseURL string
	Model   string
	Key     string
}

// Endpoints 同一服务商下的多把密钥展开成多个端点。
func Endpoints(baseURL, model string, keys []string) []Endpoint {
	out := make([]Endpoint, 0, len(keys))
	for _, k := range keys {
		out = append(out, Endpoint{BaseURL: baseURL, Model: model, Key: k})
	}
	return out
}

// Config 大模型连接配置。Endpoints 按顺序尝试：前一个鉴权失败、限流或服务端出错时换下一个。
type Config struct {
	Endpoints []Endpoint
	// Effort 透传 reasoning_effort（low / high / max）；空则不传，用模型默认。
	Effort  string
	Timeout time.Duration
}

// Message OpenAI 兼容的对话消息。
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ErrDisabled 未配置密钥。
var ErrDisabled = errors.New("酒保助手未启用")

// UpstreamError 模型服务返回了非 2xx。
type UpstreamError struct {
	Status int
	Body   string
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("模型服务返回 %d: %s", e.Status, e.Body)
}

// retryable 鉴权失败（这把 key 不行）、限流、服务端错误都值得换一把 key 再试。
func (e *UpstreamError) retryable() bool {
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden ||
		e.Status == http.StatusPaymentRequired || e.Status == http.StatusTooManyRequests || e.Status >= 500
}

type Client struct {
	cfg  Config
	http *http.Client
}

func NewClient(cfg Config) *Client {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 90 * time.Second
	}
	// 缺地址、模型或密钥的端点直接丢掉，全丢光即助手关闭
	eps := make([]Endpoint, 0, len(cfg.Endpoints))
	for _, ep := range cfg.Endpoints {
		ep.BaseURL = strings.TrimRight(ep.BaseURL, "/")
		if ep.BaseURL != "" && ep.Model != "" && ep.Key != "" {
			eps = append(eps, ep)
		}
	}
	cfg.Endpoints = eps
	return &Client{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}}
}

func (c *Client) Enabled() bool {
	return c != nil && len(c.cfg.Endpoints) > 0
}

type chatRequest struct {
	Model          string            `json:"model"`
	Messages       []Message         `json:"messages"`
	ResponseFormat map[string]string `json:"response_format,omitempty"`
	Effort         string            `json:"reasoning_effort,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

// ChatJSON 发一轮对话并要求模型只回 JSON 对象，返回 content 原文。
func (c *Client) ChatJSON(ctx context.Context, msgs []Message) (string, error) {
	if !c.Enabled() {
		return "", ErrDisabled
	}
	var last error
	for i, ep := range c.cfg.Endpoints {
		out, err := c.post(ctx, ep, msgs)
		if err == nil {
			return out, nil
		}
		last = err
		var ue *UpstreamError
		if ctx.Err() != nil || (errors.As(err, &ue) && !ue.retryable()) {
			return "", err
		}
		if i+1 < len(c.cfg.Endpoints) {
			slog.Warn("模型调用失败，换备用端点重试", "endpoint_index", i, "model", ep.Model, "err", err)
		}
	}
	return "", last
}

func (c *Client) post(ctx context.Context, ep Endpoint, msgs []Message) (string, error) {
	body, err := json.Marshal(chatRequest{
		Model: ep.Model, Messages: msgs,
		ResponseFormat: map[string]string{"type": "json_object"},
		Effort:         c.cfg.Effort,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+ep.Key)
	req.Header.Set("Content-Type", "application/json")
	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode/100 != 2 {
		// 上游错误体可能回显密钥尾号，只截一小段进日志/错误
		return "", &UpstreamError{Status: resp.StatusCode, Body: truncate(string(raw), 300)}
	}
	var cr chatResponse
	if err := json.Unmarshal(raw, &cr); err != nil {
		return "", fmt.Errorf("解析模型响应: %w", err)
	}
	if len(cr.Choices) == 0 || strings.TrimSpace(cr.Choices[0].Message.Content) == "" {
		return "", errors.New("模型没有返回内容")
	}
	slog.Info("llm", "model", ep.Model, "ms", time.Since(start).Milliseconds(),
		"prompt_tokens", cr.Usage.PromptTokens, "completion_tokens", cr.Usage.CompletionTokens,
		"finish", cr.Choices[0].FinishReason)
	return cr.Choices[0].Message.Content, nil
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
