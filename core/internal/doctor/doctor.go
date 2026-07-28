package doctor

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/jobs"
)

func API(ctx context.Context, cfg config.Config) error {
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

func Jobs(cfg config.Config) error {
	content, err := os.ReadFile(jobs.HeartbeatPath(cfg.StateDir))
	if err != nil {
		return fmt.Errorf("read Go jobs heartbeat: %w", err)
	}
	var payload struct {
		Runtime   string    `json:"runtime"`
		PID       int       `json:"pid"`
		UpdatedAt time.Time `json:"updatedAt"`
		Workers   map[string]struct {
			Enabled             bool       `json:"enabled"`
			Running             bool       `json:"running"`
			StartedAt           *time.Time `json:"startedAt"`
			LastRunAt           *time.Time `json:"lastRunAt"`
			LastCompletedAt     *time.Time `json:"lastCompletedAt"`
			LastSuccessAt       *time.Time `json:"lastSuccessAt"`
			ConsecutiveFailures int        `json:"consecutiveFailures"`
			LastError           string     `json:"lastError"`
		} `json:"workers"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return fmt.Errorf("decode Go jobs heartbeat: %w", err)
	}
	if payload.Runtime != "go-jobs-runtime" || payload.PID <= 0 {
		return fmt.Errorf("Go jobs heartbeat has invalid runtime identity")
	}
	if payload.UpdatedAt.IsZero() {
		return fmt.Errorf("Go jobs heartbeat has no timestamp")
	}
	if age := time.Since(payload.UpdatedAt); age > cfg.JobsHeartbeatMaxAge {
		return fmt.Errorf("Go jobs heartbeat is stale: %s", age.Round(time.Second))
	}
	if len(payload.Workers) == 0 {
		return fmt.Errorf("Go jobs heartbeat has no worker state")
	}

	for name, worker := range payload.Workers {
		if !worker.Enabled {
			continue
		}
		if worker.Running {
			if worker.StartedAt == nil {
				return fmt.Errorf("Go jobs worker %s is running without a start timestamp", name)
			}
			limit := workerRunLimit(name, cfg)
			if limit > 0 && time.Since(*worker.StartedAt) > limit {
				return fmt.Errorf(
					"Go jobs worker %s has exceeded its run limit: %s",
					name,
					time.Since(*worker.StartedAt).Round(time.Second),
				)
			}
		}
		if worker.LastError == "" {
			continue
		}
		if worker.LastSuccessAt == nil || (worker.LastRunAt != nil && worker.LastRunAt.After(*worker.LastSuccessAt)) {
			return fmt.Errorf("Go jobs worker %s is unhealthy: %s", name, worker.LastError)
		}
	}
	return nil
}

func workerRunLimit(name string, cfg config.Config) time.Duration {
	switch name {
	case "forwarding":
		return cfg.ForwardingRunTimeout
	case "apiLogRetention":
		return cfg.APILogCleanupTimeout
	default:
		return 0
	}
}
