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
		"pid": %d,
        "updatedAt": %q,
        "workers": {
            "apiLogRetention": {
                "enabled": true,
                "lastRunAt": %q,
                "lastCompletedAt": %q,
                "consecutiveFailures": 1,
                "lastError": "database unavailable"
            },
            "forwarding": {"enabled": false}
        }
    }`, os.Getpid(), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerGo,
		ForwardingWorkerOwner: config.RuntimeOwnerLegacy,
	}
	if err := Jobs(cfg); err == nil {
		t.Fatal("Jobs expected an error")
	}
}

func TestJobsAcceptsHealthyWorker(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{
        "runtime": "go-jobs-runtime",
		"pid": %d,
        "updatedAt": %q,
        "workers": {
            "apiLogRetention": {
                "enabled": true,
                "running": false,
                "lastRunAt": %q,
                "lastCompletedAt": %q,
                "lastSuccessAt": %q
            },
            "forwarding": {"enabled": false}
        }
    }`, os.Getpid(), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerGo,
		ForwardingWorkerOwner: config.RuntimeOwnerLegacy,
	}
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
		"pid": %d,
        "updatedAt": %q,
        "workers": {
            "apiLogRetention": {"enabled": false},
            "forwarding": {
                "enabled": true,
                "running": true,
                "startedAt": %q,
                "lastRunAt": %q
            }
        }
	}`, os.Getpid(), now.Format(time.RFC3339Nano), startedAt.Format(time.RFC3339Nano), startedAt.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		ForwardingRunTimeout:  30 * time.Second,
		APILogCleanupTimeout:  time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerLegacy,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
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

func TestJobsRejectsMissingConfiguredWorker(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{
		"runtime": "go-jobs-runtime",
		"pid": %d,
		"updatedAt": %q,
		"workers": {
			"apiLogRetention": {"enabled": true}
		}
	}`, os.Getpid(), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerGo,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
	}
	err := Jobs(cfg)
	if err == nil || !strings.Contains(err.Error(), "missing forwarding worker state") {
		t.Fatalf("Jobs error = %v, want missing forwarding worker state", err)
	}
}

func TestJobsRejectsWorkerEnablementThatDoesNotMatchOwnership(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{
		"runtime": "go-jobs-runtime",
		"pid": %d,
		"updatedAt": %q,
		"workers": {
			"apiLogRetention": {"enabled": false},
			"forwarding": {"enabled": false}
		}
	}`, os.Getpid(), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerLegacy,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
	}
	err := Jobs(cfg)
	if err == nil || !strings.Contains(err.Error(), "forwarding enablement") {
		t.Fatalf("Jobs error = %v, want forwarding enablement mismatch", err)
	}
}

func TestJobsRejectsHeartbeatFromDeadProcess(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{
		"runtime": "go-jobs-runtime",
		"pid": 1073741824,
		"updatedAt": %q,
		"workers": {
			"apiLogRetention": {"enabled": false},
			"forwarding": {"enabled": false}
		}
	}`, now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerLegacy,
		ForwardingWorkerOwner: config.RuntimeOwnerLegacy,
	}
	err := Jobs(cfg)
	if err == nil || !strings.Contains(err.Error(), "process is not running") {
		t.Fatalf("Jobs error = %v, want dead process error", err)
	}
}

func TestJobsRejectsFutureHeartbeatTimestamp(t *testing.T) {
	stateDir := t.TempDir()
	future := time.Now().UTC().Add(time.Hour)
	payload := fmt.Sprintf(`{
		"runtime": "go-jobs-runtime",
		"pid": %d,
		"updatedAt": %q,
		"workers": {
			"apiLogRetention": {"enabled": false},
			"forwarding": {"enabled": false}
		}
	}`, os.Getpid(), future.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerLegacy,
		ForwardingWorkerOwner: config.RuntimeOwnerLegacy,
	}
	err := Jobs(cfg)
	if err == nil || !strings.Contains(err.Error(), "timestamp is in the future") {
		t.Fatalf("Jobs error = %v, want future timestamp error", err)
	}
}

func TestJobsRejectsFutureWorkerTimestamp(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	future := now.Add(time.Hour)
	payload := fmt.Sprintf(`{
		"runtime": "go-jobs-runtime",
		"pid": %d,
		"updatedAt": %q,
		"workers": {
			"apiLogRetention": {"enabled": false},
			"forwarding": {
				"enabled": true,
				"running": true,
				"startedAt": %q
			}
		}
	}`, os.Getpid(), now.Format(time.RFC3339Nano), future.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		StateDir:              stateDir,
		JobsHeartbeatMaxAge:   time.Minute,
		ForwardingRunTimeout:  time.Minute,
		LogRetentionOwner:     config.RuntimeOwnerLegacy,
		ForwardingWorkerOwner: config.RuntimeOwnerGo,
	}
	err := Jobs(cfg)
	if err == nil || !strings.Contains(err.Error(), "startedAt is in the future") {
		t.Fatalf("Jobs error = %v, want future worker timestamp error", err)
	}
}
