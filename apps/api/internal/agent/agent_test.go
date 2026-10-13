package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/kafsaki/shaker/apps/api/internal/irv"
	"github.com/kafsaki/shaker/apps/api/internal/vocab"
)

type fakeVocab struct{}

var testIngredients = []vocab.Ingredient{
	{ID: "rum-white", NameZh: "白朗姆", NameEn: "White Rum", Category: "spirit"},
	{ID: "lime-juice", NameZh: "青柠汁", NameEn: "Lime Juice", Category: "juice"},
	{ID: "simple-syrup", NameZh: "糖浆", NameEn: "Simple Syrup", Category: "syrup"},
	{ID: "soda-water", NameZh: "苏打水", NameEn: "Soda Water", Category: "mixer"},
	{ID: "lime-wheel", NameZh: "青柠轮", NameEn: "Lime Wheel", Category: "garnish"},
	{ID: "mint-leaf", NameZh: "薄荷叶", NameEn: "Mint Leaf", Category: "garnish"},
	{ID: "mint-sprig", NameZh: "薄荷枝", NameEn: "Mint Sprig", Category: "garnish"},
}

func (fakeVocab) Full(context.Context) (*vocab.Full, error) {
	return &vocab.Full{
		Ingredients: testIngredients,
		Glassware:   []vocab.Glass{{ID: "coupe", NameZh: "碟型杯", CapacityMl: 180}, {ID: "collins", NameZh: "柯林斯杯", CapacityMl: 350}},
		Tags:        []vocab.Tag{{ID: "refreshing", NameZh: "清爽"}, {ID: "sour", NameZh: "酸"}},
	}, nil
}

func (fakeVocab) IrvVocab(context.Context) (*irv.Vocab, error) {
	v := &irv.Vocab{Ingredients: map[string]irv.IngredientMeta{}, GlassCapacity: map[string]float64{"coupe": 180, "collins": 350}}
	for _, ing := range testIngredients {
		v.Ingredients[ing.ID] = irv.IngredientMeta{ID: ing.ID}
	}
	return v, nil
}

func TestExamplesAreValid(t *testing.T) {
	iv, _ := fakeVocab{}.IrvVocab(context.Background())
	for name, ex := range map[string]string{"sour": exampleSour, "built": exampleBuilt} {
		ir, res := irv.Check([]byte(ex), iv)
		if ir == nil || !res.OK {
			t.Errorf("示例 %s 不合法：%+v", name, res.Errors)
		}
	}
}

func TestSystemPromptHasCatalog(t *testing.T) {
	full, _ := fakeVocab{}.Full(context.Background())
	p := SystemPrompt(full)
	for _, want := range []string{"rum-white 白朗姆/White Rum", "[garnish]", "collins 柯林斯杯 350", "refreshing 清爽", "sour 酸酒"} {
		if !strings.Contains(p, want) {
			t.Errorf("系统提示缺少 %q", want)
		}
	}
}

func TestParseReplySanitizes(t *testing.T) {
	content := "```json\n" + `{"reply":"好的","title":"  ","subtitle":"x","family":"made_up",
		"difficulty":4.6,"tasteProfile":{"sweet":2.4,"sour":9,"bitter":-1},
		"tags":["refreshing","nope","refreshing",3],
		"ir":{"glass":"coupe","method":"shaken","ingredients":[],"steps":[]}}` + "\n```"
	res, err := parseReply(content, map[string]bool{"refreshing": true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Title != "未命名配方" || res.Family != nil || res.Difficulty != 3 {
		t.Errorf("元数据没清洗干净：%+v", res.Draft)
	}
	if res.TasteProfile != (Taste{Sweet: 2, Sour: 5, Bitter: 0, Strength: 0}) {
		t.Errorf("口味没夹住：%+v", res.TasteProfile)
	}
	if len(res.Tags) != 1 || res.Tags[0] != "refreshing" {
		t.Errorf("标签没过滤：%v", res.Tags)
	}
	if !strings.Contains(string(res.IR), `"schemaVersion":1`) {
		t.Errorf("没补 schemaVersion：%s", res.IR)
	}

	if _, err := parseReply(`{"title":"x"}`, nil); err == nil {
		t.Error("缺 ir 应当报错")
	}
	if res, _ := parseReply(`{"ir":{}}`, nil); res.Difficulty != 2 {
		t.Errorf("缺省难度应为 2，得到 %d", res.Difficulty)
	}
}

// fakeLLM 依次返回预设的 content；记下收到的请求以便断言。
type fakeLLM struct {
	mu        sync.Mutex
	replies   []string
	requests  []chatRequest
	keys      []string
	rejectKey string
}

func (f *fakeLLM) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	f.keys = append(f.keys, key)
	if key == f.rejectKey {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid key"}}`))
		return
	}
	var req chatRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	f.requests = append(f.requests, req)
	content := f.replies[min(len(f.requests), len(f.replies))-1]
	_ = json.NewEncoder(w).Encode(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": content}, "finish_reason": "stop"}},
	})
}

func reply(ir string) string {
	return `{"reply":"来一杯","title":"Daiquiri","subtitle":"白朗姆 · 青柠","descriptionMd":"经典。","family":"sour",
		"difficulty":2,"tasteProfile":{"sweet":2,"sour":4,"bitter":0,"strength":3},"tags":["sour"],"ir":` + ir + `}`
}

