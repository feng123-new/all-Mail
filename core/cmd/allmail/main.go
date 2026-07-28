package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/doctor"
	"github.com/feng123-new/all-Mail/core/internal/httpapi"
	"github.com/feng123-new/all-Mail/core/internal/jobs"
	"github.com/feng123-new/all-Mail/core/internal/migrate"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	command := "api"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	switch command {
	case "api":
		fatalIf(logger, cfg.ValidateFor("api"))
		server, newErr := httpapi.New(cfg, logger)
		if newErr != nil {
			fatal(logger, newErr)
		}
		fatalIf(logger, server.Run(ctx))
	case "jobs":
		fatalIf(logger, cfg.ValidateFor("jobs"))
		fatalIf(logger, jobs.Run(ctx, cfg, logger))
	case "migrate":
		fatalIf(logger, cfg.ValidateFor("migrate"))
		migrationCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		defer cancel()
		fatalIf(logger, migrate.Run(migrationCtx, cfg, logger))
	case "doctor":
		if len(os.Args) < 3 {
			fatal(logger, fmt.Errorf("usage: allmail doctor api|jobs"))
		}
		doctorCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		switch os.Args[2] {
		case "api":
			fatalIf(logger, doctor.API(doctorCtx, cfg))
		case "jobs":
			fatalIf(logger, cfg.ValidateFor("jobs"))
			fatalIf(logger, doctor.Jobs(cfg))
		default:
			fatal(logger, fmt.Errorf("unknown doctor target %q", os.Args[2]))
		}
	default:
		fatal(logger, fmt.Errorf("unknown command %q; use api, jobs, migrate or doctor", command))
	}
}

func fatalIf(logger *slog.Logger, err error) {
	if err != nil {
		fatal(logger, err)
	}
}

func fatal(logger *slog.Logger, err error) {
	logger.Error("allmail runtime failed", "error", err)
	os.Exit(1)
}
