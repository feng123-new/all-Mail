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
		UpdatedAt time.Time `json:"updatedAt"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return fmt.Errorf("decode Go jobs heartbeat: %w", err)
	}
	if payload.UpdatedAt.IsZero() {
		return fmt.Errorf("Go jobs heartbeat has no timestamp")
	}
	if age := time.Since(payload.UpdatedAt); age > cfg.JobsHeartbeatMaxAge {
		return fmt.Errorf("Go jobs heartbeat is stale: %s", age.Round(time.Second))
	}
	return nil
}
