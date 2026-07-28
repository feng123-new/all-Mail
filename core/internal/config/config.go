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

const (
	APIModeBridge APIMode = "bridge"
	APIModeStatic APIMode = "static"
)

type APIConfig struct {
	Environment     string
	Mode            APIMode
	Port            int
	StaticDir       string
	LegacyAPIURL    string
	DatabaseURL     string
	RedisURL        string
	ReadyTimeout    time.Duration
	ShutdownTimeout time.Duration
}

type ForwardingConfig struct {
	Environment       string
	StateDir          string
	DatabaseURL       string
	EncryptionKey     string
	Interval          time.Duration
	RunTimeout        time.Duration
	BatchSize         int
	ResendAPIBaseURL  string
	HeartbeatInterval time.Duration
	HeartbeatMaxAge   time.Duration
	ReadyTimeout      time.Duration
	ShutdownTimeout   time.Duration
}

type RetentionConfig struct {
	Environment       string
	StateDir          string
	DatabaseURL       string
	RetentionDays     int
	Interval          time.Duration
	Retry             time.Duration
	RunTimeout        time.Duration
	BatchSize         int
	HeartbeatInterval time.Duration
	HeartbeatMaxAge   time.Duration
	ShutdownTimeout   time.Duration
}

type MigrationConfig struct {
	DatabaseURL string
	Directory   string
}

func LoadAPI() (APIConfig, error) {
	port, err := envInt("PORT", 3000)
	if err != nil {
		return APIConfig{}, err
	}
	readySeconds, err := envInt("READY_TIMEOUT_SECONDS", 5)
	if err != nil {
		return APIConfig{}, err
	}
	shutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)
	if err != nil {
		return APIConfig{}, err
	}
	cfg := APIConfig{
		Environment:     env("ALL_MAIL_ENV", env("NODE_ENV", "development")),
		Mode:            APIMode(strings.ToLower(env("GO_API_MODE", string(APIModeBridge)))),
		Port:            port,
		StaticDir:       env("ALL_MAIL_STATIC_DIR", "/app/public"),
		LegacyAPIURL:    strings.TrimSpace(os.Getenv("LEGACY_API_URL")),
		DatabaseURL:     strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RedisURL:        strings.TrimSpace(os.Getenv("REDIS_URL")),
		ReadyTimeout:    time.Duration(readySeconds) * time.Second,
		ShutdownTimeout: time.Duration(shutdownSeconds) * time.Second,
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return APIConfig{}, errors.New("PORT must be between 1 and 65535")
	}
	if cfg.ReadyTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return APIConfig{}, errors.New("API runtime timeouts must be positive")
	}
	if err := validateAbsoluteURL("LEGACY_API_URL", cfg.LegacyAPIURL, "http", "https"); err != nil {
		return APIConfig{}, err
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return APIConfig{}, err
	}
	if err := validateAbsoluteURL("REDIS_URL", cfg.RedisURL, "redis", "rediss"); err != nil {
		return APIConfig{}, err
	}
	switch cfg.Mode {
	case APIModeBridge:
		missing := make([]string, 0, 3)
		if cfg.LegacyAPIURL == "" {
			missing = append(missing, "LEGACY_API_URL")
		}
		if cfg.DatabaseURL == "" {
			missing = append(missing, "DATABASE_URL")
		}
		if cfg.RedisURL == "" {
			missing = append(missing, "REDIS_URL")
		}
		if len(missing) > 0 {
			return APIConfig{}, fmt.Errorf("GO_API_MODE=bridge requires %s", strings.Join(missing, ", "))
		}
	case APIModeStatic:
		if strings.TrimSpace(cfg.StaticDir) == "" {
			return APIConfig{}, errors.New("GO_API_MODE=static requires ALL_MAIL_STATIC_DIR")
		}
	default:
		return APIConfig{}, fmt.Errorf("unsupported GO_API_MODE %q; use bridge or static", cfg.Mode)
	}
	return cfg, nil
}

