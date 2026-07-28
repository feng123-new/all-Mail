package doctor

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestJobsRejectsFailedEnabledWorker(t *testing.T) {
	stateDir := t.TempDir()
	now := time.Now().UTC()
	payload := fmt.Sprintf(`{
        "updatedAt": %q,
        "workers": {
            "apiLogRetention": {
                "enabled": true,
                "lastRunAt": %q,
                "lastError": "database unavailable"
            }
        }
    }`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
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
        "updatedAt": %q,
        "workers": {
            "apiLogRetention": {
                "enabled": true,
                "lastRunAt": %q,
                "lastSuccessAt": %q
            }
        }
    }`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(stateDir, "go-jobs-heartbeat.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{StateDir: stateDir, JobsHeartbeatMaxAge: time.Minute}
	if err := Jobs(cfg); err != nil {
		t.Fatalf("Jobs error = %v", err)
	}
}
