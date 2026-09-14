package api

import (
	"encoding/base64"
	"encoding/json"
)

// cursor 编解码（API 定义 §1.3）：排序键元组 JSON → base64url。
// 元组必须带 id 作为 tiebreaker，否则同键行会重复或漏掉。

func encodeCursor(v any) string {
	b, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string, v any) error {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
