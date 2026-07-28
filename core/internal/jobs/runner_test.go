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
	content := waitForHeartbeatContains(t, cfg.StateDir, `"lastDeleted":7`, time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if cleaner.calls.Load() != 1 {
		t.Fatalf("cleanup calls = %d", cleaner.calls.Load())
	}
	if !containsAll(string(content), `"apiLogRetention"`, `"lastSuccessAt"`, `"lastCompletedAt"`) {
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
	content := waitForHeartbeatContains(t, cfg.StateDir, `"lastDeleted":3`, time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"lastSuccessAt"`) || strings.Contains(string(content), `"lastError"`) || strings.Contains(string(content), `"consecutiveFailures"`) {
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
	content := waitForHeartbeatContains(t, cfg.StateDir, "context deadline exceeded", time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"running":false`, `"consecutiveFailures":1`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestHeartbeatOnlyModeDoesNotRunRetention(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := baseJobConfig(t)
	cfg.LogRetentionOwner = config.RuntimeOwnerLegacy
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, discardLogger(), nil) }()
	content := waitForHeartbeatContains(t, cfg.StateDir, `"apiLogRetention":{"enabled":false`, time.Second)
	cancel()
	if err := <-done; err != nil {
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
	content := waitForHeartbeatContains(t, cfg.StateDir, `"lastDeleted":2`, time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"apiLogRetention"`, `"forwarding"`, `"lastSuccessAt"`) {
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

	firstContent := waitForHeartbeatContains(t, cfg.StateDir, `"running":true`, time.Second)
	deadline := time.Now().Add(time.Second)
	var secondContent []byte
	for time.Now().Before(deadline) {
		content, err := os.ReadFile(HeartbeatPath(cfg.StateDir))
		if err == nil && string(content) != string(firstContent) {
			secondContent = content
			break
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if len(secondContent) == 0 {
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

	content := waitForHeartbeatContains(t, cfg.StateDir, "context deadline exceeded", time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"running":false`, `"consecutiveFailures":1`) {
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

func waitForHeartbeatContains(t *testing.T, stateDir, expected string, timeout time.Duration) []byte {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var lastContent []byte
	var lastErr error
	for time.Now().Before(deadline) {
		content, err := os.ReadFile(HeartbeatPath(stateDir))
		if err == nil {
			lastContent = content
			if strings.Contains(string(content), expected) {
				return content
			}
		} else {
			lastErr = err
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("heartbeat did not contain %q before timeout; last content=%s last error=%v", expected, lastContent, lastErr)
	return nil
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
