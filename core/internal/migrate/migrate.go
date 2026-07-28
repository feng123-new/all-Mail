package migrate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

const migrationLockSQL = "SELECT pg_advisory_xact_lock(421337, 240728);"

type migration struct {
	Name     string
	Path     string
	SQL      string
	Checksum string
}

// Run applies pending Go-runtime migrations in one PostgreSQL session. The
// generated script holds an advisory transaction lock, verifies checksums, and
// adopts the pre-checksum ledger only after each migration's schema assertions
// have passed.
func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	psql, err := exec.LookPath("psql")
	if err != nil {
		return fmt.Errorf("psql is required for migrations: %w", err)
	}
	migrations, err := loadMigrations(cfg.MigrationDir)
	if err != nil {
		return err
	}
	script, err := buildScript(migrations)
	if err != nil {
		return err
	}

	temporary, err := os.CreateTemp("", "allmail-go-migrations-*.sql")
	if err != nil {
		return fmt.Errorf("create migration script: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure migration script: %w", err)
	}
	if _, err := temporary.WriteString(script); err != nil {
		temporary.Close()
		return fmt.Errorf("write migration script: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close migration script: %w", err)
	}

	logger.Info("applying Go runtime migrations", "count", len(migrations))
	command := exec.CommandContext(
		ctx,
		psql,
		cfg.DatabaseURL,
		"-X",
		"--set=ON_ERROR_STOP=1",
		"--file", temporaryPath,
	)
	command.Env = append(os.Environ(), "PGCONNECT_TIMEOUT=10")
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("Go runtime migrations failed: %w", err)
	}
	return nil
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

func buildScript(migrations []migration) (string, error) {
	if len(migrations) == 0 {
		return "", fmt.Errorf("at least one migration is required")
	}
	var builder strings.Builder
	builder.WriteString("\\set ON_ERROR_STOP on\n")
	builder.WriteString("BEGIN;\n")
	builder.WriteString(migrationLockSQL)
	builder.WriteString("\n")
	builder.WriteString(ledgerBootstrapSQL)
	builder.WriteString("\n")

	for index, item := range migrations {
		prefix := fmt.Sprintf("migration_%d", index)
		name := quoteLiteral(item.Name)
		checksum := quoteLiteral(item.Checksum)
		fmt.Fprintf(
			&builder,
			"SELECT CASE WHEN EXISTS (SELECT 1 FROM runtime_migrations WHERE name = %s) THEN 'true' ELSE 'false' END AS %s_exists,\n"+
				"       CASE WHEN COALESCE((SELECT checksum = %s FROM runtime_migrations WHERE name = %s), false) THEN 'true' ELSE 'false' END AS %s_matches,\n"+
				"       CASE WHEN COALESCE((SELECT checksum IS NULL FROM runtime_migrations WHERE name = %s), false) THEN 'true' ELSE 'false' END AS %s_legacy\n\\gset\n",
			name,
			prefix,
			checksum,
			name,
			prefix,
			name,
			prefix,
		)
		fmt.Fprintf(&builder, "\\if :%s_exists\n", prefix)
		fmt.Fprintf(&builder, "\\if :%s_matches\n", prefix)
		fmt.Fprintf(&builder, "    \\echo migration %s already applied\n", item.Name)
		builder.WriteString("\\else\n")
		fmt.Fprintf(&builder, "\\if :%s_legacy\n", prefix)
		fmt.Fprintf(&builder, "      \\echo validating legacy ledger entry %s\n", item.Name)
		writeIndentedSQL(&builder, item.SQL, "      ")
		fmt.Fprintf(&builder, "      UPDATE runtime_migrations SET checksum = %s WHERE name = %s;\n", checksum, name)
		builder.WriteString("\\else\n")
		fmt.Fprintf(&builder, "      \\echo checksum mismatch for migration %s\n", item.Name)
		builder.WriteString("\\quit 3\n")
		builder.WriteString("\\endif\n")
		builder.WriteString("\\endif\n")
		builder.WriteString("\\else\n")
		fmt.Fprintf(&builder, "  \\echo applying migration %s\n", item.Name)
		writeIndentedSQL(&builder, item.SQL, "  ")
		fmt.Fprintf(
			&builder,
			"  INSERT INTO runtime_migrations (name, checksum) VALUES (%s, %s);\n",
			name,
			checksum,
		)
		builder.WriteString("\\endif\n")
	}

	builder.WriteString("ALTER TABLE runtime_migrations ALTER COLUMN checksum SET NOT NULL;\n")
	builder.WriteString("COMMIT;\n")
	return builder.String(), nil
}

func writeIndentedSQL(builder *strings.Builder, sql, indent string) {
	for _, line := range strings.Split(sql, "\n") {
		builder.WriteString(indent)
		builder.WriteString(line)
		builder.WriteByte('\n')
	}
}

func quoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
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
