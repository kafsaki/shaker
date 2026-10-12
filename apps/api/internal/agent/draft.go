package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/kafsaki/shaker/apps/api/internal/irv"
	"github.com/kafsaki/shaker/apps/api/internal/vocab"
)

// MaxAttempts 生成 + 修复的总轮数上限。每轮 5–30 秒，三轮已经是用户能等的极限。
const MaxAttempts = 3

// ErrFailed 几轮下来 IR 仍过不了结构校验。
var ErrFailed = errors.New("没能生成合法的配方")

type Taste struct {
	Sweet    int `json:"sweet"`
	Sour     int `json:"sour"`
	Bitter   int `json:"bitter"`
	Strength int `json:"strength"`
}

// Draft 一份配方草稿：与 POST /recipes 的请求体同形，前端直接填进编辑器。
type Draft struct {
	Title         string          `json:"title"`
	Subtitle      string          `json:"subtitle"`
	DescriptionMd string          `json:"descriptionMd"`
	Family        *string         `json:"family"`
	Difficulty    int             `json:"difficulty"`
	TasteProfile  Taste           `json:"tasteProfile"`
	Tags          []string        `json:"tags"`
	IR            json.RawMessage `json:"ir"`
}

type Result struct {
	Draft
	Reply string `json:"reply"`
	// Issues 修复轮数用完后仍残留的业务规则问题（结构一定是合法的），编辑器里会再标出来。
	Issues   []irv.Diagnostic `json:"issues"`
	Attempts int              `json:"attempts"`
}

// Vocab 草稿生成要用到的两份词表。
type Vocab interface {
	Full(ctx context.Context) (*vocab.Full, error)
	IrvVocab(ctx context.Context) (*irv.Vocab, error)
}

type Service struct {
	llm   *Client
	vocab Vocab
}

func NewService(llm *Client, v Vocab) *Service { return &Service{llm: llm, vocab: v} }

func (s *Service) Enabled() bool { return s != nil && s.llm.Enabled() }

// Generate 按描述生成草稿；current 非空时是在它的基础上修改。
func (s *Service) Generate(ctx context.Context, prompt string, current *Draft) (*Result, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	full, err := s.vocab.Full(ctx)
	if err != nil {
		return nil, err
	}
	iv, err := s.vocab.IrvVocab(ctx)
	if err != nil {
		return nil, err
	}
	tagIDs := map[string]bool{}
	for _, t := range full.Tags {
		tagIDs[t.ID] = true
	}

	msgs := []Message{
		{Role: "system", Content: SystemPrompt(full)},
		{Role: "user", Content: userMessage(prompt, current)},
	}
	var best *Result
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		content, err := s.llm.ChatJSON(ctx, msgs)
		if err != nil {
			if best != nil {
				return best, nil // 修复轮失败不浪费前面已经能用的结果
			}
			return nil, err
		}
		msgs = append(msgs, Message{Role: "assistant", Content: content})

		res, perr := parseReply(content, tagIDs)
		if perr != nil {
			msgs = append(msgs, Message{Role: "user", Content: "你的输出无法解析：" + perr.Error() + "。请按约定只输出一个 JSON 对象。"})
			continue
		}
		res.Attempts = attempt
		parsed, check := irv.Check(res.IR, iv)
		if parsed != nil {
			res.Issues = check.Errors
			if res.Issues == nil {
				res.Issues = []irv.Diagnostic{}
			}
			best = res
			if len(check.Errors) == 0 {
				return res, nil
			}
		}
		codes := make([]string, 0, len(check.Errors))
		for _, d := range check.Errors {
			codes = append(codes, d.Code+"@"+d.Path)
		}
		slog.Info("酒保助手需要修复", "attempt", attempt, "schema_ok", parsed != nil, "errors", codes)
		msgs = append(msgs, Message{Role: "user", Content: repairMessage(check.Errors)})
	}
	if best != nil {
		return best, nil
	}
	return nil, ErrFailed
}

