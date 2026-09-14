package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// 令牌寿命（API 定义 §1.2）：访问 15 分钟、刷新 30 天。
const (
	AccessTokenTTL  = 15 * time.Minute
	RefreshTokenTTL = 30 * 24 * time.Hour
)

// ErrTokenInvalid 统一覆盖所有 JWT 解析失败（签名错、过期、格式坏）。
// 不区分原因，避免给攻击者提供信息。
var ErrTokenInvalid = errors.New("访问令牌无效或已过期")

// Claims 访问令牌负载。sub = 用户 ID，sid = 会话链 ID（logout/改密按链撤销）。
type Claims struct {
	ChainID string `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

// ChainUUID 返回会话链 ID。
func (c *Claims) ChainUUID() uuid.UUID {
	id, _ := uuid.Parse(c.ChainID)
	return id
}

// UserUUID 返回用户 ID。
func (c *Claims) UserUUID() uuid.UUID {
	id, _ := c.ParseSubject()
	return id
}

// ParseSubject 把 RegisteredClaims.Subject 解析为 uuid（解析失败返回 Nil）。
func (c *Claims) ParseSubject() (uuid.UUID, error) {
	return uuid.Parse(c.Subject)
}

type TokenManager struct {
	secret []byte
}

func NewTokenManager(secret []byte) *TokenManager {
	return &TokenManager{secret: secret}
}

// NewAccessToken 签发 HS256 访问令牌。
func (tm *TokenManager) NewAccessToken(userID, chainID uuid.UUID) (string, error) {
	now := time.Now()
	claims := Claims{
		ChainID: chainID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			Issuer:    "shaker",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(tm.secret)
}

// ParseAccessToken 校验并解析访问令牌。
func (tm *TokenManager) ParseAccessToken(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		return tm.secret, nil
	},
		// 显式白名单：防算法替换攻击（none / RS256 混淆）
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer("shaker"),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, ErrTokenInvalid
	}
	return claims, nil
}

// NewRefreshToken 生成不透明刷新令牌：明文只返回给客户端一次，
// 落库的是 SHA-256 哈希（泄露数据库也推不出可用令牌）。
func NewRefreshToken() (plain, hash string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("生成刷新令牌: %w", err)
	}
	plain = base64.RawURLEncoding.EncodeToString(buf)
	return plain, HashRefreshToken(plain), nil
}

// HashRefreshToken 计算刷新令牌的库内存储哈希。
func HashRefreshToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}
