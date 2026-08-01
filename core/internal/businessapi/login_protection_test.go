package businessapi

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeLoginProtectionStore struct {
	counts  map[string]int64
	ttls    map[string]time.Duration
	deleted []string
	err     error
}

func (s *fakeLoginProtectionStore) Increment(_ context.Context, key string, ttl time.Duration) (int64, error) {
	if s.err != nil {
		return 0, s.err
	}
	if s.counts == nil {
		s.counts = make(map[string]int64)
	}
	s.counts[key]++
	s.ttls[key] = ttl
	return s.counts[key], nil
}

func (s *fakeLoginProtectionStore) Set(_ context.Context, key, _ string, ttl time.Duration) error {
	if s.err != nil {
		return s.err
	}
	if s.ttls == nil {
		s.ttls = make(map[string]time.Duration)
	}
	s.ttls[key] = ttl
	return nil
}

func (s *fakeLoginProtectionStore) TTL(_ context.Context, key string) (time.Duration, error) {
	if s.err != nil {
		return 0, s.err
	}
	return s.ttls[key], nil
}

func (s *fakeLoginProtectionStore) Delete(_ context.Context, keys ...string) error {
	if s.err != nil {
		return s.err
	}
	s.deleted = append(s.deleted, keys...)
	for _, key := range keys {
		delete(s.counts, key)
		delete(s.ttls, key)
	}
	return nil
}

func TestLoginProtectorPreservesAdminKeysAndLocksAtThreshold(t *testing.T) {
	store := &fakeLoginProtectionStore{ttls: make(map[string]time.Duration)}
	protector := newLoginProtector(store, "admin", 3, 15*time.Minute)
	cacheKey := buildLoginProtectionCacheKey("admin", " Admin ", "203.0.113.8")
	if cacheKey != "admin-login:admin:203.0.113.8" {
		t.Fatalf("cache key = %q", cacheKey)
	}

	for attempt := 1; attempt <= 2; attempt++ {
		remaining, err := protector.recordFailure(context.Background(), cacheKey)
		if err != nil || remaining != 0 {
			t.Fatalf("attempt %d = %v, %v", attempt, remaining, err)
		}
	}
	remaining, err := protector.recordFailure(context.Background(), cacheKey)
	if err != nil || remaining != 15*time.Minute {
		t.Fatalf("threshold = %v, %v", remaining, err)
	}
	if store.ttls["auth:admin:login:lock:admin-login:admin:203.0.113.8"] != 15*time.Minute {
		t.Fatalf("lock keys = %#v", store.ttls)
	}

	remaining, err = protector.lockRemaining(context.Background(), cacheKey)
	if err != nil || remaining != 15*time.Minute {
		t.Fatalf("lock remaining = %v, %v", remaining, err)
	}
	if err := protector.clear(context.Background(), cacheKey); err != nil {
		t.Fatal(err)
	}
	if len(store.deleted) != 3 ||
		store.deleted[0] != "auth:admin:login:attempt:admin-login:admin:203.0.113.8" ||
		store.deleted[1] != "auth:admin:login:attempt:admin-login:admin:203.0.113.8" ||
		store.deleted[2] != "auth:admin:login:lock:admin-login:admin:203.0.113.8" {
		t.Fatalf("deleted keys = %#v", store.deleted)
	}
}

func TestLoginProtectorSeparatesMailboxKeysAndFailsClosed(t *testing.T) {
	store := &fakeLoginProtectionStore{ttls: make(map[string]time.Duration)}
	protector := newLoginProtector(store, "mailbox", 1, time.Minute)
	cacheKey := buildLoginProtectionCacheKey("mailbox", "User@Example.com", "")
	if cacheKey != "mailbox-login:user@example.com:unknown" {
		t.Fatalf("cache key = %q", cacheKey)
	}
	if _, err := protector.recordFailure(context.Background(), cacheKey); err != nil {
		t.Fatal(err)
	}
	if store.ttls["auth:mailbox:login:lock:mailbox-login:user@example.com:unknown"] != time.Minute {
		t.Fatalf("mailbox lock keys = %#v", store.ttls)
	}

	store.err = errors.New("redis unavailable")
	if _, err := protector.lockRemaining(context.Background(), cacheKey); err == nil {
		t.Fatal("lockRemaining allowed an unavailable Redis backend")
	}
	if _, err := protector.recordFailure(context.Background(), cacheKey); err == nil {
		t.Fatal("recordFailure allowed an unavailable Redis backend")
	}
	if err := protector.clear(context.Background(), cacheKey); err == nil {
		t.Fatal("clear allowed an unavailable Redis backend")
	}
}