func userMessage(prompt string, current *Draft) string {
	if current == nil {
		return prompt
	}
	cur, _ := json.Marshal(current)
	return "这是当前配方（JSON）：\n" + string(cur) + "\n\n请按下面的要求修改它：\n" + prompt
}

func repairMessage(errs []irv.Diagnostic) string {
	var b strings.Builder
	b.WriteString("配方没通过校验，请修正下面的问题后重新输出完整 JSON（reply 仍写给用户看，不要提校验过程）：\n")
	for i, d := range errs {
		if i == 12 {
			fmt.Fprintf(&b, "…还有 %d 条\n", len(errs)-i)
			break
		}
		fmt.Fprintf(&b, "- [%s] %s", d.Code, d.Message)
		if d.Path != "" {
			fmt.Fprintf(&b, "（位置 %s）", d.Path)
		}
		b.WriteString("\n")
	}
	return b.String()
}

// rawReply 模型的原始输出：数字可能是小数、字段可能缺失，宽进严出。
type rawReply struct {
	Reply         string          `json:"reply"`
	Title         string          `json:"title"`
	Subtitle      string          `json:"subtitle"`
	DescriptionMd string          `json:"descriptionMd"`
	Family        *string         `json:"family"`
	Difficulty    any             `json:"difficulty"`
	TasteProfile  map[string]any  `json:"tasteProfile"`
	Tags          []any           `json:"tags"`
	IR            json.RawMessage `json:"ir"`
}

func parseReply(content string, tagIDs map[string]bool) (*Result, error) {
	content = stripFence(content)
	var r rawReply
	if err := json.Unmarshal([]byte(content), &r); err != nil {
		return nil, err
	}
	ir, err := normalizeIR(r.IR)
	if err != nil {
		return nil, err
	}
	res := &Result{Reply: clip(strings.TrimSpace(r.Reply), 1000)}
	res.Title = clip(strings.TrimSpace(r.Title), 120)
	if res.Title == "" {
		res.Title = "未命名配方"
	}
	res.Subtitle = clip(strings.TrimSpace(r.Subtitle), 120)
	res.DescriptionMd = clip(strings.TrimSpace(r.DescriptionMd), 4000)
	if r.Family != nil {
		if _, ok := Families[*r.Family]; ok {
			f := *r.Family
			res.Family = &f
		}
	}
	res.Difficulty = clampInt(num(r.Difficulty), 1, 3, 2)
	res.TasteProfile = Taste{
		Sweet:    clampInt(num(r.TasteProfile["sweet"]), 0, 5, 0),
		Sour:     clampInt(num(r.TasteProfile["sour"]), 0, 5, 0),
		Bitter:   clampInt(num(r.TasteProfile["bitter"]), 0, 5, 0),
		Strength: clampInt(num(r.TasteProfile["strength"]), 0, 5, 0),
	}
	res.Tags = []string{}
	seen := map[string]bool{}
	for _, t := range r.Tags {
		id, _ := t.(string)
		if tagIDs[id] && !seen[id] && len(res.Tags) < 8 {
			seen[id] = true
			res.Tags = append(res.Tags, id)
		}
	}
	res.IR = ir
	return res, nil
}

// normalizeIR 补上模型常漏的 schemaVersion；其余一律交给 irv 判。
func normalizeIR(raw json.RawMessage) (json.RawMessage, error) {
	var m map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &m) != nil || m == nil {
		return nil, errors.New("缺少 ir 对象")
	}
	m["schemaVersion"] = 1
	return json.Marshal(m)
}

// stripFence 有的模型即使开了 JSON 模式也会包一层 ```json。
func stripFence(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = s[i+1:]
		}
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	return strings.TrimSpace(s)
}

func num(v any) float64 {
	f, ok := v.(float64)
	if !ok {
		return math.NaN()
	}
	return f
}

// clampInt 四舍五入后夹到 [lo, hi]；缺失（NaN）给 def。
func clampInt(f float64, lo, hi, def int) int {
	if math.IsNaN(f) {
		return def
	}
	n := int(math.Round(f))
	return max(lo, min(hi, n))
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
