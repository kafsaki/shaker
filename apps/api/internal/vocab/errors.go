package vocab

import "errors"

// ErrNotFound 资源不存在（handler 映射为 404）。
var ErrNotFound = errors.New("资源不存在")
