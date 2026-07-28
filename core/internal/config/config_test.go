package config

import (
	"os"
	"path/filepath"
	"testing"
)

func resetJobEnv(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		"API_LOG_RETENTION_OWNER",
		"API_LOG_RETENTION_DAYS",
		"API_LOG_CLEANUP_INTERVAL_MINUTES",
		"API_LOG_CLEANUP_RETRY_SECONDS",
		"API_LOG_CLEANUP_TIMEOUT_SECONDS",
		"API_LOG_CLEANUP_BATCH_SIZE",
	} {
		t.Setenv(name, "")
	}
}

func TestLoadDefaults(t *testing.T) {
	resetJobEnv(t)
	t.Setenv("PORT", "")
	t.Setenv("GO_API_MODE", "")
	t.Setenv("LEGACY_API_URL", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Port != 3000 {
		t.Fatalf("Port = %d, want 3000", cfg.Port)
	}
	if cfg.APIMode != APIModeBridge {
		t.Fatalf("APIMode = %q, want bridge", cfg.APIMode)
	}
	if cfg.LogRetentionOwner != RuntimeOwnerLegacy {
		t.Fatalf("LogRetentionOwner = %q, want legacy", cfg.LogRetentionOwner)
	}
	if cfg.APILogCleanupRetry.Seconds() != 30 {
		t.Fatalf("APILogCleanupRetry = %s, want 30s", cfg.APILogCleanupRetry)
	}
	if cfg.APILogCleanupTimeout.Seconds() != 60 {
		t.Fatalf("APILogCleanupTimeout = %s, want 60s", cfg.APILogCleanupTimeout)
	}
}

func TestLoadRejectsInvalidLegacyURL(t *testing.T) {
	resetJobEnv(t)
	t.Setenv("LEGACY_API_URL", "not-a-url")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}

func TestLoadRejectsWrongDatabaseScheme(t *testing.T) {
	resetJobEnv(t)
	t.Setenv("DATABASE_URL", "http://127.0.0.1:5432/database")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}

func TestBridgeValidationRequiresAllDependencies(t *testing.T) {
	cfg := Config{APIMode: APIModeBridge, LogRetentionOwner: RuntimeOwnerLegacy}
	if err := cfg.ValidateFor("api"); err == nil {
		t.Fatal("ValidateFor(api) expected an error")
	}
}

func TestStaticValidationDoesNotRequireLegacy(t *testing.T) {
	cfg := Config{APIMode: APIModeStatic, StaticDir: t.TempDir(), LogRetentionOwner: RuntimeOwnerLegacy}
	if err := cfg.ValidateFor("api"); err != nil {
		t.Fatalf("ValidateFor(api) error = %v", err)
	}
}

func TestGoLogRetentionRequiresDatabase(t *testing.T) {
	cfg := Config{
		StateDir:          t.TempDir(),
		LogRetentionOwner: RuntimeOwnerGo,
	}
	if err := cfg.ValidateFor("jobs"); err == nil {
		t.Fatal("ValidateFor(jobs) expected an error")
	}
}

func TestLoadRejectsInvalidLogRetentionOwner(t *testing.T) {
	resetJobEnv(t)
	t.Setenv("API_LOG_RETENTION_OWNER", "both")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}

func TestLoadRejectsInvalidCleanupRetry(t *testing.T) {
	resetJobEnv(t)
	t.Setenv("API_LOG_CLEANUP_RETRY_SECONDS", "0")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}
