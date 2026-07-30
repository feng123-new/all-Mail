package config

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type APIConfig struct {
	Port              int
	StaticDir         string
	BusinessAPIURL    string
	TrustedProxyCIDRs []netip.Prefix
	ReadyTimeout      time.Duration
	ShutdownTimeout   time.Duration
}

type ForwardingConfig struct {
	StateDir          string
	DatabaseURL       string
	EncryptionKey     string
	Interval          time.Duration
	RunTimeout        time.Duration
	LeaseDuration     time.Duration
	BatchSize         int
	ResendAPIBaseURL  string
	HeartbeatInterval time.Duration
	HeartbeatMaxAge   time.Duration
	ReadyTimeout      time.Duration
	ShutdownTimeout   time.Duration
}

type RetentionConfig struct {
	StateDir          string
	DatabaseURL       string
	RetentionDays     int
	Interval          time.Duration
	Retry             time.Duration
	RunTimeout        time.Duration
	BatchSize         int
	MaxBatches        int
	HeartbeatInterval time.Duration
	HeartbeatMaxAge   time.Duration
	ReadyTimeout      time.Duration
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
	trustedProxyCIDRs, err := parseTrustedProxyCIDRs(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if err != nil {
		return APIConfig{}, err
	}
	cfg := APIConfig{
		Port:              port,
		StaticDir:         env("ALL_MAIL_STATIC_DIR", "/app/public"),
		BusinessAPIURL:    strings.TrimSpace(os.Getenv("BUSINESS_API_URL")),
		TrustedProxyCIDRs: trustedProxyCIDRs,
		ReadyTimeout:      time.Duration(readySeconds) * time.Second,
		ShutdownTimeout:   time.Duration(shutdownSeconds) * time.Second,
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return APIConfig{}, errors.New("PORT must be between 1 and 65535")
	}
	if cfg.ReadyTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return APIConfig{}, errors.New("API runtime timeouts must be positive")
	}
	if strings.TrimSpace(cfg.StaticDir) == "" {
		return APIConfig{}, errors.New("ALL_MAIL_STATIC_DIR is required")
	}
	if cfg.BusinessAPIURL == "" {
		return APIConfig{}, errors.New("BUSINESS_API_URL is required until all business routes are migrated")
	}
	if err := validateAbsoluteURL("BUSINESS_API_URL", cfg.BusinessAPIURL, "http", "https"); err != nil {
		return APIConfig{}, err
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
	leaseSeconds, err := envInt("FORWARDING_LEASE_SECONDS", 180)
	if err != nil {
		return ForwardingConfig{}, err
	}
	batchSize, err := envInt("FORWARDING_WORKER_BATCH_SIZE", 10)
	if err != nil {
		return ForwardingConfig{}, err
	}
	heartbeatSeconds, err := envInt("WORKER_HEARTBEAT_SECONDS", 15)
	if err != nil {
		return ForwardingConfig{}, err
	}
	heartbeatMaxAgeSeconds, err := envInt("WORKER_HEARTBEAT_MAX_AGE_SECONDS", 90)
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
	encryptionKey, err := loadEncryptionKeyFile()
	if err != nil {
		return ForwardingConfig{}, err
	}
	cfg := ForwardingConfig{
		StateDir:          env("ALL_MAIL_STATE_DIR", "/var/lib/all-mail"),
		DatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),
		EncryptionKey:     encryptionKey,
		Interval:          time.Duration(intervalSeconds) * time.Second,
		RunTimeout:        time.Duration(runTimeoutSeconds) * time.Second,
		LeaseDuration:     time.Duration(leaseSeconds) * time.Second,
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
	if cfg.Interval <= 0 || cfg.RunTimeout <= 0 || cfg.LeaseDuration <= 0 {
		return ForwardingConfig{}, errors.New("forwarding intervals and timeouts must be positive")
	}
	if cfg.BatchSize < 1 || cfg.BatchSize > 100 {
		return ForwardingConfig{}, errors.New("FORWARDING_WORKER_BATCH_SIZE must be between 1 and 100")
	}
	if cfg.HeartbeatInterval <= 0 || cfg.HeartbeatMaxAge <= 0 || cfg.ReadyTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return ForwardingConfig{}, errors.New("forwarding runtime durations must be positive")
	}
	if cfg.HeartbeatMaxAge < 2*cfg.HeartbeatInterval {
		return ForwardingConfig{}, errors.New("WORKER_HEARTBEAT_MAX_AGE_SECONDS must be at least twice WORKER_HEARTBEAT_SECONDS")
	}
	minimumLease := cfg.RunTimeout + cfg.ShutdownTimeout + cfg.HeartbeatInterval
	if cfg.LeaseDuration < minimumLease {
		return ForwardingConfig{}, fmt.Errorf(
			"FORWARDING_LEASE_SECONDS must cover run, shutdown, and heartbeat timeouts (minimum %s)",
			minimumLease,
		)
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
	maxBatches, err := envInt("API_LOG_CLEANUP_MAX_BATCHES", 10)
	if err != nil {
		return RetentionConfig{}, err
	}
	heartbeatSeconds, err := envInt("WORKER_HEARTBEAT_SECONDS", 15)
	if err != nil {
		return RetentionConfig{}, err
	}
	heartbeatMaxAgeSeconds, err := envInt("WORKER_HEARTBEAT_MAX_AGE_SECONDS", 90)
	if err != nil {
		return RetentionConfig{}, err
	}
	readySeconds, err := envInt("READY_TIMEOUT_SECONDS", 5)
	if err != nil {
		return RetentionConfig{}, err
	}
	shutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)
	if err != nil {
		return RetentionConfig{}, err
	}
	cfg := RetentionConfig{
		StateDir:          env("ALL_MAIL_STATE_DIR", "/var/lib/all-mail"),
		DatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RetentionDays:     retentionDays,
		Interval:          time.Duration(intervalMinutes) * time.Minute,
		Retry:             time.Duration(retrySeconds) * time.Second,
		RunTimeout:        time.Duration(timeoutSeconds) * time.Second,
		BatchSize:         batchSize,
		MaxBatches:        maxBatches,
		HeartbeatInterval: time.Duration(heartbeatSeconds) * time.Second,
		HeartbeatMaxAge:   time.Duration(heartbeatMaxAgeSeconds) * time.Second,
		ReadyTimeout:      time.Duration(readySeconds) * time.Second,
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
	if cfg.MaxBatches < 1 || cfg.MaxBatches > 100 {
		return RetentionConfig{}, errors.New("API_LOG_CLEANUP_MAX_BATCHES must be between 1 and 100")
	}
	if cfg.HeartbeatInterval <= 0 || cfg.HeartbeatMaxAge <= 0 || cfg.ReadyTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return RetentionConfig{}, errors.New("retention runtime durations must be positive")
	}
	if cfg.HeartbeatMaxAge < 2*cfg.HeartbeatInterval {
		return RetentionConfig{}, errors.New("WORKER_HEARTBEAT_MAX_AGE_SECONDS must be at least twice WORKER_HEARTBEAT_SECONDS")
	}
	if cfg.Retry >= cfg.Interval {
		return RetentionConfig{}, errors.New("API_LOG_CLEANUP_RETRY_SECONDS must be shorter than API_LOG_CLEANUP_INTERVAL_MINUTES")
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

func (c APIConfig) BusinessURL() (*url.URL, error) {
	if c.BusinessAPIURL == "" {
		return nil, errors.New("BUSINESS_API_URL is not configured")
	}
	return url.Parse(c.BusinessAPIURL)
}

func (c APIConfig) TrustsProxy(address netip.Addr) bool {
	for _, prefix := range c.TrustedProxyCIDRs {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

func loadEncryptionKeyFile() (string, error) {
	keyFile := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY_FILE"))
	if keyFile == "" {
		return "", errors.New("ENCRYPTION_KEY_FILE is required for forwarding")
	}
	content, err := os.ReadFile(keyFile)
	if err != nil {
		return "", fmt.Errorf("read ENCRYPTION_KEY_FILE: %w", err)
	}
	key := strings.TrimSpace(string(content))
	if len(key) != 32 {
		return "", errors.New("ENCRYPTION_KEY_FILE must contain exactly 32 characters")
	}
	return key, nil
}

func parseTrustedProxyCIDRs(raw string) ([]netip.Prefix, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	seen := make(map[netip.Prefix]struct{})
	prefixes := make([]netip.Prefix, 0)
	for _, item := range strings.Split(raw, ",") {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXY_CIDRS contains invalid CIDR %q: %w", value, err)
		}
		prefix = prefix.Masked()
		if prefix.Bits() == 0 {
			return nil, fmt.Errorf("TRUSTED_PROXY_CIDRS must not trust all addresses with %q", value)
		}
		if _, ok := seen[prefix]; ok {
			continue
		}
		seen[prefix] = struct{}{}
		prefixes = append(prefixes, prefix)
	}
	return prefixes, nil
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
