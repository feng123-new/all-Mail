package initialize

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/migrate"
	"github.com/feng123-new/all-Mail/core/internal/schema"
	"github.com/feng123-new/all-Mail/core/internal/secretstate"
	"github.com/jackc/pgx/v5"
)

type Config struct {
	Migration               config.MigrationConfig
	StateDir                string
	BootstrapAdminFile      string
	EncryptionKeyExportFile string
	JWTSecretExportFile     string
	RedisPasswordExportFile string
	Environment             map[string]string
}

func LoadConfig() (Config, error) {
	migrationConfig, err := loadInitializerMigrationConfig()
	if err != nil {
		return Config{}, err
	}
	stateDir := strings.TrimSpace(os.Getenv("ALL_MAIL_STATE_DIR"))
	if stateDir == "" {
		stateDir = "/var/lib/all-mail"
	}
	bootstrapFile := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_SECRET_FILE"))
	if bootstrapFile == "" {
		bootstrapFile = stateDir + "/bootstrap-admin.env"
	}
	return Config{
		Migration:               migrationConfig,
		StateDir:                stateDir,
		BootstrapAdminFile:      bootstrapFile,
		EncryptionKeyExportFile: strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE")),
		JWTSecretExportFile:     strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_JWT_SECRET_FILE")),
		RedisPasswordExportFile: strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE")),
		Environment:             currentEnvironment(),
	}, nil
}

func loadInitializerMigrationConfig() (config.MigrationConfig, error) {
	if strings.TrimSpace(os.Getenv("DATABASE_URL")) != "" {
		return config.LoadMigration()
	}
	password := strings.TrimSpace(os.Getenv("POSTGRES_PASSWORD"))
	if password == "" {
		return config.MigrationConfig{}, errors.New("DATABASE_URL or POSTGRES_PASSWORD is required for initialization")
	}
	user := strings.TrimSpace(os.Getenv("POSTGRES_USER"))
	if user == "" {
		user = "allmail"
	}
	database := strings.TrimSpace(os.Getenv("POSTGRES_DB"))
	if database == "" {
		database = "allmail"
	}
	directory := strings.TrimSpace(os.Getenv("ALL_MAIL_MIGRATION_DIR"))
	if directory == "" {
		directory = "/app/migrations"
	}
	databaseURL := (&url.URL{
		Scheme: "postgresql",
		User:   url.UserPassword(user, password),
		Host:   "postgres:5432",
		Path:   "/" + database,
	}).String()
	return config.MigrationConfig{DatabaseURL: databaseURL, Directory: directory}, nil
}

func SchemaOnly(ctx context.Context, cfg config.MigrationConfig, logger *slog.Logger) error {
	if err := schema.ApplyPrismaHistory(ctx, cfg.DatabaseURL, logger); err != nil {
		return err
	}
	if err := migrate.Run(ctx, cfg, logger); err != nil {
		return err
	}
	if err := schema.AdoptRuntimeLedger(ctx, cfg.DatabaseURL, cfg.Directory); err != nil {
		return err
	}
	return nil
}

func Run(ctx context.Context, cfg Config, logger *slog.Logger) error {
	if err := validatePreflight(cfg); err != nil {
		return err
	}
	return secretstate.WithLock(cfg.StateDir, 30*time.Second, func() error {
		connection, err := pgx.Connect(ctx, cfg.Migration.DatabaseURL)
		if err != nil {
			return fmt.Errorf("connect initializer lock: %w", err)
		}
		defer connection.Close(context.Background())
		if _, err := connection.Exec(ctx, `SELECT pg_advisory_lock(421337, 240731)`); err != nil {
			return fmt.Errorf("acquire initializer database lock: %w", err)
		}
		defer connection.Exec(context.Background(), `SELECT pg_advisory_unlock(421337, 240731)`)

		existing, err := schema.HasApplicationSchema(ctx, cfg.Migration.DatabaseURL)
		if err != nil {
			return err
		}
		state, err := secretstate.Resolve(cfg.StateDir, cfg.Environment, !existing)
		if err != nil {
			return err
		}
		if cfg.BootstrapAdminFile != state.BootstrapAdminFile {
			if err := migrateBootstrapAdminSecret(state.BootstrapAdminFile, cfg.BootstrapAdminFile); err != nil {
				return err
			}
			state.BootstrapAdminFile = cfg.BootstrapAdminFile
			if err := writeRuntimeBoundaryManifest(cfg.BootstrapAdminFile); err != nil {
				return err
			}
		}
		if err := SchemaOnly(ctx, cfg.Migration, logger); err != nil {
			return err
		}
		verifiedBefore, err := VerifyCiphertexts(ctx, cfg.Migration.DatabaseURL, state.EncryptionKey)
		if err != nil {
			return err
		}
		importSummary, err := ImportEnvironment(ctx, cfg.Migration.DatabaseURL, state.EncryptionKey, cfg.Environment)
		if err != nil {
			return err
		}
		bootstrapResult, err := BootstrapAdministrator(ctx, cfg.Migration.DatabaseURL, state.BootstrapAdminFile, cfg.Environment)
		if err != nil {
			return err
		}
		verifiedAfter, err := VerifyCiphertexts(ctx, cfg.Migration.DatabaseURL, state.EncryptionKey)
		if err != nil {
			return err
		}
		if err := secretstate.Finalize(
			state,
			cfg.EncryptionKeyExportFile,
			cfg.JWTSecretExportFile,
			cfg.RedisPasswordExportFile,
		); err != nil {
			return err
		}
		logger.Info("Go initialization completed",
			"generated_runtime_secrets", state.CreatedKeys,
			"ciphertexts_verified_before", verifiedBefore,
			"ciphertexts_verified_after", verifiedAfter,
			"oauth_imported", importSummary.OAuthImported,
			"send_domains_approved", importSummary.SendApproved,
			"ingress_imported", importSummary.IngressImported,
			"administrator_created", bootstrapResult.Created,
			"administrator_username", bootstrapResult.Username,
			"administrator_requires_password_change", bootstrapResult.MustChangePassword,
		)
		return nil
	})
}

func currentEnvironment() map[string]string {
	result := make(map[string]string)
	for _, entry := range os.Environ() {
		key, value, found := strings.Cut(entry, "=")
		if found {
			result[key] = value
		}
	}
	return result
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func pointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func noRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
