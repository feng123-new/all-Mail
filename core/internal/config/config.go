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

type APIMode string

const (
	APIModeBridge APIMode = "bridge"
	APIModeStatic APIMode = "static"
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

	cfg := Config{
		Environment:           env("ALL_MAIL_ENV", env("NODE_ENV", "development")),
		APIMode:               APIMode(strings.ToLower(env("GO_API_MODE", string(APIModeBridge)))),
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
	if err := validateAbsoluteURL("LEGACY_API_URL", cfg.LegacyAPIURL, "http", "https"); err != nil {
		return Config{}, err
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return Config{}, err
	}
	if err := validateAbsoluteURL("REDIS_URL", cfg.RedisURL, "redis", "rediss"); err != nil {
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
