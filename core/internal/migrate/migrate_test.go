package migrate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMigrationsOrdersFilesAndComputesChecksums(t *testing.T) {
	directory := t.TempDir()
	for name, content := range map[string]string{
		"0002_second.sql": "CREATE TABLE second_example (id integer PRIMARY KEY);",
		"0001_first.sql":  "CREATE TABLE first_example (id integer PRIMARY KEY);",
	} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	migrations, err := loadMigrations(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(migrations) != 2 {
		t.Fatalf("migration count = %d, want 2", len(migrations))
	}
	if migrations[0].Name != "0001_first" || migrations[1].Name != "0002_second" {
		t.Fatalf("migration order = %#v", migrations)
	}
	for _, item := range migrations {
		if len(item.Checksum) != 64 {
			t.Fatalf("checksum length for %s = %d", item.Name, len(item.Checksum))
		}
	}
}

func TestLoadMigrationsRejectsTransactionControlAndMetaCommands(t *testing.T) {
	for name, content := range map[string]string{
		"transaction.sql": "BEGIN;\nSELECT 1;\nCOMMIT;",
		"meta.sql":        "\\echo unsafe",
		"ledger.sql":      "INSERT INTO runtime_migrations (name) VALUES ('bad');",
	} {
		t.Run(name, func(t *testing.T) {
			directory := t.TempDir()
			if err := os.WriteFile(filepath.Join(directory, "0001_invalid.sql"), []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := loadMigrations(directory); err == nil {
				t.Fatal("loadMigrations() expected an error")
			}
		})
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
