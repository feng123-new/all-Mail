package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type APIMode string

type RuntimeOwner string

const (
	APIModeBridge APIMode = "bridge"
	APIModeStatic APIMode = "static"

	RuntimeOwnerLegacy   RuntimeOwner = "legacy"
	RuntimeOwnerGo       RuntimeOwner = "go"
	RuntimeOwnerDisabled RuntimeOwner = "disabled"
)

// Config contains runtime settings shared by the API, jobs, migration and
// doctor commands. Existing all-Mail variable names are kept where they are
// still part of the migration contract.
type Config struct {
	Environment           string
	APIMode               APIMode
	Port                  int
	StaticDir             string
	StateDir              string
	LegacyAPIURL          string
	DatabaseURL           string
	RedisURL              string
	EncryptionKey         string
	ReadyTimeout          time.Duration
	ShutdownTimeout       time.Duration
	JobsHeartbeatInterval time.Duration
	JobsHeartbeatMaxAge   time.Duration
	ForwardingWorkerOwner RuntimeOwner
	ForwardingInterval    time.Duration
	ForwardingRunTimeout  time.Duration
	ForwardingBatchSize   int
	ResendAPIBaseURL      string
	MigrationDir          string
	LogRetentionOwner     RuntimeOwner
	APILogRetentionDays   int
	APILogCleanupInterval time.Duration
	APILogCleanupRetry    time.Duration
	APILogCleanupTimeout  time.Duration
	APILogCleanupBatch    int
}

