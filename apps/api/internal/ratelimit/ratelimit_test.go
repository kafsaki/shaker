package ratelimit

import (
	"testing"
	"time"
)

func TestAllowWithinLimit(t *testing.T) {
	l := New(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !l.Allow("ip") {
			t.Fatalf("第 %d 次应放行", i+1)
		}
	}
	if l.Allow("ip") {
		t.Error("第 4 次应拒绝")
	}
	// 其它 key 不受影响
	if !l.Allow("other") {
		t.Error("不同 key 应独立计数")
	}
}

func TestWindowReset(t *testing.T) {
	l := New(2, 50*time.Millisecond)
	l.Allow("ip")
	l.Allow("ip")
	if l.Allow("ip") {
		t.Fatal("应拒绝")
	}
	time.Sleep(60 * time.Millisecond)
	if !l.Allow("ip") {
		t.Error("窗口滑过后应重新放行")
	}
}
