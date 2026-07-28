package jobs

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

type fakeCleaner struct {
	calls   atomic.Int64
	deleted int64
	err     error
}

func (cleaner *fakeCleaner) Cleanup(context.Context) (int64, error) {
	cleaner.calls.Add(1)
	return cleaner.deleted, cleaner.err
}

func TestRunWritesHeartbeatAndRunsRetention(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: 10 * time.Millisecond,
		APILogCleanupInterval: time.Hour,
		APILogRetentionDays:   30,
		APILogCleanupBatch:    5000,
		LogRetentionOwner:     config.RuntimeOwnerGo,
		JobsHeartbeatMaxAge:   time.Minute,
	}
	cleaner := &fakeCleaner{deleted: 7}
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, discardLogger(), cleaner) }()
	deadline := time.Now().Add(time.Second)
	for cleaner.calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if cleaner.calls.Load() != 1 {
		t.Fatalf("cleanup calls = %d", cleaner.calls.Load())
	}
	content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatalf("heartbeat missing: %v", err)
	}
	if !containsAll(string(content), `"apiLogRetention"`, `"lastDeleted":7`, `"lastSuccessAt"`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestRunRecordsRetentionFailureWithoutCrashingSupervisor(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: 10 * time.Millisecond,
		APILogCleanupInterval: time.Hour,
		LogRetentionOwner:     config.RuntimeOwnerGo,
	}
	cleaner := &fakeCleaner{err: errors.New("database unavailable")}
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, discardLogger(), cleaner) }()
	deadline := time.Now().Add(time.Second)
	for cleaner.calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"lastError":"database unavailable"`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestHeartbeatOnlyModeDoesNotRunRetention(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: 10 * time.Millisecond,
		APILogCleanupInterval: time.Hour,
		LogRetentionOwner:     config.RuntimeOwnerLegacy,
	}
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, discardLogger(), nil) }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(HeartbeatPath(cfg.StateDir)); err != nil {
		t.Fatalf("heartbeat missing: %v", err)
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !strings.Contains(value, part) {
			return false
		}
	}
	return true
}
