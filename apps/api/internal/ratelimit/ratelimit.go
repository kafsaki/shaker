// Package ratelimit 提供单机内存固定窗口限流。
//
// v1 是单实例部署，内存实现即可；多实例时换 Redis 令牌桶，接口不变。
// 认证端点（登录/注册/刷新/改密）按 IP 限流，防撞库与批量注册。
package ratelimit

import (
	"sync"
	"time"
)

// sweepThreshold 触发懒清扫的桶数量下限：正常流量下桶数与活跃 IP 同量级，
// 超过它说明积累了大量过期键，顺手清掉，避免常驻清扫 goroutine。
const sweepThreshold = 4096

type bucket struct {
	start time.Time
	count int
}

// Limiter 固定窗口计数器。窗口边界处允许 2 倍突发（两个窗口各打满），
// 对认证场景可接受。
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	limit   int
	window  time.Duration
}

// New 创建 limit 次 / window 的限流器。
func New(limit int, window time.Duration) *Limiter {
	return &Limiter{
		buckets: make(map[string]*bucket),
		limit:   limit,
		window:  window,
	}
}

// Allow 记录一次访问并报告是否放行。
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, ok := l.buckets[key]
	if !ok || now.Sub(b.start) >= l.window {
		if len(l.buckets) >= sweepThreshold {
			l.sweepLocked(now)
		}
		b = &bucket{start: now}
		l.buckets[key] = b
	}
	b.count++
	return b.count <= l.limit
}

// sweepLocked 清掉已过期的桶。调用方需持锁。
func (l *Limiter) sweepLocked(now time.Time) {
	for k, b := range l.buckets {
		if now.Sub(b.start) >= l.window {
			delete(l.buckets, k)
		}
	}
}