func LoadForwarding() (ForwardingConfig, error) {
	intervalSeconds, err := envInt("FORWARDING_WORKER_INTERVAL_SECONDS", 30)
	if err != nil {
		return ForwardingConfig{}, err
	}
	runTimeoutSeconds, err := envInt("FORWARDING_RUN_TIMEOUT_SECONDS", 120)
	if err != nil {
		return ForwardingConfig{}, err
	}
	batchSize, err := envInt("FORWARDING_WORKER_BATCH_SIZE", 10)
	if err != nil {
		return ForwardingConfig{}, err
	}
	heartbeatSeconds, err := envInt("WORKER_HEARTBEAT_SECONDS", envIntFallback("GO_JOBS_HEARTBEAT_SECONDS", 15))
	if err != nil {
		return ForwardingConfig{}, err
	}
	heartbeatMaxAgeSeconds, err := envInt("WORKER_HEARTBEAT_MAX_AGE_SECONDS", envIntFallback("GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS", 90))
	if err != nil {
		return ForwardingConfig{}, err
	}
	readySeconds, err := envInt("READY_TIMEOUT_SECONDS", 5)
	if err != nil {
		return ForwardingConfig{}, err
	}
	shutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)
	if err != nil {
		return ForwardingConfig{}, err
	}
	stateDir := env("ALL_MAIL_STATE_DIR", "/var/lib/all-mail")
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	secretStateDir := env("ALL_MAIL_SECRET_STATE_DIR", stateDir)
	encryptionKey := loadEncryptionKey(secretStateDir)
	cfg := ForwardingConfig{
		Environment:       env("ALL_MAIL_ENV", env("NODE_ENV", "development")),
		StateDir:          stateDir,
		DatabaseURL:       databaseURL,
		EncryptionKey:     encryptionKey,
		Interval:          time.Duration(intervalSeconds) * time.Second,
		RunTimeout:        time.Duration(runTimeoutSeconds) * time.Second,
		BatchSize:         batchSize,
		ResendAPIBaseURL:  strings.TrimRight(env("RESEND_API_BASE_URL", "https://api.resend.com"), "/"),
		HeartbeatInterval: time.Duration(heartbeatSeconds) * time.Second,
		HeartbeatMaxAge:   time.Duration(heartbeatMaxAgeSeconds) * time.Second,
		ReadyTimeout:      time.Duration(readySeconds) * time.Second,
		ShutdownTimeout:   time.Duration(shutdownSeconds) * time.Second,
	}
	if strings.TrimSpace(cfg.StateDir) == "" {
		return ForwardingConfig{}, errors.New("ALL_MAIL_STATE_DIR is required for forwarding")
	}
	if cfg.DatabaseURL == "" {
		return ForwardingConfig{}, errors.New("DATABASE_URL is required for forwarding")
	}
	if cfg.EncryptionKey == "" {
		return ForwardingConfig{}, errors.New("ENCRYPTION_KEY or ENCRYPTION_KEY_FILE is required for forwarding")
	}
	if cfg.Interval <= 0 || cfg.RunTimeout <= 0 {
		return ForwardingConfig{}, errors.New("forwarding intervals and timeouts must be positive")
	}
	if cfg.BatchSize < 1 || cfg.BatchSize > 100 {
		return ForwardingConfig{}, errors.New("FORWARDING_WORKER_BATCH_SIZE must be between 1 and 100")
	}
	if cfg.HeartbeatInterval <= 0 || cfg.HeartbeatMaxAge <= 0 || cfg.ReadyTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return ForwardingConfig{}, errors.New("forwarding runtime durations must be positive")
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return ForwardingConfig{}, err
	}
	if err := validateAbsoluteURL("RESEND_API_BASE_URL", cfg.ResendAPIBaseURL, "http", "https"); err != nil {
		return ForwardingConfig{}, err
	}
	return cfg, nil
}

