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

type retryCleaner struct {
	calls atomic.Int64
}

func (cleaner *retryCleaner) Cleanup(context.Context) (int64, error) {
	if cleaner.calls.Add(1) == 1 {
		return 0, errors.New("temporary database error")
	}
	return 3, nil
}

type blockingCleaner struct {
	calls atomic.Int64
}

func (cleaner *blockingCleaner) Cleanup(ctx context.Context) (int64, error) {
	cleaner.calls.Add(1)
	<-ctx.Done()
	return 0, ctx.Err()
}

func baseJobConfig(t *testing.T) config.Config {
	t.Helper()
	return config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: 10 * time.Millisecond,
		JobsHeartbeatMaxAge:   time.Minute,
		APILogCleanupInterval: time.Hour,
		APILogCleanupRetry:    10 * time.Millisecond,
		APILogCleanupTimeout:  time.Second,
		APILogRetentionDays:   30,
		APILogCleanupBatch:    5000,
		LogRetentionOwner:     config.RuntimeOwnerGo,
		ForwardingRunTimeout:  time.Second,
	}
}

func TestRunWritesHeartbeatAndRunsRetention(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := baseJobConfig(t)
	cleaner := &fakeCleaner{deleted: 7}
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, discardLogger(), cleaner) }()
	waitForCalls(t, &cleaner.calls, 1)
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
	if !containsAll(string(content), `"apiLogRetention"`, `"lastDeleted":7`, `"lastSuccessAt"`, `"lastCompletedAt"`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestRetentionRetriesAfterFailureAndRecovers(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := baseJobConfig(t)
	cleaner := &retryCleaner{}
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, discardLogger(), cleaner) }()
	waitForCalls(t, &cleaner.calls, 2)
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"lastDeleted":3`, `"lastSuccessAt"`, `"consecutiveFailures":0`) || strings.Contains(string(content), `"lastError"`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestRetentionRunIsTimeBounded(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := baseJobConfig(t)
	cfg.APILogCleanupTimeout = 15 * time.Millisecond
	cfg.APILogCleanupRetry = time.Hour
	cleaner := &blockingCleaner{}
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, discardLogger(), cleaner) }()
	waitForCalls(t, &cleaner.calls, 1)
	time.Sleep(30 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "context deadline exceeded") {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestHeartbeatOnlyModeDoesNotRunRetention(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := baseJobConfig(t)
	cfg.LogRetentionOwner = config.RuntimeOwnerLegacy
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
	content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	if !containsAll(
		string(content),
		`"apiLogRetention":{"enabled":false,"running":false}`,
		`"forwarding":{"enabled":false,"running":false}`,
	) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestRunRequiresDatabaseForGoForwardingOwner(t *testing.T) {
	cfg := config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: time.Second,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
		EncryptionKey:         "test-encryption-key-1234567890ab",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := Run(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil))); err == nil {
		t.Fatal("Run() expected an error")
	}
}

type blockingForwardingRunner struct{}

func (blockingForwardingRunner) runOnce(ctx context.Context, _ time.Time) error {
	<-ctx.Done()
	return ctx.Err()
}

type signaledBlockingForwardingRunner struct {
	started chan struct{}
}

func (runner signaledBlockingForwardingRunner) runOnce(ctx context.Context, _ time.Time) error {
	close(runner.started)
	<-ctx.Done()
	return ctx.Err()
}

type countingForwardingRunner struct {
	calls atomic.Int64
}

func (runner *countingForwardingRunner) runOnce(context.Context, time.Time) error {
	runner.calls.Add(1)
	return nil
}

func TestRunSupervisorRunsRetentionAndForwardingTogether(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := baseJobConfig(t)
	cfg.ForwardingWorkerOwner = config.RuntimeOwnerGo
	cfg.ForwardingInterval = time.Hour
	cleaner := &fakeCleaner{deleted: 2}
	forwarder := &countingForwardingRunner{}
	done := make(chan error, 1)
	go func() {
		done <- runSupervisor(ctx, cfg, discardLogger(), cleaner, forwarder, func(context.Context) error { return nil })
	}()

	waitForCalls(t, &cleaner.calls, 1)
	waitForCalls(t, &forwarder.calls, 1)
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"apiLogRetention"`, `"lastDeleted":2`, `"forwarding"`, `"lastSuccessAt"`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestRunSupervisorKeepsHeartbeatFreshDuringSlowForwarding(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: 10 * time.Millisecond,
		ForwardingInterval:    time.Hour,
		ForwardingRunTimeout:  time.Second,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
	}
	done := make(chan error, 1)
	go func() {
		done <- runSupervisor(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, blockingForwardingRunner{}, func(context.Context) error { return nil })
	}()

	time.Sleep(15 * time.Millisecond)
	firstContent, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(25 * time.Millisecond)
	secondContent, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if string(firstContent) == string(secondContent) {
		t.Fatal("heartbeat did not advance while forwarding was blocked")
	}
	if !strings.Contains(string(secondContent), `"running":true`) {
		t.Fatalf("heartbeat = %s", secondContent)
	}
}

func TestRunSupervisorTimesOutSlowForwarding(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: 5 * time.Millisecond,
		ForwardingInterval:    time.Hour,
		ForwardingRunTimeout:  15 * time.Millisecond,
		ShutdownTimeout:       time.Second,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
	}
	done := make(chan error, 1)
	go func() {
		done <- runSupervisor(ctx, cfg, discardLogger(), nil, blockingForwardingRunner{}, func(context.Context) error { return nil })
	}()

	time.Sleep(40 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
	if err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), "context deadline exceeded", `"running":false`, `"consecutiveFailures":1`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestRunSupervisorReturnsWhenForwardingOwnerConnectionIsLost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	cfg := config.Config{
		StateDir:              t.TempDir(),
		JobsHeartbeatInterval: 10 * time.Millisecond,
		ForwardingInterval:    time.Hour,
		ForwardingRunTimeout:  time.Second,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
	}

	err := runSupervisor(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, blockingForwardingRunner{}, func(context.Context) error {
		return errors.New("owner connection closed")
	})
	if err == nil || !strings.Contains(err.Error(), "forwarding owner lock connection lost") {
		t.Fatalf("runSupervisor() error = %v, want owner lock loss", err)
	}
}

func TestRunSupervisorCancelsActiveForwardingWhenOwnerConnectionIsLost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	cfg := config.Config{
		StateDir:              t.TempDir(),
		ReadyTimeout:          50 * time.Millisecond,
		ShutdownTimeout:       100 * time.Millisecond,
		JobsHeartbeatInterval: 10 * time.Millisecond,
		ForwardingInterval:    time.Hour,
		ForwardingRunTimeout:  time.Second,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
	}
	started := make(chan struct{})
	var checks atomic.Int64
	done := make(chan error, 1)
	go func() {
		done <- runSupervisor(ctx, cfg, discardLogger(), nil, signaledBlockingForwardingRunner{started: started}, func(context.Context) error {
			if checks.Add(1) == 1 {
				return nil
			}
			return errors.New("owner connection closed")
		})
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("forwarding run did not start")
	}
	err := <-done
	if err == nil || !strings.Contains(err.Error(), "forwarding owner lock connection lost") {
		t.Fatalf("runSupervisor() error = %v, want owner lock loss", err)
	}
	if checks.Load() < 2 {
		t.Fatalf("owner checks = %d, want initial and active-run checks", checks.Load())
	}
}

func waitForCalls(t *testing.T, calls *atomic.Int64, target int64) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for calls.Load() < target && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if calls.Load() < target {
		t.Fatalf("cleanup calls = %d, want at least %d", calls.Load(), target)
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
