package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestAccessTokenRoundtrip(t *testing.T) {
	tm := NewTokenManager([]byte("test-secret"))
	uid, _ := uuid.NewV7()
	cid, _ := uuid.NewV7()
	tok, err := tm.NewAccessToken(uid, cid)
	if err != nil {
		t.Fatalf("签发: %v", err)
	}
	claims, err := tm.ParseAccessToken(tok)
	if err != nil {
		t.Fatalf("解析: %v", err)
	}
	if claims.UserUUID() != uid || claims.ChainUUID() != cid {
		t.Errorf("负载不符: sub=%s sid=%s", claims.Subject, claims.ChainID)
	}
	if claims.Issuer != "shaker" {
		t.Errorf("issuer = %s", claims.Issuer)
	}
}

func TestAccessTokenWrongSecret(t *testing.T) {
	uid, _ := uuid.NewV7()
	cid, _ := uuid.NewV7()
	tok, err := NewTokenManager([]byte("secret-a")).NewAccessToken(uid, cid)
	if err != nil {
		t.Fatalf("签发: %v", err)
	}
	if _, err := NewTokenManager([]byte("secret-b")).ParseAccessToken(tok); err != ErrTokenInvalid {
		t.Errorf("错密钥应返回 ErrTokenInvalid，得到 %v", err)
	}
}

func TestAccessTokenExpired(t *testing.T) {
	tm := NewTokenManager([]byte("s"))
	// 手工造一个已过期的令牌：过期是解析时校验的
	claims := Claims{
		ChainID: uuid.NewString(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   uuid.NewString(),
			Issuer:    "shaker",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("s"))
	if err != nil {
		t.Fatalf("签发: %v", err)
	}
	if _, err := tm.ParseAccessToken(tok); err != ErrTokenInvalid {
		t.Errorf("过期令牌应返回 ErrTokenInvalid，得到 %v", err)
	}
}

func TestRefreshTokenHashing(t *testing.T) {
	p1, h1, err := NewRefreshToken()
	if err != nil {
		t.Fatalf("生成: %v", err)
	}
	p2, h2, _ := NewRefreshToken()
	if len(p1) != 43 { // 32 字节 base64url
		t.Errorf("明文长度 = %d", len(p1))
	}
	if p1 == p2 || h1 == h2 {
		t.Error("两次生成相同")
	}
	if HashRefreshToken(p1) != h1 {
		t.Error("哈希不稳定")
	}
}
