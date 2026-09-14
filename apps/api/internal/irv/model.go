// Package irv 在 Go 侧把关配方 IR。
//
// 后端不建模 IR（ADR-003）：ir 全程当不透明 JSONB 传递。这个包只做三件事——
// 结构校验（内嵌 JSON Schema，真相源在 packages/recipe-ir 的 zod）、
// 业务规则校验（validate.ts 的移植）、派生值计算（ABV/总量，必须与 TS 逐位一致，
// 有黄金测试兜底）。
package irv

import "encoding/json"

// Diagnostic 与 packages/recipe-ir 的 validate.ts §10 结构一致，
// API 错误响应的 details 数组直接复用它（编辑器据此高亮）。
type Diagnostic struct {
	Severity string `json:"severity"` // "error" | "warn"
	Code     string `json:"code"`
	Message  string `json:"message"`
	Path     string `json:"path,omitempty"`
}

type Result struct {
	OK       bool         `json:"ok"`
	Errors   []Diagnostic `json:"errors"`
	Warnings []Diagnostic `json:"warnings"`
}

func errDiag(code, message, path string) Diagnostic {
	return Diagnostic{Severity: "error", Code: code, Message: message, Path: path}
}

func warnDiag(code, message, path string) Diagnostic {
	return Diagnostic{Severity: "warn", Code: code, Message: message, Path: path}
}

func (r *Result) add(d Diagnostic) {
	if d.Severity == "error" {
		r.Errors = append(r.Errors, d)
	} else {
		r.Warnings = append(r.Warnings, d)
	}
}

/* ────────────────────────── 松散 IR 模型 ────────────────────────── */

// IR 只声明校验与派生计算用到的字段。结构合法性已由 JSON Schema 保证，
// 这里不做防御性判空——schema 拒收过的形状到不了这一层。
type IR struct {
	SchemaVersion int             `json:"schemaVersion"`
	Glass         string          `json:"glass"`
	Method        string          `json:"method"`
	Servings      *int            `json:"servings,omitempty"`
	Ingredients   []IngredientRef `json:"ingredients"`
	Steps         []Step          `json:"steps"`
}

type IngredientRef struct {
	Slot         string   `json:"slot"`
	IngredientID string   `json:"ingredientId"`
	Role         string   `json:"role"`
	Unit         string   `json:"unit"`
	Amount       *float64 `json:"amount,omitempty"`
	Note         string   `json:"note,omitempty"`
	Optional     *bool    `json:"optional,omitempty"`
}

// Step 把 21 种动作的并集拍平。哪些字段对哪些动作合法由 JSON Schema 的
// discriminated union 把关；这里只读关心的字段。
type Step struct {
	ID          string   `json:"id"`
	Action      string   `json:"action"`
	Target      string   `json:"target,omitempty"`
	From        string   `json:"from,omitempty"`
	To          string   `json:"to,omitempty"`
	Items       []string `json:"items,omitempty"`
	Material    string   `json:"material,omitempty"`
	GarnishID   string   `json:"garnishId,omitempty"`
	IceType     string   `json:"iceType,omitempty"`
	Fill        *float64 `json:"fill,omitempty"`
	DurationSec *float64 `json:"durationSec,omitempty"`
	Intensity   string   `json:"intensity,omitempty"`
	DryShake    *bool    `json:"dryShake,omitempty"`
	Discard     *bool    `json:"discard,omitempty"`
}

// ParseIR 解析已通过 JSON Schema 校验的 IR 文本。
func ParseIR(raw []byte) (*IR, error) {
	var ir IR
	if err := json.Unmarshal(raw, &ir); err != nil {
		return nil, err
	}
	return &ir, nil
}

// SlotsReferenced 是 ir-utils.ts slotsReferenced 的移植（items + material）。
func SlotsReferenced(s *Step) []string {
	out := make([]string, 0, len(s.Items)+1)
	out = append(out, s.Items...)
	if s.Material != "" {
		out = append(out, s.Material)
	}
	return out
}
