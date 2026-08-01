package initialize

import (
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestNormalizeScopesTrimsAndDeduplicatesInOrder(t *testing.T) {
	value := normalizeScopes(" scope.one  scope.two scope.one ")
	if value == nil || *value != "scope.one scope.two" {
		t.Fatalf("scopes = %#v", value)
	}
}

func TestBuildOAuthImportRequiresCompleteAbsoluteConfiguration(t *testing.T) {
	_, err := buildOAuthImport("GMAIL", map[string]string{
		"GOOGLE_OAUTH_CLIENT_ID":     "client",
		"GOOGLE_OAUTH_CLIENT_SECRET": "secret",
		"GOOGLE_OAUTH_REDIRECT_URI":  "/callback",
	})
	if err == nil {
		t.Fatal("relative OAuth redirect URI was accepted")
	}
}

func TestResolveAdminCredentialPrecedence(t *testing.T) {
	credential, err := resolveAdminCredential(
		map[string]string{"ADMIN_USERNAME": "file-admin", "ADMIN_PASSWORD": "file-password"},
		map[string]string{"ADMIN_USERNAME": "env-admin", "ADMIN_PASSWORD": "environment-password"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if credential.Username != "file-admin" || credential.Password != "file-password" {
		t.Fatalf("credential = %#v", credential)
	}
}

func TestProductionPreflightRejectsWeakDatabasePassword(t *testing.T) {
	err := validatePreflight(Config{
		Migration: config.MigrationConfig{
			DatabaseURL: "postgresql://allmail:short@postgres:5432/allmail",
			Directory:   "/app/migrations",
		},
		StateDir:    "/var/lib/all-mail",
		Environment: map[string]string{"NODE_ENV": "production"},
	})
	if err == nil {
		t.Fatal("weak production database password was accepted")
	}
}

func TestProductionPreflightRejectsRetiredVariable(t *testing.T) {
	err := validatePreflight(Config{
		Migration: config.MigrationConfig{
			DatabaseURL: "postgresql://allmail:abcdefghijklmnopqrstuvwxyz@postgres:5432/allmail",
			Directory:   "/app/migrations",
		},
		StateDir: "/var/lib/all-mail",
		Environment: map[string]string{
			"NODE_ENV":       "production",
			"LEGACY_API_URL": "",
		},
	})
	if err == nil {
		t.Fatal("retired production variable was accepted")
	}
}
