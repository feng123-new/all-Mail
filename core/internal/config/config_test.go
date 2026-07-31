package config

import (
	"net/netip"
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

func TestLoadAPIRequiresCompatibilityAPIAndStaticAssets(t *testing.T) {
	clearEnv(t, "PORT", "BUSINESS_API_URL", "ALL_MAIL_STATIC_DIR", "TRUSTED_PROXY_CIDRS", "MAIL_PROVIDER_TIMEOUT_SECONDS")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("LoadAPI() expected missing business API error")
	}

	t.Setenv("BUSINESS_API_URL", "http://business-api:3100")
	t.Setenv("ALL_MAIL_STATIC_DIR", t.TempDir())
	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 3000 || cfg.BusinessAPIURL != "http://business-api:3100" || cfg.ProviderTimeout != 5*time.Minute {
		t.Fatalf("API config = %#v", cfg)
	}
}

func TestLoadAPIParsesTrustedProxyCIDRs(t *testing.T) {
	t.Setenv("BUSINESS_API_URL", "http://business-api:3100")
	t.Setenv("ALL_MAIL_STATIC_DIR", t.TempDir())
	t.Setenv("TRUSTED_PROXY_CIDRS", "127.0.0.1/32, 10.0.0.0/8,10.0.0.0/8")
	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.TrustedProxyCIDRs) != 2 {
		t.Fatalf("trusted proxies = %#v", cfg.TrustedProxyCIDRs)
	}
	if !cfg.TrustsProxy(netip.MustParseAddr("10.1.2.3")) || cfg.TrustsProxy(netip.MustParseAddr("192.0.2.1")) {
		t.Fatalf("unexpected proxy trust result: %#v", cfg.TrustedProxyCIDRs)
	}

	t.Setenv("TRUSTED_PROXY_CIDRS", "not-a-cidr")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("LoadAPI() expected invalid trusted proxy CIDR error")
	}

	for _, blanket := range []string{"0.0.0.0/0", "::/0"} {
		t.Setenv("TRUSTED_PROXY_CIDRS", blanket)
		if _, err := LoadAPI(); err == nil {
			t.Fatalf("LoadAPI() accepted blanket trusted proxy CIDR %q", blanket)
		}
	}
}

func TestLoadAPIRejectsInvalidURL(t *testing.T) {
	t.Setenv("BUSINESS_API_URL", "not-a-url")
	t.Setenv("ALL_MAIL_STATIC_DIR", t.TempDir())
	if _, err := LoadAPI(); err == nil {
		t.Fatal("LoadAPI() expected invalid legacy URL error")
	}
}

func TestLoadForwardingDefaultsAndSecretFile(t *testing.T) {
	clearEnv(t,
		"FORWARDING_WORKER_INTERVAL_SECONDS",
		"FORWARDING_RUN_TIMEOUT_SECONDS",
		"FORWARDING_LEASE_SECONDS",
		"FORWARDING_WORKER_BATCH_SIZE",
		"WORKER_HEARTBEAT_SECONDS",
		"WORKER_HEARTBEAT_MAX_AGE_SECONDS",
		"GO_JOBS_HEARTBEAT_SECONDS",
		"GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS",
		"RESEND_API_BASE_URL",
		"ENCRYPTION_KEY",
	)
	keyFile := filepath.Join(t.TempDir(), "encryption-key")
	if err := os.WriteFile(keyFile, []byte("0123456789abcdef0123456789abcdef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENCRYPTION_KEY_FILE", keyFile)
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("ALL_MAIL_STATE_DIR", t.TempDir())
	// Removed aliases must not override the canonical defaults.
	t.Setenv("GO_JOBS_HEARTBEAT_SECONDS", "1")
	t.Setenv("GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS", "2")

	cfg, err := LoadForwarding()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EncryptionKey != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("EncryptionKey = %q", cfg.EncryptionKey)
	}
	if cfg.Interval != 30*time.Second || cfg.RunTimeout != 120*time.Second || cfg.LeaseDuration != 180*time.Second || cfg.BatchSize != 10 {
		t.Fatalf("Forwarding defaults = %#v", cfg)
	}
	if cfg.HeartbeatInterval != 15*time.Second || cfg.HeartbeatMaxAge != 90*time.Second {
		t.Fatalf("legacy heartbeat aliases affected config: %#v", cfg)
	}
}

