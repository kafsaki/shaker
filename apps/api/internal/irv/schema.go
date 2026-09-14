package irv

import (
	"bytes"
	"embed"
	"fmt"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

//go:embed recipe-ir.schema.json
var schemaFiles embed.FS

const schemaURL = "https://shaker.local/schema/recipe-ir/v1.json"

var schemaPrinter = message.NewPrinter(language.English)

// compiledSchema 进程启动时编译一次。schema 随二进制 embed 同发布 ——
// 不存在「DB 里的旧配方被新 schema 校验」的漂移，跨版本由 schemaVersion 字段管。
var compiledSchema = func() *jsonschema.Schema {
	raw, err := schemaFiles.ReadFile("recipe-ir.schema.json")
	if err != nil {
		panic("irv: 内嵌的 recipe-ir.schema.json 缺失: " + err.Error())
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		panic("irv: 内嵌 schema 不是合法 JSON: " + err.Error())
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource(schemaURL, doc); err != nil {
		panic("irv: 注册 schema 失败: " + err.Error())
	}
	sch, err := c.Compile(schemaURL)
	if err != nil {
		panic("irv: 编译 schema 失败（gen-schema 产物损坏？）: " + err.Error())
	}
	return sch
}()

// Check 是配方校验总入口（API 定义 §3）：
// JSON 语法 → JSON Schema 结构 → 业务规则语义。
// 结构非法时返回 nil；语义层的 error/warning 全部收集在 Result。
func Check(raw []byte, vocab *Vocab) (*IR, Result) {
	var res Result

	decoded, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		res.add(errDiag("schema.invalid_json", "不是合法的 JSON: "+err.Error(), ""))
		res.OK = false
		return nil, res
	}

	if verr := compiledSchema.Validate(decoded); verr != nil {
		for _, d := range schemaDiags(verr.(*jsonschema.ValidationError)) {
			res.add(d)
		}
		res.OK = false
		return nil, res
	}

	ir, err := ParseIR(raw)
	if err != nil {
		// schema 已保证形状，这里只剩理论上的解码失败
		res.add(errDiag("schema.unparseable", "IR 解析失败: "+err.Error(), ""))
		res.OK = false
		return nil, res
	}

	ruleRes := ValidateIR(ir, vocab)
	res.Errors = append(res.Errors, ruleRes.Errors...)
	res.Warnings = append(res.Warnings, ruleRes.Warnings...)
	res.OK = len(res.Errors) == 0
	return ir, res
}

// schemaDiags 把 ValidationError 树拍平成 Diagnostic。
func schemaDiags(verr *jsonschema.ValidationError) []Diagnostic {
	var out []Diagnostic
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			out = append(out, errDiag("schema",
				e.ErrorKind.LocalizedString(schemaPrinter),
				jsonPtrToPath(e.InstanceLocation)))
			return
		}
		switch e.ErrorKind.(type) {
		case *kind.OneOf, *kind.AnyOf:
			out = append(out, unionDiags(e)...)
			return
		}
		for _, c := range e.Causes {
			walk(c)
		}
	}
	for _, c := range verr.Causes {
		walk(c)
	}
	return out
}

// unionDiags：discriminated union（ingredients 的 anyOf、steps 的 oneOf）失败时的降噪。
// 每个直接子错误是一个分支的失败。判别字段（action/unit）失配的分支不是用户想写的，
// 整个丢弃；只有判别字段匹配的分支里的错误才是死因。全部失配（比如编了个不存在的
// 动作）才折叠成一条 no_branch。
func unionDiags(e *jsonschema.ValidationError) []Diagnostic {
	if oe, ok := e.ErrorKind.(*kind.OneOf); ok && len(oe.Subschemas) > 0 {
		return []Diagnostic{errDiag("schema.multi_branch",
			"字段组合同时匹配了多个允许的形状（疑似字段冲突）",
			jsonPtrToPath(e.InstanceLocation))}
	}

	var real []*jsonschema.ValidationError
	for _, branch := range e.Causes {
		intended := true
		var collect func(x *jsonschema.ValidationError)
		collect = func(x *jsonschema.ValidationError) {
			if len(x.Causes) == 0 {
				if isDiscriminatorMismatch(x) {
					intended = false
				}
				real = append(real, x)
				return
			}
			for _, c := range x.Causes {
				collect(c)
			}
		}
		collect(branch)
		if !intended {
			// 回滚这个分支的叶子 —— 它不是用户想写的分支
			real = real[:len(real)-countLeaves(branch)]
		}
	}
	if len(real) == 0 {
		return []Diagnostic{errDiag("schema.no_branch",
			"字段组合不匹配任何允许的形状（检查动作名、单位与用量的搭配）",
			jsonPtrToPath(e.InstanceLocation))}
	}

	seen := map[string]bool{}
	var out []Diagnostic
	for _, l := range real {
		msg := l.ErrorKind.LocalizedString(schemaPrinter)
		key := fmt.Sprintf("%T@%s@%s", l.ErrorKind, jsonPtrToPath(l.InstanceLocation), msg)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, errDiag("schema", msg, jsonPtrToPath(l.InstanceLocation)))
		if len(out) >= 8 {
			break
		}
	}
	return out
}

func countLeaves(e *jsonschema.ValidationError) int {
	if len(e.Causes) == 0 {
		return 1
	}
	n := 0
	for _, c := range e.Causes {
		n += countLeaves(c)
	}
	return n
}

// isDiscriminatorMismatch：Const/Enum 失配且落在判别字段（action/unit）上。
// 判定依据是实例位置 —— 分支校验作用于同一个对象，action 的失配叶子
// InstanceLocation 一定以 "action" 结尾。
func isDiscriminatorMismatch(l *jsonschema.ValidationError) bool {
	switch l.ErrorKind.(type) {
	case *kind.Const, *kind.Enum:
	default:
		return false
	}
	toks := l.InstanceLocation
	if len(toks) == 0 {
		return false
	}
	last := toks[len(toks)-1]
	return last == "action" || last == "unit"
}

// jsonPtrToPath 把 JSON Pointer（/ingredients/0/slot）转成与 validate.ts
// 一致的编辑器路径（ingredients[0].slot）—— 前端高亮逻辑两边共用一套路径。
func jsonPtrToPath(tokens []string) string {
	var sb strings.Builder
	for _, tok := range tokens {
		if n, err := strconv.Atoi(tok); err == nil {
			fmt.Fprintf(&sb, "[%d]", n)
		} else if sb.Len() == 0 {
			sb.WriteString(tok)
		} else {
			sb.WriteByte('.')
			sb.WriteString(tok)
		}
	}
	return sb.String()
}
