// Package auth 实现认证体系（docs/03-API定义.md §1.2 / §2.1）：
//
//   - 密码哈希：argon2id，PHC 字符串格式
//   - 访问令牌：JWT HS256，15 分钟，不落库
//   - 刷新令牌：32 字节随机不透明串，30 天，库里只存 SHA-256 哈希
//   - 轮转：刷新即作废旧令牌；检测到旧令牌重放 → 撤销该用户全部会话
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// OWASP 2024 推荐档位：64MiB / t=1 / p=1。单次校验约 60ms 量级，
// 登录并发低，够用且防 GPU 撞库。
const (
	argonTime    = 1
	argonMemory  = 64 * 1024 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// ErrHashMalformed 表示存储的哈希字符串本身损坏（区别于密码不匹配）。
var ErrHashMalformed = errors.New("存储的密码哈希格式无效")

// HashPassword 生成 PHC 格式的 argon2id 哈希。
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("生成盐值: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64RawStd(salt), base64RawStd(key),
	), nil
}

// VerifyPassword 用恒定时间比较校验密码。
// 返回 (false, nil) = 密码不匹配；err 仅在哈希损坏时非空。
func VerifyPassword(password, phc string) (bool, error) {
	// $argon2id$v=19$m=65536,t=1,p=1$<salt>$<hash>
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, ErrHashMalformed
	}
	version, err := strconv.Atoi(strings.TrimPrefix(parts[2], "v="))
	if err != nil || version != argon2.Version {
		return false, ErrHashMalformed
	}
	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false, ErrHashMalformed
	}
	salt, err := decodeB64(parts[4])
	if err != nil {
		return false, ErrHashMalformed
	}
	want, err := decodeB64(parts[5])
	if err != nil {
		return false, ErrHashMalformed
	}
	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// base64RawStd / decodeB64：PHC 规范要求无填充 base64（标准字母表）。
func base64RawStd(b []byte) string {
	return base64.RawStdEncoding.EncodeToString(b)
}

func decodeB64(s string) ([]byte, error) {
	return base64.RawStdEncoding.DecodeString(s)
}
