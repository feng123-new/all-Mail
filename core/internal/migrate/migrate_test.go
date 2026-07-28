package migrate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMigrationsAndBuildScript(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "0001_example.sql")
	if err := os.WriteFile(path, []byte("CREATE TABLE example (id integer PRIMARY KEY);"), 0o600); err != nil {
		t.Fatal(err)
	}
	migrations, err := loadMigrations(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(migrations) != 1 || len(migrations[0].Checksum) != 64 {
		t.Fatalf("migrations = %#v", migrations)
	}
	script, err := buildScript(migrations)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"pg_advisory_xact_lock",
		"runtime_migrations",
		migrations[0].Checksum,
		"\n\\gset\n",
		"\\if :migration_0_exists",
		"ALTER COLUMN checksum SET NOT NULL",
	} {
		if !strings.Contains(script, expected) {
			t.Fatalf("script is missing %q:\n%s", expected, script)
		}
	}
}

func TestLoadMigrationsRejectsTransactionControl(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "0001_invalid.sql")
	if err := os.WriteFile(path, []byte("BEGIN;\nSELECT 1;\nCOMMIT;"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadMigrations(directory); err == nil {
		t.Fatal("loadMigrations expected an error")
	}
}

func TestChecksumChangesWithMigrationContent(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "0001_example.sql")
	if err := os.WriteFile(path, []byte("SELECT 1;"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := loadMigrations(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("SELECT 2;"), 0o600); err != nil {
		t.Fatal(err)
	}
	second, err := loadMigrations(directory)
	if err != nil {
		t.Fatal(err)
	}
	if first[0].Checksum == second[0].Checksum {
		t.Fatal("migration checksum did not change")
	}
}
