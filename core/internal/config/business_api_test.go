package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

type jwtDurationVectors struct {
	Valid []struct {
		Value   string `json:"value"`
		Seconds int64  `json:"seconds"`
	} `json:"valid"`
	Invalid []string `json:"invalid"`
}

func TestParseJWTLifetimeUsesSharedCompatibilityVectors(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test file path")
	}
	content, err := os.ReadFile(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", "config", "jwt-duration-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vectors jwtDurationVectors
	if err := json.Unmarshal(content, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Valid {
		t.Run("valid="+vector.Value, func(t *testing.T) {
			duration, err := parseJWTLifetime(vector.Value)
			if err != nil || duration != time.Duration(vector.Seconds)*time.Second {
				t.Fatalf("parseJWTLifetime(%q) = %v, %v", vector.Value, duration, err)
			}
		})
	}
	for _, value := range vectors.Invalid {
		t.Run("invalid="+value, func(t *testing.T) {
			if _, err := parseJWTLifetime(value); err == nil {
				t.Fatalf("parseJWTLifetime(%q) succeeded", value)
			}
		})
	}
}

func TestLoadGoBusinessAPIURL(t *testing.T) {
	t.Setenv(goBusinessAPIURLEnvironment, "")
	if _, err := LoadGoBusinessAPIURL(); err == nil {
		t.Fatal("LoadGoBusinessAPIURL() accepted a missing URL")
	}

	t.Setenv(goBusinessAPIURLEnvironment, "http://go-business-api:3200")
	value, err := LoadGoBusinessAPIURL()
	if err != nil {
		t.Fatal(err)
	}
	if value != "http://go-business-api:3200" {
		t.Fatalf("URL = %q", value)
	}

	t.Setenv(goBusinessAPIURLEnvironment, "file:///tmp/socket")
	if _, err := LoadGoBusinessAPIURL(); err == nil {
		t.Fatal("LoadGoBusinessAPIURL() accepted a non-HTTP URL")
	}
}

func TestLoadGoBusinessAPIRequiresDatabaseAndSecretFiles(t *testing.T) {
	clearEnv(t,
		"NODE_ENV",
		"PORT",
		"DATABASE_URL",
		"REDIS_URL",
		"JWT_SECRET_FILE",
		"ENCRYPTION_KEY_FILE",
		"INGRESS_ALLOWED_SKEW_SECONDS",
		"ADMIN_2FA_WINDOW",
		"JWT_EXPIRES_IN",
		"ADMIN_LOGIN_MAX_ATTEMPTS",
		"ADMIN_LOGIN_LOCK_MINUTES",
		"BOOTSTRAP_ADMIN_SECRET_FILE",
		"READY_TIMEOUT_SECONDS",
		"GO_BUSINESS_QUERY_TIMEOUT_SECONDS",
		"MAIL_PROVIDER_TIMEOUT_SECONDS",
		"SHUTDOWN_TIMEOUT_SECONDS",
	)
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a missing JWT secret file")
	}

	secretFile := filepath.Join(t.TempDir(), "jwt-secret")
	if err := os.WriteFile(secretFile, []byte("0123456789abcdef0123456789abcdef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JWT_SECRET_FILE", secretFile)
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a missing encryption-key file")
	}

	encryptionFile := filepath.Join(t.TempDir(), "encryption-key")
	if err := os.WriteFile(encryptionFile, []byte("abcdef0123456789abcdef0123456789\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENCRYPTION_KEY_FILE", encryptionFile)
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a missing database URL")
	}

	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a missing Redis URL")
	}
	t.Setenv("REDIS_URL", "redis://redis:6379")
	cfg, err := LoadGoBusinessAPI()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 3200 || cfg.ReadyTimeout != 5*time.Second || cfg.QueryTimeout != 10*time.Second ||
		cfg.ProviderTimeout != 5*time.Minute || cfg.ShutdownTimeout != 15*time.Second || cfg.IngressAllowedSkew != 5*time.Minute ||
		cfg.Admin2FAWindow != 1 || cfg.JWTLifetime != 2*time.Hour || cfg.AdminLoginMaxAttempts != 5 || cfg.AdminLoginLockDuration != 15*time.Minute ||
		cfg.BootstrapAdminFile != "/var/lib/all-mail/bootstrap-admin.env" || cfg.SecureCookies {
		t.Fatalf("Go business defaults = %#v", cfg)
	}
	if cfg.JWTSecret != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("JWT secret = %q", cfg.JWTSecret)
	}
	if cfg.EncryptionKey != "abcdef0123456789abcdef0123456789" {
		t.Fatalf("encryption key = %q", cfg.EncryptionKey)
	}
	for raw, expected := range map[string]time.Duration{
		"7200": 2 * time.Hour,
		"2h":   2 * time.Hour,
		"1d":   24 * time.Hour,
	} {
		t.Run("JWT_EXPIRES_IN="+raw, func(t *testing.T) {
			t.Setenv("JWT_EXPIRES_IN", raw)
			parsed, err := LoadGoBusinessAPI()
			if err != nil || parsed.JWTLifetime != expected {
				t.Fatalf("JWT lifetime for %q = %v, %v", raw, parsed.JWTLifetime, err)
			}
		})
	}
	t.Setenv("JWT_EXPIRES_IN", "2h")
	t.Setenv("NODE_ENV", "production")
	cfg, err = LoadGoBusinessAPI()
	if err != nil || !cfg.SecureCookies {
		t.Fatalf("production cookie config = %#v, %v", cfg, err)
	}
}

