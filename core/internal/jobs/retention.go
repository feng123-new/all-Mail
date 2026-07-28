package jobs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

const apiLogRetentionLockKey = 240729

type RetentionCleaner interface {
	Cleanup(context.Context) (int64, error)
}

type psqlRetentionCleaner struct {
	psql        string
	databaseURL string
	retention   int
	batchSize   int
}

func newRetentionCleaner(cfg config.Config) (RetentionCleaner, error) {
	psql, err := exec.LookPath("psql")
	if err != nil {
		return nil, fmt.Errorf("psql is required for Go API log retention: %w", err)
	}
	return psqlRetentionCleaner{
		psql:        psql,
		databaseURL: cfg.DatabaseURL,
		retention:   cfg.APILogRetentionDays,
		batchSize:   cfg.APILogCleanupBatch,
	}, nil
}

func (cleaner psqlRetentionCleaner) Cleanup(ctx context.Context) (int64, error) {
	query := buildRetentionSQL(cleaner.retention, cleaner.batchSize)
	command := exec.CommandContext(
		ctx,
		cleaner.psql,
		cleaner.databaseURL,
		"-X",
		"--set=ON_ERROR_STOP=1",
		"--tuples-only",
		"--no-align",
		"--field-separator=|",
		"--command", query,
	)
	command.Env = append(os.Environ(), "PGCONNECT_TIMEOUT=10")
	output, err := command.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("API log retention query failed: %w: %s", err, compactCommandOutput(output))
	}
	acquired, deleted, err := parseRetentionResult(string(output))
	if err != nil {
		return 0, err
	}
	if !acquired {
		return 0, nil
	}
	return deleted, nil
}

func buildRetentionSQL(retentionDays, batchSize int) string {
	return fmt.Sprintf(`WITH lock_state AS MATERIALIZED (
    SELECT pg_try_advisory_xact_lock(421337, %d) AS acquired
),
doomed AS MATERIALIZED (
    SELECT logs.id
    FROM api_logs AS logs
    WHERE logs.created_at < now() - make_interval(days => %d)
      AND (SELECT acquired FROM lock_state)
    ORDER BY logs.id
    LIMIT %d
),
deleted AS (
    DELETE FROM api_logs AS logs
    USING doomed
    WHERE logs.id = doomed.id
    RETURNING logs.id
)
SELECT (SELECT acquired FROM lock_state), count(*) FROM deleted;`, apiLogRetentionLockKey, retentionDays, batchSize)
}

func parseRetentionResult(output string) (bool, int64, error) {
	line := strings.TrimSpace(output)
	if line == "" {
		return false, 0, errors.New("API log retention query returned no result")
	}
	lines := strings.Split(line, "\n")
	fields := strings.Split(strings.TrimSpace(lines[len(lines)-1]), "|")
	if len(fields) != 2 {
		return false, 0, fmt.Errorf("unexpected API log retention result %q", line)
	}
	acquired, err := strconv.ParseBool(strings.TrimSpace(fields[0]))
	if err != nil {
		return false, 0, fmt.Errorf("decode API log retention lock result: %w", err)
	}
	deleted, err := strconv.ParseInt(strings.TrimSpace(fields[1]), 10, 64)
	if err != nil || deleted < 0 {
		return false, 0, fmt.Errorf("decode API log retention delete count %q", fields[1])
	}
	return acquired, deleted, nil
}

func compactCommandOutput(output []byte) string {
	text := strings.Join(strings.Fields(string(output)), " ")
	if text == "" {
		return "no diagnostic output"
	}
	if len(text) > 400 {
		return text[:400] + "..."
	}
	return text
}
