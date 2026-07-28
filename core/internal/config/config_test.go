package config

import "testing"

func TestLoadDefaults(t *testing.T) {
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
}

func TestLoadRejectsInvalidLegacyURL(t *testing.T) {
	t.Setenv("LEGACY_API_URL", "not-a-url")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}

func TestLoadRejectsWrongDatabaseScheme(t *testing.T) {
	t.Setenv("DATABASE_URL", "http://127.0.0.1:5432/database")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}

func TestBridgeValidationRequiresAllDependencies(t *testing.T) {
	cfg := Config{APIMode: APIModeBridge}
	if err := cfg.ValidateFor("api"); err == nil {
		t.Fatal("ValidateFor(api) expected an error")
	}
}

func TestStaticValidationDoesNotRequireLegacy(t *testing.T) {
	cfg := Config{APIMode: APIModeStatic, StaticDir: t.TempDir()}
	if err := cfg.ValidateFor("api"); err != nil {
		t.Fatalf("ValidateFor(api) error = %v", err)
	}
}
