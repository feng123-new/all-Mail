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
		"FORWARDING_WORKER_OWNER",
		"FORWARDING_WORKER_INTERVAL_SECONDS",
		"FORWARDING_WORKER_BATCH_SIZE",
		"RESEND_API_BASE_URL",
		"ALL_MAIL_SECRET_STATE_DIR",
		"ENCRYPTION_KEY",
		"ENCRYPTION_KEY_FILE",
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
	if cfg.ForwardingWorkerOwner != "legacy" {
		t.Fatalf("ForwardingWorkerOwner = %q, want legacy", cfg.ForwardingWorkerOwner)
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

func TestLoadReadsManagedEncryptionKeyFromSeparateSecretState(t *testing.T) {
	resetJobEnv(t)
	secretStateDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(secretStateDir, "bootstrap-secrets.env"), []byte("ENCRYPTION_KEY=managed-encryption-key-12345678\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ALL_MAIL_SECRET_STATE_DIR", secretStateDir)

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EncryptionKey != "managed-encryption-key-12345678" {
		t.Fatalf("EncryptionKey = %q", cfg.EncryptionKey)
	}
}

func TestLoadReadsExportedEncryptionKeyFile(t *testing.T) {
	resetJobEnv(t)
	keyFile := filepath.Join(t.TempDir(), "encryption-key")
	if err := os.WriteFile(keyFile, []byte("exported-encryption-key-1234567\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENCRYPTION_KEY_FILE", keyFile)

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EncryptionKey != "exported-encryption-key-1234567" {
		t.Fatalf("EncryptionKey = %q", cfg.EncryptionKey)
	}
}

func TestLoadRejectsInvalidForwardingOwner(t *testing.T) {
	resetJobEnv(t)
	t.Setenv("FORWARDING_WORKER_OWNER", "both")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}

func TestGoForwardingRequiresDatabaseAndEncryptionKey(t *testing.T) {
	cfg := Config{
		StateDir:              t.TempDir(),
		LogRetentionOwner:     RuntimeOwnerLegacy,
		ForwardingWorkerOwner: "go",
	}
	if err := cfg.ValidateFor("jobs"); err == nil {
		t.Fatal("ValidateFor(jobs) expected a database error")
	}
	cfg.DatabaseURL = "postgresql://example.invalid/allmail"
	if err := cfg.ValidateFor("jobs"); err == nil {
		t.Fatal("ValidateFor(jobs) expected an encryption key error")
	}
	cfg.EncryptionKey = "test-encryption-key-1234567890ab"
	if err := cfg.ValidateFor("jobs"); err != nil {
		t.Fatalf("ValidateFor(jobs) error = %v", err)
	}
}
