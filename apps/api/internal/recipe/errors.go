package recipe

import (
	"errors"
	"fmt"

	"github.com/kafsaki/shaker/apps/api/internal/irv"
)

var (
	// ErrNotFound 配方不存在（或已删除）。
	ErrNotFound = errors.New("配方不存在")
	// ErrForbidden 不是作者本人。
	ErrForbidden = errors.New("只能操作自己的配方")
	// ErrUnknownGlass ir.glass 不在词表（glass_id 有外键，保存前必须拦下）。
	ErrUnknownGlass = errors.New("杯型不在词表中")
	// ErrUnknownTag 引用了不存在的标签。
	ErrUnknownTag = errors.New("标签不存在")
	// ErrUnknownDerived derivedFrom 指向的配方不存在。
	ErrUnknownDerived = errors.New("血缘配方不存在")
	// ErrUnknownClassicKey classicKey 没有对应的权威条目。
	ErrUnknownClassicKey = errors.New("经典锚点不存在")
	// ErrNotPublishable hidden/removed 状态不能发布。
	ErrNotPublishable = errors.New("当前状态不能发布")
	// ErrBadCursor 分页游标无法解码（格式损坏或列不匹配）。
	ErrBadCursor = errors.New("分页游标无效")
)

// VersionConflict 乐观锁冲突（API 定义 §1.5）：If-Match 与当前 ir_version 不符。
type VersionConflict struct{ Current int }

func (e *VersionConflict) Error() string {
	return fmt.Sprintf("配方已被另一处修改（当前版本 %d）", e.Current)
}

// ValidationError 发布校验未通过：errors 即 HTTP 400 的 details。
type ValidationError struct{ Details []irv.Diagnostic }

func (e *ValidationError) Error() string {
	return fmt.Sprintf("配方校验未通过（%d 个错误）", len(e.Details))
}
