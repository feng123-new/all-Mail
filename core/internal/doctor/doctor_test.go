package doctor

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/jobs"
)

func writeWorkerHeartbeat(t *testing.T, stateDir, workerName, stateJSON string, updatedAt time.Time, pid int) {
	t.Helper()
	payload := fmt.Sprintf(`{
        "runtime": "allmail-worker-%s",
        "worker": %q,
        "pid": %d,
        "updatedAt": %q,
        "state": %s
    }`, workerName, workerName, pid, updatedAt.Format(time.RFC3339Nano), stateJSON)
	if err := os.WriteFile(jobs.HeartbeatPath(stateDir, workerName), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestForwardingAcceptsHealthyWorker(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	writeWorkerHeartbeat(
		t,
		stateDir,
		jobs.WorkerForwarding,
		fmt.Sprintf(`{"lastRunAt":%q,"lastCompletedAt":%q,"lastSuccessAt":%q}`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)),
		now,
		os.Getpid(),
	)
	cfg := config.ForwardingConfig{
		StateDir:        stateDir,
		HeartbeatMaxAge: time.Minute,
		RunTimeout:      time.Minute,
	}
	if err := Forwarding(cfg); err != nil {
		t.Fatalf("Forwarding doctor error = %v", err)
	}
}

func TestRetentionRejectsLatestFailedRun(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	writeWorkerHeartbeat(
		t,
		stateDir,
		jobs.WorkerRetention,
		fmt.Sprintf(`{"lastRunAt":%q,"lastCompletedAt":%q,"consecutiveFailures":1,"lastError":"database unavailable"}`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)),
		now,
		os.Getpid(),
	)
	cfg := config.RetentionConfig{
		StateDir:        stateDir,
		HeartbeatMaxAge: time.Minute,
		RunTimeout:      time.Minute,
	}
	err := Retention(cfg)
	if err == nil || !strings.Contains(err.Error(), "database unavailable") {
		t.Fatalf("Retention doctor error = %v, want worker failure", err)
	}
}

func TestForwardingRejectsRunPastDeadline(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	startedAt := now.Add(-2 * time.Minute)
	writeWorkerHeartbeat(
		t,
		stateDir,
		jobs.WorkerForwarding,
		fmt.Sprintf(`{"running":true,"startedAt":%q,"lastRunAt":%q}`, startedAt.Format(time.RFC3339Nano), startedAt.Format(time.RFC3339Nano)),
		now,
		os.Getpid(),
	)
	cfg := config.ForwardingConfig{
		StateDir:        stateDir,
		HeartbeatMaxAge: time.Minute,
		RunTimeout:      30 * time.Second,
	}
	err := Forwarding(cfg)
	if err == nil || !strings.Contains(err.Error(), "exceeded its run limit") {
		t.Fatalf("Forwarding doctor error = %v, want run limit error", err)
	}
}

func TestWorkerRejectsInvalidIdentity(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{"runtime":"wrong","worker":"forwarding","pid":%d,"updatedAt":%q,"state":{}}`, os.Getpid(), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(jobs.HeartbeatPath(stateDir, jobs.WorkerForwarding), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.ForwardingConfig{StateDir: stateDir, HeartbeatMaxAge: time.Minute, RunTimeout: time.Minute}
	if err := Forwarding(cfg); err == nil || !strings.Contains(err.Error(), "invalid runtime identity") {
		t.Fatalf("Forwarding doctor error = %v, want identity error", err)
	}
}

func TestWorkerRejectsFutureHeartbeat(t *testing.T) {
	stateDir := t.TempDir()
	future := time.Now().UTC().Add(time.Hour)
	writeWorkerHeartbeat(t, stateDir, jobs.WorkerRetention, `{}`, future, os.Getpid())
	cfg := config.RetentionConfig{StateDir: stateDir, HeartbeatMaxAge: time.Minute, RunTimeout: time.Minute}
	if err := Retention(cfg); err == nil || !strings.Contains(err.Error(), "timestamp is in the future") {
		t.Fatalf("Retention doctor error = %v, want future timestamp error", err)
	}
}