func TestLoadForwardingValidatesLeaseAndHeartbeatRelationships(t *testing.T) {
	keyFile := filepath.Join(t.TempDir(), "encryption-key")
	if err := os.WriteFile(keyFile, []byte("0123456789abcdef0123456789abcdef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENCRYPTION_KEY_FILE", keyFile)
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("ALL_MAIL_STATE_DIR", t.TempDir())

	t.Setenv("FORWARDING_LEASE_SECONDS", "120")
	if _, err := LoadForwarding(); err == nil {
		t.Fatal("LoadForwarding() accepted a lease shorter than the run and shutdown envelope")
	}

	t.Setenv("FORWARDING_LEASE_SECONDS", "180")
	t.Setenv("WORKER_HEARTBEAT_SECONDS", "20")
	t.Setenv("WORKER_HEARTBEAT_MAX_AGE_SECONDS", "30")
	if _, err := LoadForwarding(); err == nil {
		t.Fatal("LoadForwarding() accepted an undersized heartbeat max age")
	}
}

func TestLoadForwardingRequiresSecretFileAndRejectsInvalidKey(t *testing.T) {
	clearEnv(t, "ENCRYPTION_KEY_FILE")
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("ALL_MAIL_STATE_DIR", t.TempDir())
	if _, err := LoadForwarding(); err == nil {
		t.Fatal("LoadForwarding() accepted removed ENCRYPTION_KEY fallback")
	}

	keyFile := filepath.Join(t.TempDir(), "encryption-key")
	if err := os.WriteFile(keyFile, []byte("too-short\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENCRYPTION_KEY_FILE", keyFile)
	if _, err := LoadForwarding(); err == nil {
		t.Fatal("LoadForwarding() accepted malformed encryption key file")
	}
}

func TestLoadRetentionDefaultsAndValidation(t *testing.T) {
	clearEnv(t,
		"API_LOG_RETENTION_DAYS",
		"API_LOG_CLEANUP_INTERVAL_MINUTES",
		"API_LOG_CLEANUP_RETRY_SECONDS",
		"API_LOG_CLEANUP_TIMEOUT_SECONDS",
		"API_LOG_CLEANUP_BATCH_SIZE",
		"API_LOG_CLEANUP_MAX_BATCHES",
		"READY_TIMEOUT_SECONDS",
		"WORKER_HEARTBEAT_SECONDS",
		"WORKER_HEARTBEAT_MAX_AGE_SECONDS",
		"GO_JOBS_HEARTBEAT_SECONDS",
		"GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS",
	)
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	t.Setenv("ALL_MAIL_STATE_DIR", t.TempDir())
	t.Setenv("GO_JOBS_HEARTBEAT_SECONDS", "1")
	cfg, err := LoadRetention()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RetentionDays != 30 || cfg.Interval != time.Hour || cfg.Retry != 30*time.Second || cfg.RunTimeout != time.Minute || cfg.BatchSize != 5000 || cfg.MaxBatches != 10 || cfg.ReadyTimeout != 5*time.Second {
		t.Fatalf("Retention defaults = %#v", cfg)
	}
	if cfg.HeartbeatInterval != 15*time.Second {
		t.Fatalf("legacy heartbeat alias affected retention: %#v", cfg)
	}

	t.Setenv("API_LOG_CLEANUP_RETRY_SECONDS", "0")
	if _, err := LoadRetention(); err == nil {
		t.Fatal("LoadRetention() expected retry validation error")
	}

	t.Setenv("API_LOG_CLEANUP_RETRY_SECONDS", "3600")
	if _, err := LoadRetention(); err == nil {
		t.Fatal("LoadRetention() accepted retry equal to the normal interval")
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
