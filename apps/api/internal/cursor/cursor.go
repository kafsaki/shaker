// Package cursor 分页游标（API 定义 §1.3）：base64(JSON) 的排序键元组 + id tiebreaker。
// 所有列表端点共用；Decode 校验 id 是合法 UUID，防脏游标打到 SQL 层变 500。
package cursor

import (
	"encoding/base64"
	"encoding/json"

	"github.com/google/uuid"
)

// key 约束：游标结构必须能交出 tiebreaker 的 id。
type key interface{ cursorKey() string }

// Time {unix_nano, id}：ORDER BY <time> DESC, id ASC。
// feed/点赞/评论等一切时间序列表。
type Time struct {
	T  int64 `json:"t"`
	ID string `json:"id"`
}

func (c Time) cursorKey() string { return c.ID }

// Hot {hot_score, id}：ORDER BY hot_score DESC, id ASC。
type Hot struct {
	H  float32 `json:"h"`
	ID string  `json:"id"`
}

func (c Hot) cursorKey() string { return c.ID }

// Relevance {is_canonical, similarity, id}：搜索相关度排序 —— 权威条目置顶
// （API 定义 §2.7），再按 trgm 相似度，id 收尾。ORDER BY is_canonical DESC,
// similarity DESC, id ASC。
type Relevance struct {
	C  bool    `json:"c"`
	S  float32 `json:"s"`
	ID string  `json:"id"`
}

func (c Relevance) cursorKey() string { return c.ID }

// Encode 序列化；失败返回空串（等价「无游标」）。
func Encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Decode 反序列化；空串返回 (nil, nil) 表示第一页。
func Decode[T key](s string) (*T, error) {
	if s == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	c := new(T)
	if err := json.Unmarshal(b, c); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse((*c).cursorKey()); err != nil {
		return nil, err
	}
	return c, nil
}
