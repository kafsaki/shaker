package auth

import (
	"strings"
	"testing"
)

func TestPasswordRoundtrip(t *testing.T) {
	hash, err := HashPassword("correct-horse-battery")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Errorf("PHC 前缀不符: %s", hash)
	}
	ok, err := VerifyPassword("correct-horse-battery", hash)
	if err != nil || !ok {
		t.Errorf("正确密码校验失败: ok=%v err=%v", ok, err)
	}
	ok, err = VerifyPassword("wrong-password", hash)
	if err != nil || ok {
		t.Errorf("错误密码竟通过: ok=%v err=%v", ok, err)
	}
}

func TestPasswordUniqueSalts(t *testing.T) {
	h1, _ := HashPassword("same")
	h2, _ := HashPassword("same")
	if h1 == h2 {
		t.Error("两次哈希相同：盐没生效")
	}
}

func TestVerifyMalformedHash(t *testing.T) {
	for _, bad := range []string{
		"",
		"plaintext",
		"$argon2i$v=19$m=65536,t=1,p=1$AAAA$BBBB", // 不是 argon2id
		"$argon2id$v=19$broken$AAAA$BBBB",
		"$argon2id$v=19$m=x,t=1,p=1$AAAA$BBBB",
		"$argon2id$v=19$m=65536,t=1,p=1$!!!$BBBB", // 盐不是 base64
	} {
		if _, err := VerifyPassword("x", bad); err == nil {
			t.Errorf("坏哈希 %q 应返回错误", bad)
		}
	}
}
