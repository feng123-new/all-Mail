package doctor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"syscall"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/jobs"
)

const heartbeatFutureSkew = 5 * time.Second

func API(ctx context.Context, cfg config.APIConfig) error {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		fmt.Sprintf("http://127.0.0.1:%d/readyz", cfg.Port),
		nil,
	)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("API readiness request failed: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 32*1024))
	if err != nil {
		return fmt.Errorf("read API readiness response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("API readiness returned %d: %s", response.StatusCode, string(body))
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("decode API readiness response: %w", err)
	}
	if !envelope.Success || envelope.Data.Status != "ready" {
		return fmt.Errorf("API readiness reported status %q", envelope.Data.Status)
	}
	return nil
}

func Forwarding(cfg config.ForwardingConfig) error {
	return worker(cfg.StateDir, jobs.WorkerForwarding, cfg.HeartbeatMaxAge, cfg.RunTimeout)
}

func Retention(cfg config.RetentionConfig) error {
	return worker(cfg.StateDir, jobs.WorkerRetention, cfg.HeartbeatMaxAge, cfg.RunTimeout)
}

func worker(stateDir, expectedWorker string, maxAge, runLimit time.Duration) error {
	content, err := os.ReadFile(jobs.HeartbeatPath(stateDir, expectedWorker))
	if err != nil {
		return fmt.Errorf("read Go %s worker heartbeat: %w", expectedWorker, err)
	}
	var payload struct {
		Runtime   string    `json:"runtime"`
		Worker    string    `json:"worker"`
		PID       int       `json:"pid"`
		UpdatedAt time.Time `json:"updatedAt"`
		State     struct {
			Running             bool       `json:"running"`
			StartedAt           *time.Time `json:"startedAt"`
			LastRunAt           *time.Time `json:"lastRunAt"`
			LastCompletedAt     *time.Time `json:"lastCompletedAt"`
			LastSuccessAt       *time.Time `json:"lastSuccessAt"`
			ConsecutiveFailures int        `json:"consecutiveFailures"`
			LastError           string     `json:"lastError"`
		} `json:"state"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return fmt.Errorf("decode Go %s worker heartbeat: %w", expectedWorker, err)
	}
	if payload.Runtime != "allmail-worker-"+expectedWorker || payload.Worker != expectedWorker || payload.PID <= 0 {
		return fmt.Errorf("Go %s worker heartbeat has invalid runtime identity", expectedWorker)
	}
	process, err := os.FindProcess(payload.PID)
	if err != nil {
		return fmt.Errorf("find Go %s worker process %d: %w", expectedWorker, payload.PID, err)
	}
	if err := process.Signal(syscall.Signal(0)); err != nil && !errors.Is(err, syscall.EPERM) {
		return fmt.Errorf("Go %s worker heartbeat process is not running: pid %d", expectedWorker, payload.PID)
	}
	if payload.UpdatedAt.IsZero() {
		return fmt.Errorf("Go %s worker heartbeat has no timestamp", expectedWorker)
	}
	now := time.Now()
	if payload.UpdatedAt.After(now.Add(heartbeatFutureSkew)) {
		return fmt.Errorf("Go %s worker heartbeat timestamp is in the future", expectedWorker)
	}
	if maxAge <= 0 {
		return fmt.Errorf("Go %s worker heartbeat max age is not configured", expectedWorker)
	}
	if age := now.Sub(payload.UpdatedAt); age > maxAge {
		return fmt.Errorf("Go %s worker heartbeat is stale: %s", expectedWorker, age.Round(time.Second))
	}
	for label, timestamp := range map[string]*time.Time{
		"startedAt":       payload.State.StartedAt,
		"lastRunAt":       payload.State.LastRunAt,
		"lastCompletedAt": payload.State.LastCompletedAt,
		"lastSuccessAt":   payload.State.LastSuccessAt,
	} {
		if timestamp != nil && timestamp.After(now.Add(heartbeatFutureSkew)) {
			return fmt.Errorf("Go %s worker %s is in the future", expectedWorker, label)
		}
	}
	if payload.State.Running {
		if payload.State.StartedAt == nil {
			return fmt.Errorf("Go %s worker is running without a start timestamp", expectedWorker)
		}
		if runLimit > 0 && now.Sub(*payload.State.StartedAt) > runLimit+heartbeatFutureSkew {
			return fmt.Errorf(
				"Go %s worker has exceeded its run limit: %s",
				expectedWorker,
				now.Sub(*payload.State.StartedAt).Round(time.Second),
			)
		}
	}
	if payload.State.LastError != "" && (payload.State.LastSuccessAt == nil ||
		(payload.State.LastCompletedAt != nil && payload.State.LastCompletedAt.After(*payload.State.LastSuccessAt))) {
		return fmt.Errorf("Go %s worker is unhealthy: %s", expectedWorker, payload.State.LastError)
	}
	return nil
}
