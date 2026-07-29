package jobs

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testRuntimeConfig(t *testing.T, worker string) runtimeConfig {
	t.Helper()
	return runtimeConfig{
		name:              worker,
		stateDir:          t.TempDir(),
		interval:          time.Hour,
		retry:             5 * time.Millisecond,
		runTimeout:        time.Second,
		heartbeatInterval: 5 * time.Millisecond,
		shutdownTimeout:   time.Second,
		healthTimeout:     50 * time.Millisecond,
	}
}

func TestWorkerWritesSuccessHeartbeat(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := testRuntimeConfig(t, WorkerRetention)
	var calls atomic.Int64
	cfg.runOnce = func(context.Context, time.Time) (int64, error) {
		calls.Add(1)
		return 7, nil
	}
	done := make(chan error, 1)
	go func() { done <- runWorker(ctx, cfg, discardLogger()) }()

	content := waitForWorkerHeartbeatContains(t, cfg.stateDir, cfg.name, `"lastDeleted":7`, time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("run calls = %d, want 1", calls.Load())
	}
	if !containsAll(string(content), `"runtime":"allmail-worker-retention"`, `"lastSuccessAt"`, `"lastCompletedAt"`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestWorkerRetriesAndRecovers(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := testRuntimeConfig(t, WorkerRetention)
	var calls atomic.Int64
	cfg.runOnce = func(context.Context, time.Time) (int64, error) {
		if calls.Add(1) == 1 {
			return 0, errors.New("temporary database error")
		}
		return 3, nil
	}
	done := make(chan error, 1)
	go func() { done <- runWorker(ctx, cfg, discardLogger()) }()

	content := waitForWorkerHeartbeatContains(t, cfg.stateDir, cfg.name, `"lastDeleted":3`, time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if calls.Load() < 2 {
		t.Fatalf("run calls = %d, want at least 2", calls.Load())
	}
	if strings.Contains(string(content), `"lastError"`) || strings.Contains(string(content), `"consecutiveFailures"`) {
		t.Fatalf("recovered heartbeat = %s", content)
	}
}

func TestWorkerRunIsTimeBounded(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := testRuntimeConfig(t, WorkerForwarding)
	cfg.runTimeout = 15 * time.Millisecond
	cfg.retry = time.Hour
	cfg.runOnce = func(runCtx context.Context, _ time.Time) (int64, error) {
		<-runCtx.Done()
		return 0, runCtx.Err()
	}
	done := make(chan error, 1)
	go func() { done <- runWorker(ctx, cfg, discardLogger()) }()

	content := waitForWorkerHeartbeatContains(t, cfg.stateDir, cfg.name, "context deadline exceeded", time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !containsAll(string(content), `"running":false`, `"consecutiveFailures":1`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestWorkerHeartbeatAdvancesDuringSlowRun(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := testRuntimeConfig(t, WorkerForwarding)
	cfg.runOnce = func(runCtx context.Context, _ time.Time) (int64, error) {
		<-runCtx.Done()
		return 0, runCtx.Err()
	}
	done := make(chan error, 1)
	go func() { done <- runWorker(ctx, cfg, discardLogger()) }()

	first := waitForWorkerHeartbeatContains(t, cfg.stateDir, cfg.name, `"running":true`, time.Second)
	deadline := time.Now().Add(time.Second)
	var second []byte
	for time.Now().Before(deadline) {
		content, err := os.ReadFile(HeartbeatPath(cfg.stateDir, cfg.name))
		if err == nil && string(content) != string(first) && strings.Contains(string(content), `"running":true`) {
			second = content
			break
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if len(second) == 0 {
		t.Fatal("heartbeat did not advance during active run")
	}
	final, err := os.ReadFile(HeartbeatPath(cfg.stateDir, cfg.name))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(final), `"running":false`) {
		t.Fatalf("final heartbeat = %s", final)
	}
}

func TestWorkerStopsWhenHealthCheckFails(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	cfg := testRuntimeConfig(t, WorkerForwarding)
	started := make(chan struct{})
	cfg.runOnce = func(runCtx context.Context, _ time.Time) (int64, error) {
		close(started)
		<-runCtx.Done()
		return 0, runCtx.Err()
	}
	var checks atomic.Int64
	cfg.healthCheck = func(context.Context) error {
		if checks.Add(1) == 1 {
			return nil
		}
		return errForwardingOwnerLockLost
	}
	done := make(chan error, 1)
	go func() { done <- runWorker(ctx, cfg, discardLogger()) }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("worker did not start")
	}
	err := <-done
	if err == nil || !errors.Is(err, errForwardingOwnerLockLost) {
		t.Fatalf("runWorker() error = %v, want owner lock loss", err)
	}
	if checks.Load() < 2 {
		t.Fatalf("health checks = %d, want initial and periodic checks", checks.Load())
	}
	content, readErr := os.ReadFile(HeartbeatPath(cfg.stateDir, cfg.name))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !containsAll(string(content), `"running":false`, errForwardingOwnerLockLost.Error()) {
		t.Fatalf("final heartbeat = %s", content)
	}
}

func TestWorkerPublishesShutdownTimeout(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := testRuntimeConfig(t, WorkerForwarding)
	cfg.shutdownTimeout = 10 * time.Millisecond
	release := make(chan struct{})
	cfg.runOnce = func(context.Context, time.Time) (int64, error) {
		<-release
		return 0, nil
	}
	done := make(chan error, 1)
	go func() { done <- runWorker(ctx, cfg, discardLogger()) }()
	waitForWorkerHeartbeatContains(t, cfg.stateDir, cfg.name, `"running":true`, time.Second)
	cancel()
	err := <-done
	close(release)
	if err == nil || !strings.Contains(err.Error(), "timed out waiting") {
		t.Fatalf("runWorker() error = %v, want shutdown timeout", err)
	}
	content, readErr := os.ReadFile(HeartbeatPath(cfg.stateDir, cfg.name))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !containsAll(string(content), `"running":false`, "timed out waiting") {
		t.Fatalf("final heartbeat = %s", content)
	}
}

func TestWriteHeartbeatSupportsConcurrentPublishers(t *testing.T) {
	stateDir := t.TempDir()
	const publishers = 32
	start := make(chan struct{})
	errorsCh := make(chan error, publishers)
	var group sync.WaitGroup

	for index := 0; index < publishers; index++ {
		group.Add(1)
		go func(value int64) {
			defer group.Done()
			<-start
			errorsCh <- writeHeartbeat(stateDir, WorkerRetention, workerSnapshot{LastDeleted: value})
		}(int64(index))
	}
	close(start)
	group.Wait()
	close(errorsCh)
	for err := range errorsCh {
		if err != nil {
			t.Fatal(err)
		}
	}
	content, err := os.ReadFile(HeartbeatPath(stateDir, WorkerRetention))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), `"worker":"retention"`) {
		t.Fatalf("heartbeat = %s", content)
	}
}

func TestPrepareWorkerStateRemovesPersistedHeartbeat(t *testing.T) {
	stateDir := t.TempDir()
	if err := writeHeartbeat(stateDir, WorkerForwarding, workerSnapshot{Running: true}); err != nil {
		t.Fatal(err)
	}
	if err := prepareWorkerState(stateDir, WorkerForwarding); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(HeartbeatPath(stateDir, WorkerForwarding)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("persisted heartbeat still exists: %v", err)
	}
}

func waitForWorkerHeartbeatContains(t *testing.T, stateDir, worker, expected string, timeout time.Duration) []byte {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var last []byte
	for time.Now().Before(deadline) {
		content, err := os.ReadFile(HeartbeatPath(stateDir, worker))
		if err == nil {
			last = content
			if strings.Contains(string(content), expected) {
				return content
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("heartbeat did not contain %q; last=%s", expected, last)
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
