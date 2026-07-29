package migrate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/jackc/pgx/v5"
)

const migrationLockSQL = "SELECT pg_advisory_xact_lock(421337, 240728);"

type migration struct {
	Name     string
	Path     string
	SQL      string
	Checksum string
}

// Run applies pending Go-runtime migrations in one PostgreSQL transaction. The
// connection uses the simple protocol so a numbered migration may contain
// multiple SQL statements and DO blocks without relying on a psql subprocess.
func Run(ctx context.Context, cfg config.MigrationConfig, logger *slog.Logger) error {
	migrations, err := loadMigrations(cfg.Directory)
	if err != nil {
		return err
	}
	connectionConfig, err := pgx.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("parse migration database URL: %w", err)
	}
	connectionConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	connection, err := pgx.ConnectConfig(ctx, connectionConfig)
	if err != nil {
		return fmt.Errorf("connect migration database: %w", err)
	}
	defer connection.Close(context.Background())

	transaction, err := connection.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration transaction: %w", err)
	}
	defer transaction.Rollback(context.Background())

	if _, err := transaction.Exec(ctx, migrationLockSQL); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	if _, err := transaction.Exec(ctx, ledgerBootstrapSQL); err != nil {
		return fmt.Errorf("initialize migration ledger: %w", err)
	}
	rows, err := transaction.Query(ctx, "SELECT name FROM runtime_migrations ORDER BY name")
	if err != nil {
		return fmt.Errorf("read applied migration names: %w", err)
	}
	appliedNames := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return fmt.Errorf("scan applied migration name: %w", err)
		}
		appliedNames = append(appliedNames, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate applied migration names: %w", err)
	}
	rows.Close()
	if unknown := findUnknownMigrationNames(migrations, appliedNames); len(unknown) > 0 {
		return fmt.Errorf(
			"database schema is newer than this runtime; unknown applied migrations: %s",
			strings.Join(unknown, ", "),
		)
	}

	logger.Info("applying Go runtime migrations", "count", len(migrations))
	for _, item := range migrations {
		var storedChecksum *string
		err := transaction.QueryRow(
			ctx,
			"SELECT checksum FROM runtime_migrations WHERE name = $1",
			item.Name,
		).Scan(&storedChecksum)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			logger.Info("applying migration", "name", item.Name)
			if _, err := transaction.Exec(ctx, item.SQL); err != nil {
				return fmt.Errorf("apply migration %s: %w", item.Name, err)
			}
			if _, err := transaction.Exec(
				ctx,
				"INSERT INTO runtime_migrations (name, checksum) VALUES ($1, $2)",
				item.Name,
				item.Checksum,
			); err != nil {
				return fmt.Errorf("record migration %s: %w", item.Name, err)
			}
		case err != nil:
			return fmt.Errorf("read migration ledger entry %s: %w", item.Name, err)
		case storedChecksum == nil:
			logger.Info("validating checksum-less migration ledger entry", "name", item.Name)
			if _, err := transaction.Exec(ctx, item.SQL); err != nil {
				return fmt.Errorf("validate legacy migration %s: %w", item.Name, err)
			}
			if _, err := transaction.Exec(
				ctx,
				"UPDATE runtime_migrations SET checksum = $1 WHERE name = $2 AND checksum IS NULL",
				item.Checksum,
				item.Name,
			); err != nil {
				return fmt.Errorf("adopt legacy migration %s: %w", item.Name, err)
			}
		case *storedChecksum != item.Checksum:
			return fmt.Errorf(
				"checksum mismatch for applied migration %s: database=%s file=%s",
				item.Name,
				*storedChecksum,
				item.Checksum,
			)
		default:
			logger.Info("migration already applied", "name", item.Name)
		}
	}

	if _, err := transaction.Exec(ctx, "ALTER TABLE runtime_migrations ALTER COLUMN checksum SET NOT NULL"); err != nil {
		return fmt.Errorf("finalize migration ledger: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit Go runtime migrations: %w", err)
	}
	return nil
}

func findUnknownMigrationNames(migrations []migration, appliedNames []string) []string {
	known := make(map[string]struct{}, len(migrations))
	for _, item := range migrations {
		known[item.Name] = struct{}{}
	}
	unknown := make([]string, 0)
	for _, name := range appliedNames {
		if _, ok := known[name]; !ok {
			unknown = append(unknown, name)
		}
	}
	sort.Strings(unknown)
	return unknown
}

func loadMigrations(directory string) ([]migration, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("read migration directory: %w", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		return nil, fmt.Errorf("no SQL migrations found in %s", directory)
	}

	migrations := make([]migration, 0, len(files))
	for _, file := range files {
		path := filepath.Join(directory, file)
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", file, err)
		}
		sql := strings.TrimSpace(string(content))
		if err := validateMigrationSQL(file, sql); err != nil {
			return nil, err
		}
		digest := sha256.Sum256([]byte(sql))
		migrations = append(migrations, migration{
			Name:     strings.TrimSuffix(file, filepath.Ext(file)),
			Path:     path,
			SQL:      sql,
			Checksum: hex.EncodeToString(digest[:]),
		})
	}
	return migrations, nil
}

func validateMigrationSQL(name, sql string) error {
	if sql == "" {
		return fmt.Errorf("migration %s is empty", name)
	}
	for lineNumber, line := range strings.Split(sql, "\n") {
		normalized := strings.ToUpper(strings.TrimSpace(line))
		if normalized == "BEGIN;" || normalized == "COMMIT;" || normalized == "ROLLBACK;" {
			return fmt.Errorf("migration %s line %d contains transaction control; the runner owns the transaction", name, lineNumber+1)
		}
		if strings.HasPrefix(strings.TrimSpace(line), "\\") {
			return fmt.Errorf("migration %s line %d contains a psql meta-command", name, lineNumber+1)
		}
	}
	if strings.Contains(strings.ToLower(sql), "insert into runtime_migrations") {
		return fmt.Errorf("migration %s writes the migration ledger; the runner owns the ledger", name)
	}
	return nil
}

const ledgerBootstrapSQL = `
CREATE TABLE IF NOT EXISTS runtime_migrations (
    name text PRIMARY KEY,
    checksum text,
    applied_at timestamptz NOT NULL DEFAULT now()
);

DO $allmail_ledger$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'runtime_migrations'
          AND column_name = 'name'
          AND data_type = 'text'
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'runtime_migrations.name is missing or malformed';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'runtime_migrations'
          AND column_name = 'applied_at'
          AND data_type = 'timestamp with time zone'
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'runtime_migrations.applied_at is missing or malformed';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'runtime_migrations'::regclass
          AND contype = 'p'
    ) THEN
        RAISE EXCEPTION 'runtime_migrations must have a primary key';
    END IF;
END
$allmail_ledger$;

ALTER TABLE runtime_migrations ADD COLUMN IF NOT EXISTS checksum text;
`
