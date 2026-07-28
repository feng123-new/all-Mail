package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config contains the runtime settings shared by the API, jobs, migration and
// doctor commands. It intentionally uses the existing all-Mail environment
// variable names so the Go control plane can be introduced without rewriting
// the operator configuration first.
type Config struct {
	Environment           string
	Port                  int
	StaticDir             string
	StateDir              string
	LegacyAPIURL          string
	DatabaseURL           string
	RedisURL              string
	ReadyTimeout          time.Duration
	ShutdownTimeout       time.Duration
	JobsHeartbeatInterval time.Duration
	JobsHeartbeatMaxAge   time.Duration
	MigrationDir          string
}

func Load() (Config, error) {
	port, err := envInt("PORT", 3000)
	if err != nil {
		return Config{}, err
	}
	readySeconds, err := envInt("READY_TIMEOUT_SECONDS", 3)
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

	cfg := Config{
		Environment:           env("ALL_MAIL_ENV", env("NODE_ENV", "development")),
		Port:                  port,
		StaticDir:             env("ALL_MAIL_STATIC_DIR", "/app/public"),
		StateDir:              env("ALL_MAIL_STATE_DIR", "/var/lib/all-mail"),
		LegacyAPIURL:          strings.TrimSpace(os.Getenv("LEGACY_API_URL")),
		DatabaseURL:           strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RedisURL:              strings.TrimSpace(os.Getenv("REDIS_URL")),
		ReadyTimeout:          time.Duration(readySeconds) * time.Second,
		ShutdownTimeout:       time.Duration(shutdownSeconds) * time.Second,
		JobsHeartbeatInterval: time.Duration(heartbeatSeconds) * time.Second,
		JobsHeartbeatMaxAge:   time.Duration(heartbeatMaxAgeSeconds) * time.Second,
		MigrationDir:          env("ALL_MAIL_MIGRATION_DIR", "/app/migrations"),
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
	if cfg.LegacyAPIURL != "" {
		parsed, parseErr := url.Parse(cfg.LegacyAPIURL)
		if parseErr != nil || parsed.Scheme == "" || parsed.Host == "" {
			return Config{}, fmt.Errorf("LEGACY_API_URL must be an absolute URL")
		}
	}
	return cfg, nil
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
