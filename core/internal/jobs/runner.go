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

const (
	WorkerForwarding = "forwarding"
	WorkerRetention  = "retention"
)

type workerSnapshot struct {
	Running             bool       `json:"running"`
	StartedAt           *time.Time `json:"startedAt,omitempty"`
	LastRunAt           *time.Time `json:"lastRunAt,omitempty"`
	LastCompletedAt     *time.Time `json:"lastCompletedAt,omitempty"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt,omitempty"`
	LastDeleted         int64      `json:"lastDeleted,omitempty"`
	ConsecutiveFailures int        `json:"consecutiveFailures,omitempty"`
	LastError           string     `json:"lastError,omitempty"`
}

type heartbeat struct {
	Runtime   string         `json:"runtime"`
	Worker    string         `json:"worker"`
	PID       int            `json:"pid"`
	UpdatedAt time.Time      `json:"updatedAt"`
	State     workerSnapshot `json:"state"`
}

type workerState struct {
	mu       sync.RWMutex
	snapshot workerSnapshot
}

type runOutcome struct {
	deleted int64
	err     error
}

type runtimeConfig struct {
	name              string
	stateDir          string
	interval          time.Duration
	retry             time.Duration
	runTimeout        time.Duration
	heartbeatInterval time.Duration
	shutdownTimeout   time.Duration
	healthTimeout     time.Duration
	runOnce           func(context.Context, time.Time) (int64, error)
	healthCheck       func(context.Context) error
}

var errForwardingOwnerLockLost = errors.New("forwarding owner lock connection lost")

