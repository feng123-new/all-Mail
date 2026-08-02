package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/buildinfo"
	"github.com/feng123-new/all-Mail/core/internal/businessapi"
	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/doctor"
	"github.com/feng123-new/all-Mail/core/internal/httpapi"
	"github.com/feng123-new/all-Mail/core/internal/initialize"
	"github.com/feng123-new/all-Mail/core/internal/jobs"
	"github.com/feng123-new/all-Mail/core/internal/routeownership"
)

const usageText = `Usage:
  allmail api
  allmail business-api
  allmail routes
  allmail version
  allmail version --json
  allmail worker forwarding
  allmail worker retention
  allmail init
  allmail migrate
  allmail doctor api
  allmail doctor business-api
  allmail doctor worker forwarding
  allmail doctor worker retention
`

func main() {
	command, showHelp := commandFromArgs(os.Args)
	if showHelp {
		fmt.Fprint(os.Stdout, usageText)
		return
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	switch command {
	case "api":
		cfg, err := config.LoadAPI()
		fatalIf(logger, err)
		server, err := httpapi.New(cfg, logger)
		fatalIf(logger, err)
		fatalIf(logger, server.Run(ctx))
	case "business-api":
		cfg, err := config.LoadGoBusinessAPI()
		fatalIf(logger, err)
		server, err := businessapi.New(ctx, cfg, logger)
		fatalIf(logger, err)
		defer server.Close()
		fatalIf(logger, server.Run(ctx))
	case "routes":
		manifest, err := routeownership.LoadDefault()
		fatalIf(logger, err)
		content, err := json.MarshalIndent(manifest.Snapshot(), "", "  ")
		fatalIf(logger, err)
		fmt.Fprintf(os.Stdout, "%s\n", content)
	case "version":
		fatalIf(logger, writeVersion(os.Stdout, os.Args))
	case "worker":
		if len(os.Args) < 3 {
			fatal(logger, fmt.Errorf("usage: allmail worker forwarding|retention"))
		}
		switch os.Args[2] {
		case jobs.WorkerForwarding:
			cfg, err := config.LoadForwarding()
			fatalIf(logger, err)
			fatalIf(logger, jobs.RunForwarding(ctx, cfg, logger))
		case jobs.WorkerRetention:
			cfg, err := config.LoadRetention()
			fatalIf(logger, err)
			fatalIf(logger, jobs.RunRetention(ctx, cfg, logger))
		default:
			fatal(logger, fmt.Errorf("unknown worker %q; use forwarding or retention", os.Args[2]))
		}
	case "init":
		cfg, err := initialize.LoadConfig()
		fatalIf(logger, err)
		fatalIf(logger, initialize.Run(ctx, cfg, logger))
	case "migrate":
		cfg, err := config.LoadMigration()
		fatalIf(logger, err)
		fatalIf(logger, initialize.SchemaOnly(ctx, cfg, logger))
	case "doctor":
		if len(os.Args) < 3 {
			fatal(logger, fmt.Errorf("usage: allmail doctor api|business-api|worker"))
		}
		doctorCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		switch os.Args[2] {
		case "api":
			cfg, err := config.LoadAPI()
			fatalIf(logger, err)
			fatalIf(logger, doctor.API(doctorCtx, cfg))
		case "business-api":
			cfg, err := config.LoadGoBusinessAPI()
			fatalIf(logger, err)
			fatalIf(logger, doctor.GoBusinessAPI(doctorCtx, cfg))
		case "worker":
			if len(os.Args) < 4 {
				fatal(logger, fmt.Errorf("usage: allmail doctor worker forwarding|retention"))
			}
			switch os.Args[3] {
			case jobs.WorkerForwarding:
				cfg, err := config.LoadForwarding()
				fatalIf(logger, err)
				fatalIf(logger, doctor.Forwarding(cfg))
			case jobs.WorkerRetention:
				cfg, err := config.LoadRetention()
				fatalIf(logger, err)
				fatalIf(logger, doctor.Retention(cfg))
			default:
				fatal(logger, fmt.Errorf("unknown doctor worker target %q", os.Args[3]))
			}
		default:
			fatal(logger, fmt.Errorf("unknown doctor target %q", os.Args[2]))
		}
	default:
		fatal(logger, fmt.Errorf("unknown command %q; use api, business-api, routes, version, worker, init, migrate or doctor", command))
	}
}

func writeVersion(output io.Writer, args []string) error {
	info := buildinfo.Current()
	switch {
	case len(args) == 2:
		_, err := fmt.Fprintf(output, "allmail %s\ncommit: %s\nbuilt: %s\ngo: %s\n", info.Version, info.Commit, info.BuildDate, info.GoVersion)
		return err
	case len(args) == 3 && args[2] == "--json":
		encoder := json.NewEncoder(output)
		encoder.SetIndent("", "  ")
		return encoder.Encode(info)
	default:
		return fmt.Errorf("usage: allmail version [--json]")
	}
}

func commandFromArgs(args []string) (string, bool) {
	if len(args) < 2 {
		return "api", false
	}
	switch args[1] {
	case "-h", "--help", "help":
		return "", true
	default:
		return args[1], false
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
