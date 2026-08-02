package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRuntimeDatabaseURLPrefersAnExclusiveSecretFile(t *testing.T) {
	clearEnv(t, "DATABASE_URL", "DATABASE_URL_FILE")
	path := filepath.Join(t.TempDir(), "database-url")
	if err := os.WriteFile(path, []byte("postgresql://api:secret@postgres/allmail\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL_FILE", path)
	value, err := loadRuntimeDatabaseURL("test runtime")
	if err != nil || value != "postgresql://api:secret@postgres/allmail" {
		t.Fatalf("database URL = %q, %v", value, err)
	}
	t.Setenv("DATABASE_URL", "postgresql://owner:secret@postgres/allmail")
	if _, err := loadRuntimeDatabaseURL("test runtime"); err == nil {
		t.Fatal("simultaneous raw and file database URLs were accepted")
	}
}
