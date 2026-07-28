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
	mu         sync.RWMutex
	retention  workerHeartbeat
	forwarding workerHeartbeat
}

type forwardingRunner interface {
	runOnce(context.Context, time.Time) error
}

var errForwardingOwnerLockLost = errors.New("forwarding owner lock connection lost")

func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	var cleaner RetentionCleaner
	if cfg.LogRetentionOwner == config.RuntimeOwnerGo {
		var err error
		cleaner, err = newRetentionCleaner(cfg)
		if err != nil {
			return err
		}
	}

	var forwarder forwardingRunner
	var checkForwardingOwner func(context.Context) error
	var ownerLock *forwardingOwnerLock
	var forwardingStore *postgresForwardingStore
	if cfg.ForwardingWorkerOwner == "go" {
		var err error
		ownerLock, err = acquireForwardingOwner(ctx, cfg.DatabaseURL)
		if err != nil {
			return err
		}
		forwardingStore, err = newPostgresForwardingStore(ctx, cfg.DatabaseURL)
		if err != nil {
			ownerLock.Close(context.Background())
			return err
		}
		forwarder = newForwardingWorker(
			forwardingStore,
			provider.NewResendClient(cfg.ResendAPIBaseURL, nil),
			func(envelope string) (string, error) {
				return legacycrypto.Decrypt(cfg.EncryptionKey, envelope)
			},
			logger,
			cfg.ForwardingBatchSize,
		)
		checkForwardingOwner = ownerLock.Ping
		defer forwardingStore.Close()
		defer ownerLock.Close(context.Background())
	}

	return runSupervisor(ctx, cfg, logger, cleaner, forwarder, checkForwardingOwner)
}

func run(ctx context.Context, cfg config.Config, logger *slog.Logger, cleaner RetentionCleaner) error {
	return runSupervisor(ctx, cfg, logger, cleaner, nil, nil)
}

func runSupervisor(
	ctx context.Context,
	cfg config.Config,
	logger *slog.Logger,
	cleaner RetentionCleaner,
	forwarder forwardingRunner,
	checkForwardingOwner func(context.Context) error,
) error {
	if err := os.MkdirAll(cfg.StateDir, 0o700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	workerCtx, cancelWorkers := context.WithCancel(ctx)
	defer cancelWorkers()

	state := &runtimeState{}
	state.retention.Enabled = cleaner != nil
	state.forwarding.Enabled = forwarder != nil
	logger.Info(
		"Go jobs runtime started",
		"heartbeat_interval", cfg.JobsHeartbeatInterval,
		"api_log_retention_owner", cfg.LogRetentionOwner,
		"forwarding_owner", cfg.ForwardingWorkerOwner,
	)
	if err := writeHeartbeat(cfg.StateDir, state.snapshot()); err != nil {
		return err
	}
	ownerCheckTimeout := cfg.ReadyTimeout
	if ownerCheckTimeout <= 0 {
		ownerCheckTimeout = 5 * time.Second
	}
	checkOwner := func() error {
		if checkForwardingOwner == nil {
			return nil
		}
		checkCtx, cancel := context.WithTimeout(workerCtx, ownerCheckTimeout)
		defer cancel()
		if err := checkForwardingOwner(checkCtx); err != nil {
			return fmt.Errorf("%w: %v", errForwardingOwnerLockLost, err)
		}
		return nil
	}
	if err := checkOwner(); err != nil {
		state.markForwardingFailed(time.Now().UTC(), err)
		_ = writeHeartbeat(cfg.StateDir, state.snapshot())
		return err
	}

	retentionDone := make(chan struct{})
	if cleaner != nil {
		go func() {
			defer close(retentionDone)
			runRetentionLoop(workerCtx, cfg, logger, cleaner, state)
		}()
	} else {
		close(retentionDone)
	}

	heartbeatTicker := time.NewTicker(cfg.JobsHeartbeatInterval)
	defer heartbeatTicker.Stop()
	var forwardingTicker *time.Ticker
	var forwardingTicks <-chan time.Time
	if forwarder != nil {
		forwardingTicker = time.NewTicker(cfg.ForwardingInterval)
		forwardingTicks = forwardingTicker.C
		defer forwardingTicker.Stop()
	}
	var ownerCheckTicker *time.Ticker
	var ownerCheckTicks <-chan time.Time
	if checkForwardingOwner != nil {
		ownerCheckTicker = time.NewTicker(cfg.JobsHeartbeatInterval)
		ownerCheckTicks = ownerCheckTicker.C
		defer ownerCheckTicker.Stop()
	}

	forwardingResults := make(chan error, 1)
	forwardingRunning := false
	startForwarding := func(now time.Time) {
		if forwarder == nil || forwardingRunning {
			return
		}
		forwardingRunning = true
		state.markForwardingStarted(now)
		go func() {
			forwardingResults <- forwarder.runOnce(workerCtx, now)
		}()
	}
	startForwarding(time.Now().UTC())

	waitForWorkers := func() error {
		cancelWorkers()
		if forwardingRunning {
			shutdownTimeout := cfg.ShutdownTimeout
			if shutdownTimeout <= 0 {
				shutdownTimeout = 10 * time.Second
			}
			select {
			case <-forwardingResults:
			case <-time.After(shutdownTimeout):
				return fmt.Errorf("timed out waiting for forwarding run to stop")
			}
		}
		<-retentionDone
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			if err := waitForWorkers(); err != nil {
				return err
			}
			logger.Info("Go jobs runtime stopped")
			return nil
		case now := <-forwardingTicks:
			startForwarding(now.UTC())
		case <-ownerCheckTicks:
			if err := checkOwner(); err != nil {
				state.markForwardingFailed(time.Now().UTC(), err)
				_ = writeHeartbeat(cfg.StateDir, state.snapshot())
				if shutdownErr := waitForWorkers(); shutdownErr != nil {
					return errors.Join(err, shutdownErr)
				}
				return err
			}
		case err := <-forwardingResults:
			forwardingRunning = false
			finishedAt := time.Now().UTC()
			if err != nil && !errors.Is(err, context.Canceled) {
				state.markForwardingFailed(finishedAt, err)
				logger.Error("Go forwarding run failed", "error", err)
			} else {
				state.markForwardingSucceeded(finishedAt)
			}
			if err := writeHeartbeat(cfg.StateDir, state.snapshot()); err != nil {
				logger.Error("failed to write jobs heartbeat", "error", err)
			}
		case <-heartbeatTicker.C:
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
				logger.Error("Go API log retention cleanup failed", "error", err, "retry_after", cfg.APILogCleanupRetry)
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

func (state *runtimeState) markForwardingStarted(at time.Time) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.forwarding.LastRunAt = &at
}

func (state *runtimeState) markForwardingSucceeded(at time.Time) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.forwarding.LastRunAt = &at
	state.forwarding.LastSuccessAt = &at
	state.forwarding.LastError = ""
}

func (state *runtimeState) markForwardingFailed(at time.Time, err error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.forwarding.LastRunAt = &at
	state.forwarding.LastError = err.Error()
}

func (state *runtimeState) snapshot() map[string]workerHeartbeat {
	state.mu.RLock()
	defer state.mu.RUnlock()
	return map[string]workerHeartbeat{
		"apiLogRetention": state.retention,
		"forwarding":      state.forwarding,
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
