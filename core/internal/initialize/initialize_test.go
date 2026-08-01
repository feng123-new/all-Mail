package initialize

import (
	"net/url"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestLoadInitializerMigrationConfigBuildsComposeDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("POSTGRES_USER", "mail user")
	t.Setenv("POSTGRES_PASSWORD", "url-safe-password-1234567890")
	t.Setenv("POSTGRES_DB", "mail db")
	t.Setenv("ALL_MAIL_MIGRATION_DIR", "/app/migrations")

	cfg, err := loadInitializerMigrationConfig()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	password, _ := parsed.User.Password()
	if parsed.User.Username() != "mail user" || password != "url-safe-password-1234567890" || parsed.Host != "postgres:5432" || parsed.Path != "/mail db" {
		t.Fatalf("initializer database URL = %q", cfg.DatabaseURL)
	}
}

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
	for _, name := range retiredEnvironmentVariables {
		t.Run(name, func(t *testing.T) {
			err := validatePreflight(Config{
				Migration: config.MigrationConfig{
					DatabaseURL: "postgresql://allmail:abcdefghijklmnopqrstuvwxyz@postgres:5432/allmail",
					Directory:   "/app/migrations",
				},
				StateDir: "/var/lib/all-mail",
				Environment: map[string]string{
					"NODE_ENV": "production",
					name:       "",
				},
			})
			if err == nil {
				t.Fatalf("retired production variable %s was accepted", name)
			}
		})
	}
}