func RunForwarding(ctx context.Context, cfg config.ForwardingConfig, logger *slog.Logger) error {
	if err := prepareWorkerState(cfg.StateDir, WorkerForwarding); err != nil {
		return err
	}
	ownerLock, err := acquireForwardingOwner(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer ownerLock.Close(context.Background())

	store, err := newPostgresForwardingStore(ctx, cfg.DatabaseURL, cfg.LeaseDuration)
	if err != nil {
		return err
	}
	defer store.Close()

	worker := newForwardingWorker(
		store,
		provider.NewResendClient(cfg.ResendAPIBaseURL, nil),
		func(envelope string) (string, error) {
			return legacycrypto.Decrypt(cfg.EncryptionKey, envelope)
		},
		logger,
		cfg.BatchSize,
	)

	return runWorker(ctx, runtimeConfig{
		name:              WorkerForwarding,
		stateDir:          cfg.StateDir,
		interval:          cfg.Interval,
		retry:             cfg.Interval,
		runTimeout:        cfg.RunTimeout,
		heartbeatInterval: cfg.HeartbeatInterval,
		shutdownTimeout:   cfg.ShutdownTimeout,
		healthTimeout:     cfg.ReadyTimeout,
		runOnce: func(runCtx context.Context, now time.Time) (int64, error) {
			return 0, worker.runOnce(runCtx, now)
		},
		healthCheck: func(checkCtx context.Context) error {
			if err := ownerLock.Ping(checkCtx); err != nil {
				return fmt.Errorf("%w: %v", errForwardingOwnerLockLost, err)
			}
			return nil
		},
	}, logger)
}

func RunRetention(ctx context.Context, cfg config.RetentionConfig, logger *slog.Logger) error {
	if err := prepareWorkerState(cfg.StateDir, WorkerRetention); err != nil {
		return err
	}
	cleaner, err := newRetentionCleaner(ctx, cfg)
	if err != nil {
		return err
	}
	defer cleaner.Close()
	return runWorker(ctx, runtimeConfig{
		name:              WorkerRetention,
		stateDir:          cfg.StateDir,
		interval:          cfg.Interval,
		retry:             cfg.Retry,
		runTimeout:        cfg.RunTimeout,
		heartbeatInterval: cfg.HeartbeatInterval,
		shutdownTimeout:   cfg.ShutdownTimeout,
		healthTimeout:     cfg.ReadyTimeout,
		runOnce: func(runCtx context.Context, _ time.Time) (int64, error) {
			return cleaner.Cleanup(runCtx)
		},
		healthCheck: cleaner.Ping,
	}, logger)
}

func runWorker(ctx context.Context, cfg runtimeConfig, logger *slog.Logger) error {
	if err := os.MkdirAll(cfg.stateDir, 0o700); err != nil {
		return fmt.Errorf("create worker state directory: %w", err)
	}
	if cfg.interval <= 0 || cfg.retry <= 0 || cfg.runTimeout <= 0 || cfg.heartbeatInterval <= 0 || cfg.shutdownTimeout <= 0 {
		return fmt.Errorf("worker %s has invalid non-positive runtime duration", cfg.name)
	}
	if cfg.healthTimeout <= 0 {
		cfg.healthTimeout = 5 * time.Second
	}

	state := &workerState{}
	if err := writeHeartbeat(cfg.stateDir, cfg.name, state.current()); err != nil {
		return err
	}
	logger.Info(
		"Go worker runtime started",
		"worker", cfg.name,
		"interval", cfg.interval,
		"run_timeout", cfg.runTimeout,
		"heartbeat_interval", cfg.heartbeatInterval,
	)

	timer := time.NewTimer(0)
	defer timer.Stop()
	heartbeatTicker := time.NewTicker(cfg.heartbeatInterval)
	defer heartbeatTicker.Stop()

	var healthTicker *time.Ticker
	var healthTicks <-chan time.Time
	if cfg.healthCheck != nil {
		healthTicker = time.NewTicker(cfg.heartbeatInterval)
		healthTicks = healthTicker.C
		defer healthTicker.Stop()
	}

	results := make(chan runOutcome, 1)
	var activeCancel context.CancelFunc
	running := false

	startRun := func() {
		if running {
			return
		}
		now := time.Now().UTC()
		running = true
		state.markStarted(now)
		if err := writeHeartbeat(cfg.stateDir, cfg.name, state.current()); err != nil {
			logger.Error("failed to publish worker start heartbeat", "worker", cfg.name, "error", err)
		}
		runCtx, cancel := context.WithTimeout(ctx, cfg.runTimeout)
		activeCancel = cancel
		go func(startedAt time.Time) {
			deleted, err := cfg.runOnce(runCtx, startedAt)
			results <- runOutcome{deleted: deleted, err: err}
		}(now)
	}

	resetTimer := func(delay time.Duration) {
		if delay <= 0 {
			delay = time.Second
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(delay)
	}

	finishRun := func(outcome runOutcome, terminalErr error, schedule bool) {
		if activeCancel != nil {
			activeCancel()
			activeCancel = nil
		}
		running = false
		finishedAt := time.Now().UTC()
		switch {
		case terminalErr != nil:
			state.markFailed(finishedAt, terminalErr)
		case outcome.err != nil && ctx.Err() != nil && errors.Is(outcome.err, context.Canceled):
			state.markStopped(finishedAt)
		case outcome.err != nil:
			state.markFailed(finishedAt, outcome.err)
			logger.Error("Go worker run failed", "worker", cfg.name, "error", outcome.err, "retry_after", cfg.retry)
			if schedule {
				resetTimer(cfg.retry)
			}
		default:
			state.markSucceeded(finishedAt, outcome.deleted)
			logger.Info("Go worker run completed", "worker", cfg.name, "deleted", outcome.deleted)
			if schedule {
				resetTimer(cfg.interval)
			}
		}
		if err := writeHeartbeat(cfg.stateDir, cfg.name, state.current()); err != nil {
			logger.Error("failed to write worker heartbeat", "worker", cfg.name, "error", err)
		}
	}

	waitForActive := func(terminalErr error) error {
		if !running {
			if terminalErr != nil {
				finishRun(runOutcome{}, terminalErr, false)
			}
			return nil
		}
		if activeCancel != nil {
			activeCancel()
		}
		select {
		case outcome := <-results:
			finishRun(outcome, terminalErr, false)
			return nil
		case <-time.After(cfg.shutdownTimeout):
			timeoutErr := fmt.Errorf("timed out waiting for %s worker run to stop", cfg.name)
			stateErr := error(timeoutErr)
			if terminalErr != nil {
				stateErr = errors.Join(terminalErr, timeoutErr)
			}
			finishRun(runOutcome{}, stateErr, false)
			return timeoutErr
		}
	}

	checkHealth := func() error {
		if cfg.healthCheck == nil {
			return nil
		}
		checkCtx, cancel := context.WithTimeout(ctx, cfg.healthTimeout)
		defer cancel()
		return cfg.healthCheck(checkCtx)
	}

	if err := checkHealth(); err != nil {
		state.markFailed(time.Now().UTC(), err)
		_ = writeHeartbeat(cfg.stateDir, cfg.name, state.current())
		return err
	}

	for {
		select {
		case <-ctx.Done():
			if err := waitForActive(nil); err != nil {
				return err
			}
			logger.Info("Go worker runtime stopped", "worker", cfg.name)
			return nil
		case <-timer.C:
			startRun()
		case <-healthTicks:
			if err := checkHealth(); err != nil {
				if shutdownErr := waitForActive(err); shutdownErr != nil {
					return errors.Join(err, shutdownErr)
				}
				return err
			}
		case outcome := <-results:
			finishRun(outcome, nil, true)
		case <-heartbeatTicker.C:
			if err := writeHeartbeat(cfg.stateDir, cfg.name, state.current()); err != nil {
				logger.Error("failed to write worker heartbeat", "worker", cfg.name, "error", err)
			}
		}
	}
}

func (state *workerState) markStarted(at time.Time) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.snapshot.Running = true
	state.snapshot.StartedAt = &at
	state.snapshot.LastRunAt = &at
}

func (state *workerState) markSucceeded(at time.Time, deleted int64) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.snapshot.Running = false
	state.snapshot.StartedAt = nil
	state.snapshot.LastCompletedAt = &at
	state.snapshot.LastSuccessAt = &at
	state.snapshot.LastDeleted = deleted
	state.snapshot.ConsecutiveFailures = 0
	state.snapshot.LastError = ""
}

