// gen-openapi 输出 OpenAPI 3.1 spec 到 stdout（ADR-017：code-first 单向流向）：
//
//	go run ./cmd/gen-openapi > schema/openapi.yaml
//
// CI 用 diff 检查 spec 与代码同步；不连数据库。
package main

import (
	"fmt"
	"os"

	"github.com/kafsaki/shaker/apps/api/internal/api"
)

func main() {
	b, err := api.GenOpenAPI()
	if err != nil {
		fmt.Fprintln(os.Stderr, "生成 OpenAPI 失败:", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(b); err != nil {
		fmt.Fprintln(os.Stderr, "写入 stdout 失败:", err)
		os.Exit(1)
	}
}
