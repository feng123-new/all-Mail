package jobs

import (
	"context"
	"fmt"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/jackc/pgx/v5"
)

const (
	apiLogRetentionLockNamespace int32 = 421337
	apiLogRetentionLockKey       int32 = 240729
)

const retentionDeleteSQL = `
WITH doomed AS MATERIALIZED (
    SELECT logs.id
    FROM api_logs AS logs
    WHERE logs.created_at < now() - ($1::int * interval '1 day')
    ORDER BY logs.id
    LIMIT $2
    FOR UPDATE SKIP LOCKED
)
DELETE FROM api_logs AS logs
USING doomed
WHERE logs.id = doomed.id
RETURNING logs.id`

type RetentionCleaner interface {
	Cleanup(context.Context) (int64, error)
}

type pgxRetentionCleaner struct {
	databaseURL string
	retention   int
	batchSize   int
}

func newRetentionCleaner(cfg config.Config) (RetentionCleaner, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required for Go API log retention")
	}
	return pgxRetentionCleaner{
		databaseURL: cfg.DatabaseURL,
		retention:   cfg.APILogRetentionDays,
		batchSize:   cfg.APILogCleanupBatch,
	}, nil
}

func (cleaner pgxRetentionCleaner) Cleanup(ctx context.Context) (int64, error) {
	connection, err := pgx.Connect(ctx, cleaner.databaseURL)
	if err != nil {
		return 0, fmt.Errorf("connect API log retention database: %w", err)
	}
	defer connection.Close(context.Background())

	transaction, err := connection.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin API log retention transaction: %w", err)
	}
	defer transaction.Rollback(context.Background())

	var acquired bool
	if err := transaction.QueryRow(
		ctx,
		"SELECT pg_try_advisory_xact_lock($1, $2)",
		apiLogRetentionLockNamespace,
		apiLogRetentionLockKey,
	).Scan(&acquired); err != nil {
		return 0, fmt.Errorf("acquire API log retention lock: %w", err)
	}
	if !acquired {
		if err := transaction.Commit(ctx); err != nil {
			return 0, fmt.Errorf("commit skipped API log retention transaction: %w", err)
		}
		return 0, nil
	}

	rows, err := transaction.Query(ctx, retentionDeleteSQL, cleaner.retention, cleaner.batchSize)
	if err != nil {
		return 0, fmt.Errorf("delete expired API logs: %w", err)
	}
	var deleted int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, fmt.Errorf("read deleted API log id: %w", err)
		}
		deleted++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("iterate deleted API logs: %w", err)
	}
	rows.Close()

	if err := transaction.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit API log retention transaction: %w", err)
	}
	return deleted, nil
}
