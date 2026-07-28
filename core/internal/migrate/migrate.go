package migrate

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

// Run applies the idempotent Go-runtime foundation migrations with psql. It is
// deliberately an explicit command instead of an API startup side effect.
func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	psql, err := exec.LookPath("psql")
	if err != nil {
		return fmt.Errorf("psql is required for migrations: %w", err)
	}
	entries, err := os.ReadDir(cfg.MigrationDir)
	if err != nil {
		return fmt.Errorf("read migration directory: %w", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		return fmt.Errorf("no SQL migrations found in %s", cfg.MigrationDir)
	}
	for _, name := range files {
		path := filepath.Join(cfg.MigrationDir, name)
		logger.Info("applying Go runtime migration", "file", name)
		command := exec.CommandContext(ctx, psql, cfg.DatabaseURL, "-v", "ON_ERROR_STOP=1", "-f", path)
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		if err := command.Run(); err != nil {
			return fmt.Errorf("migration %s failed: %w", name, err)
		}
	}
	return nil
}
