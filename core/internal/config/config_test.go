package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("LEGACY_API_URL", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Port != 3000 {
		t.Fatalf("Port = %d, want 3000", cfg.Port)
	}
}

func TestLoadRejectsInvalidLegacyURL(t *testing.T) {
	t.Setenv("LEGACY_API_URL", "not-a-url")
	if _, err := Load(); err == nil {
		t.Fatal("Load() expected an error")
	}
}