func Load() (Config, error) {
	port, err := envInt("PORT", 3000)
	if err != nil {
		return Config{}, err
	}
	readySeconds, err := envInt("READY_TIMEOUT_SECONDS", 5)
	if err != nil {
		return Config{}, err
	}
	shutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)
	if err != nil {
		return Config{}, err
	}
	heartbeatSeconds, err := envInt("GO_JOBS_HEARTBEAT_SECONDS", 15)
	if err != nil {
		return Config{}, err
	}
	heartbeatMaxAgeSeconds, err := envInt("GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS", 90)
	if err != nil {
		return Config{}, err
	}
	forwardingSeconds, err := envInt("FORWARDING_WORKER_INTERVAL_SECONDS", 30)
	if err != nil {
		return Config{}, err
	}
	forwardingRunTimeoutSeconds, err := envInt("FORWARDING_RUN_TIMEOUT_SECONDS", 120)
	if err != nil {
		return Config{}, err
	}
	forwardingBatchSize, err := envInt("FORWARDING_WORKER_BATCH_SIZE", 10)
	if err != nil {
		return Config{}, err
	}
	retentionDays, err := envInt("API_LOG_RETENTION_DAYS", 30)
	if err != nil {
		return Config{}, err
	}
	stateDir := env("ALL_MAIL_STATE_DIR", "/var/lib/all-mail")
	secretStateDir := env("ALL_MAIL_SECRET_STATE_DIR", stateDir)
	encryptionKey := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY"))
	if encryptionKey == "" {
		if encryptionKeyFile := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY_FILE")); encryptionKeyFile != "" {
			content, readErr := os.ReadFile(encryptionKeyFile)
			if readErr == nil {
				encryptionKey = strings.TrimSpace(string(content))
			}
		} else {
			encryptionKey = managedSecret(secretStateDir, "ENCRYPTION_KEY")
		}
	}
	cleanupMinutes, err := envInt("API_LOG_CLEANUP_INTERVAL_MINUTES", 60)
	if err != nil {
		return Config{}, err
	}
	cleanupRetrySeconds, err := envInt("API_LOG_CLEANUP_RETRY_SECONDS", 30)
	if err != nil {
		return Config{}, err
	}
	cleanupTimeoutSeconds, err := envInt("API_LOG_CLEANUP_TIMEOUT_SECONDS", 60)
	if err != nil {
		return Config{}, err
	}
	cleanupBatch, err := envInt("API_LOG_CLEANUP_BATCH_SIZE", 5000)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		Environment:           env("ALL_MAIL_ENV", env("NODE_ENV", "development")),
		APIMode:               APIMode(strings.ToLower(env("GO_API_MODE", string(APIModeBridge)))),
		Port:                  port,
		StaticDir:             env("ALL_MAIL_STATIC_DIR", "/app/public"),
		StateDir:              stateDir,
		LegacyAPIURL:          strings.TrimSpace(os.Getenv("LEGACY_API_URL")),
		DatabaseURL:           strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RedisURL:              strings.TrimSpace(os.Getenv("REDIS_URL")),
		EncryptionKey:         encryptionKey,
		ReadyTimeout:          time.Duration(readySeconds) * time.Second,
		ShutdownTimeout:       time.Duration(shutdownSeconds) * time.Second,
		JobsHeartbeatInterval: time.Duration(heartbeatSeconds) * time.Second,
		JobsHeartbeatMaxAge:   time.Duration(heartbeatMaxAgeSeconds) * time.Second,
		ForwardingWorkerOwner: RuntimeOwner(strings.ToLower(env("FORWARDING_WORKER_OWNER", string(RuntimeOwnerLegacy)))),
		ForwardingInterval:    time.Duration(forwardingSeconds) * time.Second,
		ForwardingRunTimeout:  time.Duration(forwardingRunTimeoutSeconds) * time.Second,
		ForwardingBatchSize:   forwardingBatchSize,
		ResendAPIBaseURL:      strings.TrimRight(env("RESEND_API_BASE_URL", "https://api.resend.com"), "/"),
		MigrationDir:          env("ALL_MAIL_MIGRATION_DIR", "/app/migrations"),
		LogRetentionOwner:     RuntimeOwner(strings.ToLower(env("API_LOG_RETENTION_OWNER", string(RuntimeOwnerLegacy)))),
		APILogRetentionDays:   retentionDays,
		APILogCleanupInterval: time.Duration(cleanupMinutes) * time.Minute,
		APILogCleanupRetry:    time.Duration(cleanupRetrySeconds) * time.Second,
		APILogCleanupTimeout:  time.Duration(cleanupTimeoutSeconds) * time.Second,
		APILogCleanupBatch:    cleanupBatch,
	}

	if cfg.Port < 1 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("PORT must be between 1 and 65535")
	}
	if cfg.ReadyTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return Config{}, errors.New("runtime timeouts must be positive")
	}
	if cfg.JobsHeartbeatInterval <= 0 || cfg.JobsHeartbeatMaxAge <= 0 {
		return Config{}, errors.New("jobs heartbeat durations must be positive")
	}
	if cfg.ForwardingInterval <= 0 {
		return Config{}, errors.New("FORWARDING_WORKER_INTERVAL_SECONDS must be positive")
	}
	if cfg.ForwardingRunTimeout <= 0 {
		return Config{}, errors.New("FORWARDING_RUN_TIMEOUT_SECONDS must be positive")
	}
	if cfg.ForwardingBatchSize < 1 || cfg.ForwardingBatchSize > 100 {
		return Config{}, errors.New("FORWARDING_WORKER_BATCH_SIZE must be between 1 and 100")
	}
	if cfg.ForwardingWorkerOwner != RuntimeOwnerLegacy && cfg.ForwardingWorkerOwner != RuntimeOwnerGo && cfg.ForwardingWorkerOwner != RuntimeOwnerDisabled {
		return Config{}, fmt.Errorf("unsupported FORWARDING_WORKER_OWNER %q; use legacy, go or disabled", cfg.ForwardingWorkerOwner)
	}
	if cfg.APILogRetentionDays < 1 {
		return Config{}, errors.New("API_LOG_RETENTION_DAYS must be positive")
	}
	if cfg.APILogCleanupInterval <= 0 {
		return Config{}, errors.New("API_LOG_CLEANUP_INTERVAL_MINUTES must be positive")
	}
	if cfg.APILogCleanupRetry <= 0 {
		return Config{}, errors.New("API_LOG_CLEANUP_RETRY_SECONDS must be positive")
	}
	if cfg.APILogCleanupTimeout <= 0 {
		return Config{}, errors.New("API_LOG_CLEANUP_TIMEOUT_SECONDS must be positive")
	}
	if cfg.APILogCleanupBatch < 1 || cfg.APILogCleanupBatch > 100000 {
		return Config{}, errors.New("API_LOG_CLEANUP_BATCH_SIZE must be between 1 and 100000")
	}
	if cfg.LogRetentionOwner != RuntimeOwnerLegacy && cfg.LogRetentionOwner != RuntimeOwnerGo {
		return Config{}, fmt.Errorf("unsupported API_LOG_RETENTION_OWNER %q; use legacy or go", cfg.LogRetentionOwner)
	}
	if err := validateAbsoluteURL("LEGACY_API_URL", cfg.LegacyAPIURL, "http", "https"); err != nil {
		return Config{}, err
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return Config{}, err
	}
	if err := validateAbsoluteURL("REDIS_URL", cfg.RedisURL, "redis", "rediss"); err != nil {
		return Config{}, err
	}
	if err := validateAbsoluteURL("RESEND_API_BASE_URL", cfg.ResendAPIBaseURL, "http", "https"); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) ValidateFor(command string) error {
	switch command {
	case "api":
		switch c.APIMode {
		case APIModeBridge:
			missing := make([]string, 0, 3)
			if c.LegacyAPIURL == "" {
				missing = append(missing, "LEGACY_API_URL")
			}
			if c.DatabaseURL == "" {
				missing = append(missing, "DATABASE_URL")
			}
			if c.RedisURL == "" {
				missing = append(missing, "REDIS_URL")
			}
			if len(missing) > 0 {
				return fmt.Errorf("GO_API_MODE=bridge requires %s", strings.Join(missing, ", "))
			}
		case APIModeStatic:
			if strings.TrimSpace(c.StaticDir) == "" {
				return errors.New("GO_API_MODE=static requires ALL_MAIL_STATIC_DIR")
			}
		default:
			return fmt.Errorf("unsupported GO_API_MODE %q; use bridge or static", c.APIMode)
		}
	case "jobs":
		if strings.TrimSpace(c.StateDir) == "" {
			return errors.New("ALL_MAIL_STATE_DIR is required for jobs")
		}
		if (c.LogRetentionOwner == RuntimeOwnerGo || c.ForwardingWorkerOwner == RuntimeOwnerGo) && c.DatabaseURL == "" {
			return errors.New("DATABASE_URL is required when a Go jobs worker owns database work")
		}
		if c.ForwardingWorkerOwner == RuntimeOwnerGo && c.EncryptionKey == "" {
			return errors.New("ENCRYPTION_KEY is required when FORWARDING_WORKER_OWNER=go")
		}
	case "migrate":
		if c.DatabaseURL == "" {
			return errors.New("DATABASE_URL is required for migrations")
		}
		if strings.TrimSpace(c.MigrationDir) == "" {
			return errors.New("ALL_MAIL_MIGRATION_DIR is required for migrations")
		}
	default:
		return fmt.Errorf("unknown runtime command %q", command)
	}
	return nil
}

func (c Config) Address() string {
	return fmt.Sprintf(":%d", c.Port)
}

func (c Config) LegacyURL() (*url.URL, error) {
	if c.LegacyAPIURL == "" {
		return nil, errors.New("LEGACY_API_URL is not configured")
	}
	return url.Parse(c.LegacyAPIURL)
}

func validateAbsoluteURL(name, raw string, schemes ...string) error {
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s must be an absolute URL", name)
	}
	for _, scheme := range schemes {
		if parsed.Scheme == scheme {
			return nil
		}
	}
	return fmt.Errorf("%s must use one of these schemes: %s", name, strings.Join(schemes, ", "))
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer: %w", name, err)
	}
	return value, nil
}

func managedSecret(stateDir, name string) string {
	content, err := os.ReadFile(filepath.Join(stateDir, "bootstrap-secrets.env"))
	if err != nil {
		return ""
	}
	for _, rawLine := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 && strings.TrimSpace(parts[0]) == name {
			return strings.Trim(strings.TrimSpace(parts[1]), "\"'")
		}
	}
	return ""
}