// 少一个被使用的原料：i4 没出现在任何步骤里 → ref.orphan_ingredient
var orphanIR = strings.Replace(exampleSour, `{"action":"GARNISH","id":"s6","target":"glass","items":["i4"],"position":"rim","prep":"wheel"}`,
	`{"action":"WAIT","id":"s6","target":"glass","durationSec":5}`, 1)

func newTestService(t *testing.T, f *fakeLLM, keys ...string) *Service {
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return NewService(NewClient(Config{Endpoints: Endpoints(srv.URL+"/", "m", keys), Effort: "low"}), fakeVocab{})
}

func TestGenerateRepairsRuleErrors(t *testing.T) {
	f := &fakeLLM{replies: []string{reply(orphanIR), reply(exampleSour)}}
	res, err := newTestService(t, f, "k1").Generate(context.Background(), "一杯大吉利", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Attempts != 2 || len(res.Issues) != 0 || res.Title != "Daiquiri" || *res.Family != "sour" {
		t.Errorf("结果不对：attempts=%d issues=%v", res.Attempts, res.Issues)
	}
	second := f.requests[1].Messages
	if last := second[len(second)-1].Content; !strings.Contains(last, "ref.orphan_ingredient") {
		t.Errorf("修复消息应带上诊断码：%s", last)
	}
	if second[len(second)-2].Role != "assistant" || f.requests[0].Effort != "low" || f.requests[0].ResponseFormat["type"] != "json_object" {
		t.Error("请求体不对")
	}
}

func TestGenerateReturnsBestWhenRulesStillFail(t *testing.T) {
	f := &fakeLLM{replies: []string{reply(orphanIR)}}
	res, err := newTestService(t, f, "k1").Generate(context.Background(), "x", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Attempts != MaxAttempts || len(res.Issues) == 0 || res.Issues[0].Code != "ref.orphan_ingredient" {
		t.Errorf("应返回结构合法、带 issues 的最后一版：%+v", res.Issues)
	}
}

func TestGenerateFailsWhenSchemaNeverPasses(t *testing.T) {
	f := &fakeLLM{replies: []string{reply(`{"glass":"coupe","method":"teleported","ingredients":[],"steps":[]}`), "不是 JSON"}}
	_, err := newTestService(t, f, "k1").Generate(context.Background(), "x", nil)
	if !errors.Is(err, ErrFailed) {
		t.Fatalf("应为 ErrFailed，得到 %v", err)
	}
	if len(f.requests) != MaxAttempts {
		t.Errorf("应尝试 %d 轮，实际 %d", MaxAttempts, len(f.requests))
	}
}

func TestKeyFallback(t *testing.T) {
	f := &fakeLLM{replies: []string{reply(exampleSour)}, rejectKey: "bad"}
	res, err := newTestService(t, f, "bad", "good").Generate(context.Background(), "x", nil)
	if err != nil || res.Attempts != 1 {
		t.Fatalf("备用密钥应接手：%v", err)
	}
	if strings.Join(f.keys, ",") != "bad,good" {
		t.Errorf("密钥尝试顺序不对：%v", f.keys)
	}
}

// 主备是两家服务商：主端点 401 后，请求应发到备用端点的地址、带备用的模型 id。
func TestEndpointFallbackSwitchesProvider(t *testing.T) {
	primary := &fakeLLM{replies: []string{reply(exampleSour)}, rejectKey: "pk"}
	backup := &fakeLLM{replies: []string{reply(exampleSour)}}
	ps, bs := httptest.NewServer(primary), httptest.NewServer(backup)
	t.Cleanup(ps.Close)
	t.Cleanup(bs.Close)
	s := NewService(NewClient(Config{Endpoints: []Endpoint{
		{BaseURL: ps.URL, Model: "primary-model", Key: "pk"},
		{BaseURL: bs.URL, Model: "", Key: "dropped"}, // 缺模型的端点被丢弃
		{BaseURL: bs.URL + "/", Model: "backup-model", Key: "bk"},
	}}), fakeVocab{})
	if _, err := s.Generate(context.Background(), "x", nil); err != nil {
		t.Fatalf("备用端点应接手：%v", err)
	}
	if strings.Join(primary.keys, ",") != "pk" || strings.Join(backup.keys, ",") != "bk" {
		t.Errorf("端点尝试不对：主 %v 备 %v", primary.keys, backup.keys)
	}
	if backup.requests[0].Model != "backup-model" {
		t.Errorf("备用端点应使用自己的模型 id，得到 %q", backup.requests[0].Model)
	}
}

func TestModifyModeSendsCurrent(t *testing.T) {
	f := &fakeLLM{replies: []string{reply(exampleSour)}}
	cur := &Draft{Title: "我的大吉利", IR: json.RawMessage(exampleSour)}
	if _, err := newTestService(t, f, "k").Generate(context.Background(), "少放点糖", cur); err != nil {
		t.Fatal(err)
	}
	u := f.requests[0].Messages[1].Content
	if !strings.Contains(u, "我的大吉利") || !strings.Contains(u, "少放点糖") {
		t.Errorf("修改模式应带上当前配方：%s", u)
	}
}

func TestDisabled(t *testing.T) {
	s := NewService(NewClient(Config{Endpoints: Endpoints("http://x", "m", nil)}), fakeVocab{})
	if s.Enabled() {
		t.Fatal("没有密钥不应启用")
	}
	if _, err := s.Generate(context.Background(), "x", nil); !errors.Is(err, ErrDisabled) {
		t.Fatalf("应为 ErrDisabled，得到 %v", err)
	}
}
