package jobs

import (
	"context"
	"fmt"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

type retentionPool interface {
	Begin(context.Context) (pgx.Tx, error)
	Ping(context.Context) error
	Close()
}

type RetentionCleaner interface {
	Cleanup(context.Context) (int64, error)
	Ping(context.Context) error
	Close()
}

type pgxRetentionCleaner struct {
	pool       retentionPool
	retention  int
	batchSize  int
	maxBatches int
}

func newRetentionCleaner(ctx context.Context, cfg config.RetentionConfig) (RetentionCleaner, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required for Go API log retention")
	}
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("create API log retention pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping API log retention database: %w", err)
	}
	return newRetentionCleanerWithPool(pool, cfg)
}

func newRetentionCleanerWithPool(pool retentionPool, cfg config.RetentionConfig) (RetentionCleaner, error) {
	if pool == nil {
		return nil, fmt.Errorf("API log retention pool is required")
	}
	if cfg.RetentionDays < 1 {
		return nil, fmt.Errorf("API_LOG_RETENTION_DAYS must be positive")
	}
	if cfg.BatchSize < 1 {
		return nil, fmt.Errorf("API_LOG_CLEANUP_BATCH_SIZE must be positive")
	}
	if cfg.MaxBatches < 1 {
		return nil, fmt.Errorf("API_LOG_CLEANUP_MAX_BATCHES must be positive")
	}
	return &pgxRetentionCleaner{
		pool:       pool,
		retention:  cfg.RetentionDays,
		batchSize:  cfg.BatchSize,
		maxBatches: cfg.MaxBatches,
	}, nil
}

func (cleaner *pgxRetentionCleaner) Ping(ctx context.Context) error {
	if err := cleaner.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping API log retention database: %w", err)
	}
	return nil
}

func (cleaner *pgxRetentionCleaner) Close() {
	cleaner.pool.Close()
}

func (cleaner *pgxRetentionCleaner) Cleanup(ctx context.Context) (int64, error) {
	transaction, err := cleaner.pool.Begin(ctx)
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

	var totalDeleted int64
	for batch := 0; batch < cleaner.maxBatches; batch++ {
		rows, err := transaction.Query(ctx, retentionDeleteSQL, cleaner.retention, cleaner.batchSize)
		if err != nil {
			return totalDeleted, fmt.Errorf("delete expired API logs: %w", err)
		}
		var batchDeleted int64
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return totalDeleted, fmt.Errorf("read deleted API log id: %w", err)
			}
			batchDeleted++
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return totalDeleted, fmt.Errorf("iterate deleted API logs: %w", err)
		}
		rows.Close()
		totalDeleted += batchDeleted
		if batchDeleted < int64(cleaner.batchSize) {
			break
		}
	}

	if err := transaction.Commit(ctx); err != nil {
		return totalDeleted, fmt.Errorf("commit API log retention transaction: %w", err)
	}
	return totalDeleted, nil
}
