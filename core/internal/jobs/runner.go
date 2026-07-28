package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

type heartbeat struct {
	Runtime   string    `json:"runtime"`
	PID       int       `json:"pid"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	if err := os.MkdirAll(cfg.StateDir, 0o700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	logger.Info("Go jobs supervisor started", "heartbeat_interval", cfg.JobsHeartbeatInterval)
	if err := writeHeartbeat(cfg.StateDir); err != nil {
		return err
	}

	ticker := time.NewTicker(cfg.JobsHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logger.Info("Go jobs supervisor stopped")
			return nil
		case <-ticker.C:
			if err := writeHeartbeat(cfg.StateDir); err != nil {
				logger.Error("failed to write jobs heartbeat", "error", err)
			}
		}
	}
}

func HeartbeatPath(stateDir string) string {
	return filepath.Join(stateDir, "go-jobs-heartbeat.json")
}

func writeHeartbeat(stateDir string) error {
	payload, err := json.Marshal(heartbeat{Runtime: "go-jobs-supervisor", PID: os.Getpid(), UpdatedAt: time.Now().UTC()})
	if err != nil {
		return err
	}
	target := HeartbeatPath(stateDir)
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, payload, 0o600); err != nil {
		return fmt.Errorf("write heartbeat: %w", err)
	}
	if err := os.Rename(temporary, target); err != nil {
		return fmt.Errorf("publish heartbeat: %w", err)
	}
	return nil
}
