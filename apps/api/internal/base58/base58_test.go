package base58

import (
	"strings"
	"testing"
)

// 短号序列起始值 58^5 —— 首号编码恒 6 位。
const seqStart = 656356768 // 58^5

func TestSeqStartSixChars(t *testing.T) {
	if got := Encode(seqStart); got != "211111" {
		t.Fatalf("首号编码 = %q, 期望 211111（恒 6 位起点）", got)
	}
	// 序列此后所有值同样恒 6 位（6 位区间上界 58^6 - 1）
	for n := int64(seqStart); n < seqStart+10000; n++ {
		if s := Encode(n); len(s) != 6 {
			t.Fatalf("短号 %d 编码 %q 位数 = %d, 期望恒 6", n, s, len(s))
		}
	}
}

func TestRoundTrip(t *testing.T) {
	for _, n := range []int64{0, 1, 57, 58, seqStart, seqStart + 1, 58 * 58 * 58, 1 << 40, 1<<62 - 1} {
		d, err := Decode(Encode(n))
		if err != nil {
			t.Fatalf("Decode(%d): %v", n, err)
		}
		if d != n {
			t.Fatalf("往返 %d != %d", d, n)
		}
	}
}

func TestAlphabetExcludesAmbiguous(t *testing.T) {
	for _, c := range "0OIl+/" {
		if strings.ContainsRune(alphabet, c) {
			t.Fatalf("字符集包含易混字符 %q", c)
		}
	}
}

func TestDecodeInvalid(t *testing.T) {
	for _, s := range []string{"", "100000", "0", "IOl0", "ab cd", "世界", "211111\n"} {
		if _, err := Decode(s); err == nil {
			t.Fatalf("Decode(%q) 应报错", s)
		}
	}
}
