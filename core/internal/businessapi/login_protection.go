package businessapi

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type loginProtectionStore interface {
	Increment(context.Context, string, time.Duration) (int64, error)
	Set(context.Context, string, string, time.Duration) error
	TTL(context.Context, string) (time.Duration, error)
	Delete(context.Context, ...string) error
}

type loginProtector struct {
	store        loginProtectionStore
	namespace    string
	maxAttempts  int
	lockDuration time.Duration
}

func newLoginProtector(store loginProtectionStore, namespace string, maxAttempts int, lockDuration time.Duration) loginProtector {
	return loginProtector{
		store:        store,
		namespace:    namespace,
		maxAttempts:  maxAttempts,
		lockDuration: lockDuration,
	}
}

func buildLoginProtectionCacheKey(namespace, username, ip string) string {
	normalizedUsername := strings.ToLower(strings.TrimSpace(username))
	normalizedIP := strings.TrimSpace(ip)
	if normalizedIP == "" {
		normalizedIP = "unknown"
	}
	return fmt.Sprintf("%s-login:%s:%s", namespace, normalizedUsername, normalizedIP)
}

func (p loginProtector) lockRemaining(ctx context.Context, cacheKey string) (time.Duration, error) {
	return p.store.TTL(ctx, p.lockKey(cacheKey))
}

func (p loginProtector) recordFailure(ctx context.Context, cacheKey string) (time.Duration, error) {
	count, err := p.store.Increment(ctx, p.attemptKey(cacheKey), p.lockDuration)
	if err != nil {
		return 0, err
	}
	if count < int64(p.maxAttempts) {
		return 0, nil
	}
	if err := p.store.Set(ctx, p.lockKey(cacheKey), "1", p.lockDuration); err != nil {
		return 0, err
	}
	if err := p.store.Delete(ctx, p.attemptKey(cacheKey)); err != nil {
		return 0, err
	}
	return p.lockDuration, nil
}

func (p loginProtector) clear(ctx context.Context, cacheKey string) error {
	return p.store.Delete(ctx, p.attemptKey(cacheKey), p.lockKey(cacheKey))
}

func (p loginProtector) attemptKey(cacheKey string) string {
	return fmt.Sprintf("auth:%s:login:attempt:%s", p.namespace, cacheKey)
}

func (p loginProtector) lockKey(cacheKey string) string {
	return fmt.Sprintf("auth:%s:login:lock:%s", p.namespace, cacheKey)
}
