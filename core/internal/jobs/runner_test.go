package jobs

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestRunWritesHeartbeat(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := config.Config{StateDir: t.TempDir(), JobsHeartbeatInterval: 10 * time.Millisecond}
	done := make(chan error, 1)
	go func() { done <- Run(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil))) }()
	time.Sleep(30 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(HeartbeatPath(cfg.StateDir)); err != nil {
		t.Fatalf("heartbeat missing: %v", err)
	}
}