func LoadRetention() (RetentionConfig, error) {
	retentionDays, err := envInt("API_LOG_RETENTION_DAYS", 30)
	if err != nil {
		return RetentionConfig{}, err
	}
	intervalMinutes, err := envInt("API_LOG_CLEANUP_INTERVAL_MINUTES", 60)
	if err != nil {
		return RetentionConfig{}, err
	}
	retrySeconds, err := envInt("API_LOG_CLEANUP_RETRY_SECONDS", 30)
	if err != nil {
		return RetentionConfig{}, err
	}
	timeoutSeconds, err := envInt("API_LOG_CLEANUP_TIMEOUT_SECONDS", 60)
	if err != nil {
		return RetentionConfig{}, err
	}
	batchSize, err := envInt("API_LOG_CLEANUP_BATCH_SIZE", 5000)
	if err != nil {
		return RetentionConfig{}, err
	}
	heartbeatSeconds, err := envInt("WORKER_HEARTBEAT_SECONDS", envIntFallback("GO_JOBS_HEARTBEAT_SECONDS", 15))
	if err != nil {
		return RetentionConfig{}, err
	}
	heartbeatMaxAgeSeconds, err := envInt("WORKER_HEARTBEAT_MAX_AGE_SECONDS", envIntFallback("GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS", 90))
	if err != nil {
		return RetentionConfig{}, err
	}
	shutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)
	if err != nil {
		return RetentionConfig{}, err
	}
	cfg := RetentionConfig{
		Environment:       env("ALL_MAIL_ENV", env("NODE_ENV", "development")),
		StateDir:          env("ALL_MAIL_STATE_DIR", "/var/lib/all-mail"),
		DatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RetentionDays:     retentionDays,
		Interval:          time.Duration(intervalMinutes) * time.Minute,
		Retry:             time.Duration(retrySeconds) * time.Second,
		RunTimeout:        time.Duration(timeoutSeconds) * time.Second,
		BatchSize:         batchSize,
		HeartbeatInterval: time.Duration(heartbeatSeconds) * time.Second,
		HeartbeatMaxAge:   time.Duration(heartbeatMaxAgeSeconds) * time.Second,
		ShutdownTimeout:   time.Duration(shutdownSeconds) * time.Second,
	}
	if strings.TrimSpace(cfg.StateDir) == "" {
		return RetentionConfig{}, errors.New("ALL_MAIL_STATE_DIR is required for retention")
	}
	if cfg.DatabaseURL == "" {
		return RetentionConfig{}, errors.New("DATABASE_URL is required for retention")
	}
	if cfg.RetentionDays < 1 || cfg.Interval <= 0 || cfg.Retry <= 0 || cfg.RunTimeout <= 0 {
		return RetentionConfig{}, errors.New("retention settings must be positive")
	}
	if cfg.BatchSize < 1 || cfg.BatchSize > 100000 {
		return RetentionConfig{}, errors.New("API_LOG_CLEANUP_BATCH_SIZE must be between 1 and 100000")
	}
	if cfg.HeartbeatInterval <= 0 || cfg.HeartbeatMaxAge <= 0 || cfg.ShutdownTimeout <= 0 {
		return RetentionConfig{}, errors.New("retention runtime durations must be positive")
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return RetentionConfig{}, err
	}
	return cfg, nil
}

func LoadMigration() (MigrationConfig, error) {
	cfg := MigrationConfig{
		DatabaseURL: strings.TrimSpace(os.Getenv("DATABASE_URL")),
		Directory:   env("ALL_MAIL_MIGRATION_DIR", "/app/migrations"),
	}
	if cfg.DatabaseURL == "" {
		return MigrationConfig{}, errors.New("DATABASE_URL is required for migrations")
	}
	if strings.TrimSpace(cfg.Directory) == "" {
		return MigrationConfig{}, errors.New("ALL_MAIL_MIGRATION_DIR is required for migrations")
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return MigrationConfig{}, err
	}
	return cfg, nil
}

func (c APIConfig) Address() string {
	return fmt.Sprintf(":%d", c.Port)
}

func (c APIConfig) LegacyURL() (*url.URL, error) {
	if c.LegacyAPIURL == "" {
		return nil, errors.New("LEGACY_API_URL is not configured")
	}
	return url.Parse(c.LegacyAPIURL)
}

func loadEncryptionKey(stateDir string) string {
	if key := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY")); key != "" {
		return key
	}
	if keyFile := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY_FILE")); keyFile != "" {
		content, err := os.ReadFile(keyFile)
		if err == nil {
			return strings.TrimSpace(string(content))
		}
		return ""
	}
	return managedSecret(stateDir, "ENCRYPTION_KEY")
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

func envIntFallback(name string, fallback int) int {
	value, err := envInt(name, fallback)
	if err != nil {
		return fallback
	}
	return value
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
