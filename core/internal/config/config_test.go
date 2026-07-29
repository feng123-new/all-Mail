package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func clearEnv(t *testing.T, names ...string) {
	t.Helper()
	for _, name := range names {
		t.Setenv(name, "")
	}
}

func TestLoadAPIRequiresBridgeDependencies(t *testing.T) {
	clearEnv(t, "PORT", "GO_API_MODE", "LEGACY_API_URL", "DATABASE_URL", "REDIS_URL")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("LoadAPI() expected missing bridge dependency error")
	}
}

func TestLoadAPIBridgeAndStaticModes(t *testing.T) {
	t.Setenv("GO_API_MODE", "bridge")
	t.Setenv("LEGACY_API_URL", "http://legacy-api:3100")
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("REDIS_URL", "redis://redis:6379/0")
	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Mode != APIModeBridge || cfg.Port != 3000 {
		t.Fatalf("API config = %#v", cfg)
	}

	t.Setenv("GO_API_MODE", "static")
	t.Setenv("LEGACY_API_URL", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	t.Setenv("ALL_MAIL_STATIC_DIR", t.TempDir())
	cfg, err = LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Mode != APIModeStatic {
		t.Fatalf("Mode = %q, want static", cfg.Mode)
	}
}

func TestLoadAPIRejectsInvalidURLs(t *testing.T) {
	t.Setenv("GO_API_MODE", "bridge")
	t.Setenv("LEGACY_API_URL", "not-a-url")
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("REDIS_URL", "redis://redis:6379")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("LoadAPI() expected invalid legacy URL error")
	}

	t.Setenv("LEGACY_API_URL", "http://legacy-api:3100")
	t.Setenv("DATABASE_URL", "http://postgres:5432/allmail")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("LoadAPI() expected invalid database scheme error")
	}
}

func TestLoadForwardingDefaultsAndSecretFile(t *testing.T) {
	clearEnv(t,
		"FORWARDING_WORKER_INTERVAL_SECONDS",
		"FORWARDING_RUN_TIMEOUT_SECONDS",
		"FORWARDING_WORKER_BATCH_SIZE",
		"WORKER_HEARTBEAT_SECONDS",
		"WORKER_HEARTBEAT_MAX_AGE_SECONDS",
		"GO_JOBS_HEARTBEAT_SECONDS",
		"GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS",
		"RESEND_API_BASE_URL",
		"ALL_MAIL_SECRET_STATE_DIR",
		"ENCRYPTION_KEY",
	)
	keyFile := filepath.Join(t.TempDir(), "encryption-key")
	if err := os.WriteFile(keyFile, []byte("exported-encryption-key-1234567\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENCRYPTION_KEY_FILE", keyFile)
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("ALL_MAIL_STATE_DIR", t.TempDir())

	cfg, err := LoadForwarding()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EncryptionKey != "exported-encryption-key-1234567" {
		t.Fatalf("EncryptionKey = %q", cfg.EncryptionKey)
	}
	if cfg.Interval != 30*time.Second || cfg.RunTimeout != 120*time.Second || cfg.BatchSize != 10 {
		t.Fatalf("Forwarding defaults = %#v", cfg)
	}
}

func TestLoadForwardingReadsManagedSecretAndRejectsInvalidTimeout(t *testing.T) {
	secretStateDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(secretStateDir, "bootstrap-secrets.env"), []byte("ENCRYPTION_KEY=managed-encryption-key-12345678\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	clearEnv(t, "ENCRYPTION_KEY", "ENCRYPTION_KEY_FILE")
	t.Setenv("ALL_MAIL_SECRET_STATE_DIR", secretStateDir)
	t.Setenv("ALL_MAIL_STATE_DIR", t.TempDir())
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	cfg, err := LoadForwarding()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EncryptionKey != "managed-encryption-key-12345678" {
		t.Fatalf("EncryptionKey = %q", cfg.EncryptionKey)
	}

	t.Setenv("FORWARDING_RUN_TIMEOUT_SECONDS", "0")
	if _, err := LoadForwarding(); err == nil {
		t.Fatal("LoadForwarding() expected timeout validation error")
	}
}

func TestLoadRetentionDefaultsAndValidation(t *testing.T) {
	clearEnv(t,
		"API_LOG_RETENTION_DAYS",
		"API_LOG_CLEANUP_INTERVAL_MINUTES",
		"API_LOG_CLEANUP_RETRY_SECONDS",
		"API_LOG_CLEANUP_TIMEOUT_SECONDS",
		"API_LOG_CLEANUP_BATCH_SIZE",
		"WORKER_HEARTBEAT_SECONDS",
		"WORKER_HEARTBEAT_MAX_AGE_SECONDS",
	)
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("ALL_MAIL_STATE_DIR", t.TempDir())
	cfg, err := LoadRetention()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RetentionDays != 30 || cfg.Interval != time.Hour || cfg.Retry != 30*time.Second || cfg.RunTimeout != time.Minute || cfg.BatchSize != 5000 {
		t.Fatalf("Retention defaults = %#v", cfg)
	}

	t.Setenv("API_LOG_CLEANUP_RETRY_SECONDS", "0")
	if _, err := LoadRetention(); err == nil {
		t.Fatal("LoadRetention() expected retry validation error")
	}
}

func TestLoadMigrationRequiresDatabaseAndDirectory(t *testing.T) {
	clearEnv(t, "DATABASE_URL", "ALL_MAIL_MIGRATION_DIR")
	if _, err := LoadMigration(); err == nil {
		t.Fatal("LoadMigration() expected database error")
	}
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("ALL_MAIL_MIGRATION_DIR", t.TempDir())
	cfg, err := LoadMigration()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Directory == "" {
		t.Fatal("migration directory is empty")
	}
}
