// Package base58 配方短号的编解码（BTC 字符集：去掉 0 O I l 四个易混字符）。
// 短号序列从 58^5 起，编码恒 6 位 —— int64 除法足够，不需要 big.Int。
package base58

import (
	"fmt"
	"strings"
)

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// Encode 非负整数 → base58。n 必须在 [0, 2^63) 内。
func Encode(n int64) string {
	if n < 0 {
		panic(fmt.Sprintf("base58: 负数 %d", n))
	}
	var b [11]byte // int64 上限 58^11 略溢，11 位封顶足够
	i := len(b)
	for {
		i--
		b[i] = alphabet[n%58]
		n /= 58
		if n == 0 {
			break
		}
	}
	return string(b[i:])
}

// Decode base58 → 非负整数。非法字符或超出 int64 时报错。
func Decode(s string) (int64, error) {
	if s == "" {
		return 0, fmt.Errorf("base58: 空串")
	}
	var n int64
	for _, c := range s {
		idx := strings.IndexRune(alphabet, c)
		if idx < 0 {
			return 0, fmt.Errorf("base58: 非法字符 %q", c)
		}
		if n > (1<<63-1-int64(idx))/58 {
			return 0, fmt.Errorf("base58: %q 超出 int64", s)
		}
		n = n*58 + int64(idx)
	}
	return n, nil
}
