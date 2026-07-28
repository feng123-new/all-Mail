package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"github.com/feng123-new/all-Mail/core/internal/provider"
)

type workerHeartbeat struct {
	Enabled       bool       `json:"enabled"`
	LastRunAt     *time.Time `json:"lastRunAt,omitempty"`
	LastSuccessAt *time.Time `json:"lastSuccessAt,omitempty"`
	LastDeleted   int64      `json:"lastDeleted,omitempty"`
	LastError     string     `json:"lastError,omitempty"`
}

type heartbeat struct {
	Runtime   string                     `json:"runtime"`
	PID       int                        `json:"pid"`
	UpdatedAt time.Time                  `json:"updatedAt"`
	Workers   map[string]workerHeartbeat `json:"workers"`
}

type runtimeState struct {
	mu        sync.RWMutex
	retention workerHeartbeat
}

func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	var cleaner RetentionCleaner
	if cfg.LogRetentionOwner == config.RuntimeOwnerGo {
		var err error
		cleaner, err = newRetentionCleaner(cfg)
		if err != nil {
			return err
		}
	}
	return run(ctx, cfg, logger, cleaner)
}

func run(ctx context.Context, cfg config.Config, logger *slog.Logger, cleaner RetentionCleaner) error {
	if err := os.MkdirAll(cfg.StateDir, 0o700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	state := &runtimeState{}
	state.retention.Enabled = cleaner != nil

	logger.Info(
		"Go jobs runtime started",
		"heartbeat_interval", cfg.JobsHeartbeatInterval,
		"api_log_retention_owner", cfg.LogRetentionOwner,
		"api_log_cleanup_interval", cfg.APILogCleanupInterval,
		"api_log_cleanup_retry", cfg.APILogCleanupRetry,
		"api_log_cleanup_timeout", cfg.APILogCleanupTimeout,
	)
	if err := writeHeartbeat(cfg.StateDir, state.snapshot()); err != nil {
		return err
	}

	workerDone := make(chan struct{})
	if cleaner != nil {
		go func() {
			defer close(workerDone)
			runRetentionLoop(ctx, cfg, logger, cleaner, state)
		}()
	} else {
		close(workerDone)
	}

	ticker := time.NewTicker(cfg.JobsHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			<-workerDone
			logger.Info("Go jobs runtime stopped")
			return nil
		case <-ticker.C:
			if err := writeHeartbeat(cfg.StateDir, state.snapshot()); err != nil {
				logger.Error("failed to write jobs heartbeat", "error", err)
			}
		}
	}
}

func runRetentionLoop(
	ctx context.Context,
	cfg config.Config,
	logger *slog.Logger,
	cleaner RetentionCleaner,
	state *runtimeState,
) {
	delay := time.Duration(0)
	timer := time.NewTimer(delay)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			startedAt := time.Now().UTC()
			state.markRetentionStarted(startedAt)

			cleanupCtx, cancel := context.WithTimeout(ctx, cfg.APILogCleanupTimeout)
			deleted, err := cleaner.Cleanup(cleanupCtx)
			cancel()
			finishedAt := time.Now().UTC()

			if err != nil {
				if ctx.Err() != nil && errors.Is(err, context.Canceled) {
					return
				}
				state.markRetentionFailed(finishedAt, err)
				logger.Error(
					"Go API log retention cleanup failed",
					"error", err,
					"retry_after", cfg.APILogCleanupRetry,
				)
				delay = cfg.APILogCleanupRetry
			} else {
				state.markRetentionSucceeded(finishedAt, deleted)
				logger.Info(
					"Go API log retention cleanup completed",
					"deleted", deleted,
					"retention_days", cfg.APILogRetentionDays,
					"batch_size", cfg.APILogCleanupBatch,
				)
				delay = cfg.APILogCleanupInterval
			}

			if delay <= 0 {
				delay = time.Second
			}
			timer.Reset(delay)
		}
	}
}

func (state *runtimeState) markRetentionStarted(at time.Time) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.retention.LastRunAt = &at
}

func (state *runtimeState) markRetentionSucceeded(at time.Time, deleted int64) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.retention.LastSuccessAt = &at
	state.retention.LastDeleted = deleted
	state.retention.LastError = ""
}

func (state *runtimeState) markRetentionFailed(at time.Time, err error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.retention.LastRunAt = &at
	state.retention.LastError = err.Error()
}

func (state *runtimeState) snapshot() map[string]workerHeartbeat {
	state.mu.RLock()
	defer state.mu.RUnlock()
	return map[string]workerHeartbeat{
		"apiLogRetention": state.retention,
	}
}

func HeartbeatPath(stateDir string) string {
	return filepath.Join(stateDir, "go-jobs-heartbeat.json")
}

func writeHeartbeat(stateDir string, workers map[string]workerHeartbeat) error {
	payload, err := json.Marshal(heartbeat{
		Runtime:   "go-jobs-runtime",
		PID:       os.Getpid(),
		UpdatedAt: time.Now().UTC(),
		Workers:   workers,
	})
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
