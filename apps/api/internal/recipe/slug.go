package recipe

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"
)

// slugify 标题 → URL 变体：小写、拉丁重音归一化、字母数字之外全部变连字符。
// CJK 等非 ASCII 直接丢弃（v1 不做拼音转写）——空候选由调用方回退到短 ID。
// 种子配方的 slug（daiquiri、negroni…）不走这里，直接来自 seed.json。
func slugify(title string) string {
	var b strings.Builder
	lastDash := true // 吸收前导分隔符
	for _, r := range norm.NFD.String(strings.ToLower(title)) {
		switch {
		case unicode.Is(unicode.Mn, r): // 组合附标（é 拆出的重音残留）
			continue
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	s := strings.Trim(b.String(), "-")
	if len(s) > 48 { // 字节截断安全：候选集只有 [a-z0-9-]
		s = strings.Trim(s[:48], "-")
	}
	return s
}

// draftSlug 草稿占位 slug：draft-{uuid}。发布时若仍是占位值则换成标题派生的正式 slug。
func draftSlug(id string) string { return "draft-" + id }

// allocateSlug 发布时生成去重 slug：冲突加 -2/-3… 后缀。
// 自身行排除在外（改名重发不会和自己撞）。
func allocateSlug(ctx context.Context, q querier, title string, id uuid.UUID) (string, error) {
	base := slugify(title)
	if base == "" {
		// 纯中文标题：回退到短 ID，稳定且不依赖转写
		base = "r-" + strings.ReplaceAll(id.String(), "-", "")[:12]
	}
	slug := base
	for n := 2; n < 200; n++ {
		var exists bool
		if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM recipes WHERE slug = $1 AND id <> $2)`,
			slug, id).Scan(&exists); err != nil {
			return "", fmt.Errorf("查询 slug 冲突: %w", err)
		}
		if !exists {
			return slug, nil
		}
		slug = fmt.Sprintf("%s-%d", base, n)
	}
	return "", fmt.Errorf("slug 分配失败（%s 冲突超限）", base)
}