func TestLoadGoBusinessAPIRejectsUnsafeValues(t *testing.T) {
	secretFile := filepath.Join(t.TempDir(), "jwt-secret")
	encryptionFile := filepath.Join(t.TempDir(), "encryption-key")
	if err := os.WriteFile(secretFile, []byte("too-short\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(encryptionFile, []byte("abcdef0123456789abcdef0123456789\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JWT_SECRET_FILE", secretFile)
	t.Setenv("ENCRYPTION_KEY_FILE", encryptionFile)
	t.Setenv("DATABASE_URL", "postgresql://user:password@postgres/allmail")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a short JWT secret")
	}

	if err := os.WriteFile(secretFile, []byte("0123456789abcdef0123456789abcdef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REDIS_URL", "http://redis:6379")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a non-Redis URL")
	}
	t.Setenv("REDIS_URL", "redis://redis:6379")
	t.Setenv("GO_BUSINESS_QUERY_TIMEOUT_SECONDS", "0")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a zero query timeout")
	}
	t.Setenv("GO_BUSINESS_QUERY_TIMEOUT_SECONDS", "10")
	t.Setenv("MAIL_PROVIDER_TIMEOUT_SECONDS", "0")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a zero provider timeout")
	}
	t.Setenv("MAIL_PROVIDER_TIMEOUT_SECONDS", "300")
	t.Setenv("INGRESS_ALLOWED_SKEW_SECONDS", "3601")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted an excessive ingress signature window")
	}
	t.Setenv("INGRESS_ALLOWED_SKEW_SECONDS", "300")
	t.Setenv("ADMIN_2FA_WINDOW", "6")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted an excessive TOTP window")
	}
	t.Setenv("ADMIN_2FA_WINDOW", "1")
	t.Setenv("JWT_EXPIRES_IN", "not-a-duration")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted an invalid JWT lifetime")
	}
	t.Setenv("JWT_EXPIRES_IN", "2h")
	t.Setenv("ADMIN_LOGIN_MAX_ATTEMPTS", "0")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted zero login attempts")
	}
	t.Setenv("ADMIN_LOGIN_MAX_ATTEMPTS", "5")
	t.Setenv("ADMIN_LOGIN_LOCK_MINUTES", "0")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted a zero login lock duration")
	}
	t.Setenv("ADMIN_LOGIN_LOCK_MINUTES", "15")
	t.Setenv("NODE_ENV", "staging")
	if _, err := LoadGoBusinessAPI(); err == nil {
		t.Fatal("LoadGoBusinessAPI() accepted an unsupported runtime environment")
	}
}
