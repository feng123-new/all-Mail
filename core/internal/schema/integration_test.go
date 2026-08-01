package schema_test

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/initialize"
	"github.com/feng123-new/all-Mail/core/internal/schema"
	"github.com/jackc/pgx/v5"
)

func TestGoSchemaInitializationMatrix(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_SCHEMA_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_SCHEMA_TEST_DATABASE_URL is not configured")
	}
	migrationDirectory := os.Getenv("ALL_MAIL_MIGRATION_DIR")
	if migrationDirectory == "" {
		t.Fatal("ALL_MAIL_MIGRATION_DIR is required")
	}
	cfg := config.MigrationConfig{DatabaseURL: databaseURL, Directory: migrationDirectory}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	t.Run("concurrent fresh initialization", func(t *testing.T) {
		resetDatabase(t, databaseURL)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		var waitGroup sync.WaitGroup
		errors := make(chan error, 2)
		for range 2 {
			waitGroup.Add(1)
			go func() {
				defer waitGroup.Done()
				errors <- initialize.SchemaOnly(ctx, cfg, logger)
			}()
		}
		waitGroup.Wait()
		close(errors)
		for err := range errors {
			if err != nil {
				t.Fatal(err)
			}
		}
		assertScalar(t, databaseURL, `SELECT count(*)::text FROM allmail_schema_migrations`, "18")
	})

	t.Run("Prisma ledger adoption", func(t *testing.T) {
		resetDatabase(t, databaseURL)
		runSchemaOnly(t, cfg, logger)
		execSQL(t, databaseURL, `DROP TABLE allmail_schema_migrations`)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := schema.ApplyPrismaHistory(ctx, databaseURL, logger); err != nil {
			t.Fatal(err)
		}
		assertScalar(t, databaseURL, `SELECT count(*)::text FROM allmail_schema_migrations WHERE outcome = 'adopted-prisma-ledger'`, "14")
	})

	t.Run("empty Prisma ledger catalog adoption", func(t *testing.T) {
		resetDatabase(t, databaseURL)
		runSchemaOnly(t, cfg, logger)
		execSQL(t, databaseURL, `DROP TABLE allmail_schema_migrations; DROP TABLE runtime_migrations; TRUNCATE TABLE _prisma_migrations`)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := schema.ApplyPrismaHistory(ctx, databaseURL, logger); err != nil {
			t.Fatal(err)
		}
		assertScalar(t, databaseURL, `SELECT count(*)::text FROM allmail_schema_migrations WHERE outcome = 'adopted-catalog'`, "14")
	})

	t.Run("business type drift rejection", func(t *testing.T) {
		resetDatabase(t, databaseURL)
		runSchemaOnly(t, cfg, logger)
		execSQL(t, databaseURL, `
			DROP TABLE allmail_schema_migrations;
			DROP TABLE runtime_migrations;
			DROP TABLE _prisma_migrations;
			ALTER TABLE admins ALTER COLUMN email TYPE varchar(101)
		`)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		err := schema.ApplyPrismaHistory(ctx, databaseURL, logger)
		if err == nil || !strings.Contains(err.Error(), "business schema fingerprint mismatch") {
			t.Fatalf("type drift error = %v", err)
		}
		assertScalar(t, databaseURL, `SELECT (to_regclass('allmail_schema_migrations') IS NULL)::text`, "true")
	})

	t.Run("send approval data drift rejection", func(t *testing.T) {
		resetDatabase(t, databaseURL)
		runSchemaOnly(t, cfg, logger)
		execSQL(t, databaseURL, `
			INSERT INTO admins (username, password_hash, role, status, must_change_password, created_at, updated_at)
			VALUES ('schema-test-admin', 'fixture', 'SUPER_ADMIN', 'ACTIVE', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
			INSERT INTO domains (name, status, can_receive, can_send, send_approved, created_by_admin_id, created_at, updated_at)
			SELECT 'schema-test.example', 'ACTIVE', true, true, false, id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
			FROM admins WHERE username = 'schema-test-admin';
			DROP TABLE allmail_schema_migrations;
			DROP TABLE runtime_migrations;
			DROP TABLE _prisma_migrations
		`)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		err := schema.ApplyPrismaHistory(ctx, databaseURL, logger)
		if err == nil || !strings.Contains(err.Error(), "postcondition is not satisfied") {
			t.Fatalf("send approval drift error = %v", err)
		}
	})

	t.Run("runtime index drift rejection", func(t *testing.T) {
		resetDatabase(t, databaseURL)
		runSchemaOnly(t, cfg, logger)
		execSQL(t, databaseURL, `DROP INDEX outbound_delivery_jobs_claim_idx`)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		err := schema.AdoptRuntimeLedger(ctx, databaseURL, migrationDirectory)
		if err == nil || !strings.Contains(err.Error(), "runtime schema fingerprint mismatch") {
			t.Fatalf("runtime drift error = %v", err)
		}
	})

	t.Run("environment import backfills OAuth authority", func(t *testing.T) {
		resetDatabase(t, databaseURL)
		runSchemaOnly(t, cfg, logger)
		execSQL(t, databaseURL, `
			INSERT INTO email_accounts (
				email, provider, auth_type, client_id, status, created_at, updated_at
			) VALUES (
				'authority@example.test', 'OUTLOOK', 'MICROSOFT_OAUTH', 'authority-client', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
			)
		`)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		_, err := initialize.ImportEnvironment(ctx, databaseURL, "0123456789abcdef0123456789abcdef", map[string]string{
			"MICROSOFT_OAUTH_CLIENT_ID":     "authority-client",
			"MICROSOFT_OAUTH_CLIENT_SECRET": "authority-secret",
			"MICROSOFT_OAUTH_REDIRECT_URI":  "https://example.test/oauth",
			"MICROSOFT_OAUTH_TENANT":        "organizations",
			"MICROSOFT_OAUTH_SCOPES":        "openid offline_access",
		})
		if err != nil {
			t.Fatal(err)
		}
		assertScalar(t, databaseURL, `
			SELECT concat(provider_config->>'oauthTenant', '|', provider_config->>'oauthScopes')
			FROM email_accounts WHERE email = 'authority@example.test'
		`, "organizations|openid offline_access")
	})
}

func runSchemaOnly(t *testing.T, cfg config.MigrationConfig, logger *slog.Logger) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := initialize.SchemaOnly(ctx, cfg, logger); err != nil {
		t.Fatal(err)
	}
}

func resetDatabase(t *testing.T, databaseURL string) {
	t.Helper()
	execSQL(t, databaseURL, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`)
}

func execSQL(t *testing.T, databaseURL, statement string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(context.Background())
	if _, err := connection.Exec(ctx, statement); err != nil {
		t.Fatal(err)
	}
}

func assertScalar(t *testing.T, databaseURL, query, expected string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(context.Background())
	var actual string
	if err := connection.QueryRow(ctx, query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("scalar = %q, want %q", actual, expected)
	}
}
