package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

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

func TestLoadGoBusinessAPIRequiresDatabaseAndJWTFile(t *testing.T) {
	clearEnv(t,
		"PORT",
		"DATABASE_URL",
		"REDIS_URL",
		"JWT_SECRET_FILE",
		"READY_TIMEOUT_SECONDS",
		"GO_BUSINESS_QUERY_TIMEOUT_SECONDS",
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
	if cfg.Port != 3200 || cfg.ReadyTimeout != 5*time.Second || cfg.QueryTimeout != 10*time.Second || cfg.ShutdownTimeout != 15*time.Second {
		t.Fatalf("Go business defaults = %#v", cfg)
	}
	if cfg.JWTSecret != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("JWT secret = %q", cfg.JWTSecret)
	}
}

func TestLoadGoBusinessAPIRejectsUnsafeValues(t *testing.T) {
	secretFile := filepath.Join(t.TempDir(), "jwt-secret")
	if err := os.WriteFile(secretFile, []byte("too-short\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JWT_SECRET_FILE", secretFile)
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
}