func (state *workerState) markFailed(at time.Time, err error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.snapshot.Running = false
	state.snapshot.StartedAt = nil
	state.snapshot.LastCompletedAt = &at
	state.snapshot.ConsecutiveFailures++
	state.snapshot.LastError = err.Error()
}

func (state *workerState) markStopped(at time.Time) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.snapshot.Running = false
	state.snapshot.StartedAt = nil
	state.snapshot.LastCompletedAt = &at
}

func (state *workerState) current() workerSnapshot {
	state.mu.RLock()
	defer state.mu.RUnlock()
	return state.snapshot
}

func HeartbeatPath(stateDir, worker string) string {
	return filepath.Join(stateDir, "worker-"+worker+"-heartbeat.json")
}

func prepareWorkerState(stateDir, worker string) error {
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return fmt.Errorf("create %s worker state directory: %w", worker, err)
	}
	if err := os.Remove(HeartbeatPath(stateDir, worker)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove persisted %s worker heartbeat: %w", worker, err)
	}
	return nil
}

func writeHeartbeat(stateDir, worker string, state workerSnapshot) error {
	payload, err := json.Marshal(heartbeat{
		Runtime:   "allmail-worker-" + worker,
		Worker:    worker,
		PID:       os.Getpid(),
		UpdatedAt: time.Now().UTC(),
		State:     state,
	})
	if err != nil {
		return err
	}
	target := HeartbeatPath(stateDir, worker)
	temporary, err := os.CreateTemp(stateDir, ".worker-"+worker+"-heartbeat-*.tmp")
	if err != nil {
		return fmt.Errorf("write %s heartbeat: %w", worker, err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure %s heartbeat: %w", worker, err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write %s heartbeat: %w", worker, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close %s heartbeat: %w", worker, err)
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return fmt.Errorf("publish %s heartbeat: %w", worker, err)
	}
	return nil
}
