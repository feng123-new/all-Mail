package doctor

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestJobsRejectsFailedEnabledWorker(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{
        "runtime": "go-jobs-runtime",
        "pid": 123,
        "updatedAt": %q,
        "workers": {
            "apiLogRetention": {
                "enabled": true,
                "lastRunAt": %q,
                "lastCompletedAt": %q,
                "consecutiveFailures": 1,
                "lastError": "database unavailable"
            }
        }
    }`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{StateDir: stateDir, JobsHeartbeatMaxAge: time.Minute}
	if err := Jobs(cfg); err == nil {
		t.Fatal("Jobs expected an error")
	}
}

func TestJobsAcceptsHealthyWorker(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{
        "runtime": "go-jobs-runtime",
        "pid": 123,
        "updatedAt": %q,
        "workers": {
            "apiLogRetention": {
                "enabled": true,
                "running": false,
                "lastRunAt": %q,
                "lastCompletedAt": %q,
                "lastSuccessAt": %q
            }
        }
    }`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{StateDir: stateDir, JobsHeartbeatMaxAge: time.Minute}
	if err := Jobs(cfg); err != nil {
		t.Fatalf("Jobs error = %v", err)
	}
}

func TestJobsRejectsForwardingRunPastItsDeadline(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	startedAt := now.Add(-2 * time.Minute)
	payload := fmt.Sprintf(`{
        "runtime": "go-jobs-runtime",
        "pid": 123,
        "updatedAt": %q,
        "workers": {
            "forwarding": {
                "enabled": true,
                "running": true,
                "startedAt": %q,
                "lastRunAt": %q
            }
        }
    }`, now.Format(time.RFC3339Nano), startedAt.Format(time.RFC3339Nano), startedAt.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:             stateDir,
		JobsHeartbeatMaxAge:  time.Minute,
		ForwardingRunTimeout: 30 * time.Second,
		APILogCleanupTimeout: time.Minute,
	}
	err := Jobs(cfg)
	if err == nil || !strings.Contains(err.Error(), "exceeded its run limit") {
		t.Fatalf("Jobs error = %v, want run limit error", err)
	}
}

func TestJobsRejectsInvalidRuntimeIdentity(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{"updatedAt":%q,"workers":{"forwarding":{"enabled":false}}}`, now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{StateDir: stateDir, JobsHeartbeatMaxAge: time.Minute}
	if err := Jobs(cfg); err == nil {
		t.Fatal("Jobs expected invalid identity error")
	}
}
