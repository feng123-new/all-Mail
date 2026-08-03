package initialize

import (
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"
)

var retiredEnvironmentVariables = []string{
	"ADMIN_2FA_SECRET",
	"ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR",
	"ALL_MAIL_ENV",
	"ALL_MAIL_ENV_FILE",
	"ALL_MAIL_LEGACY_IMAGE",
	"ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD",
	"ALL_MAIL_PUBLIC_BASE_URL",
	"ALL_MAIL_SECRET_STATE_DIR",
	"ALLOW_LOCAL_RATE_LIMIT_FALLBACK",
	"API_LOG_RETENTION_OWNER",
	"APP_INTERNAL_PORT",
	"CORS_ORIGIN",
	"DOMAIN_BOOTSTRAP_ADMIN_PASSWORD",
	"DOMAIN_BOOTSTRAP_ADMIN_USERNAME",
	"FORWARDING_WORKER_OWNER",
	"GO_API_MODE",
	"GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS",
	"GO_JOBS_HEARTBEAT_SECONDS",
	"LEGACY_API_INTERNAL_PORT",
	"LEGACY_API_URL",
	"NODE_ENV",
	"POSTGRES_HOST",
	"POSTGRES_INTERNAL_PORT",
	"POSTGRES_PORT",
	"POSTGRES_PUBLISH_HOST",
	"REDIS_HOST",
	"REDIS_INTERNAL_PORT",
	"REDIS_PORT",
	"REDIS_PUBLISH_HOST",
}

var weakDatabasePasswords = map[string]struct{}{
	"admin": {}, "allmail": {}, "allmail_dev_password": {}, "changeme": {}, "password": {}, "postgres": {},
}

func validatePreflight(cfg Config) error {
	if strings.TrimSpace(cfg.StateDir) == "" || filepath.Clean(cfg.StateDir) == string(filepath.Separator) {
		return fmt.Errorf("unsafe runtime state directory %q", cfg.StateDir)
	}
	if strings.ToLower(strings.TrimSpace(cfg.Environment["ALL_MAIL_RUNTIME_ENV"])) != "production" {
		return nil
	}
	for _, name := range retiredEnvironmentVariables {
		if _, exists := cfg.Environment[name]; exists {
			return fmt.Errorf("%s is retired and must be removed from the production environment", name)
		}
	}
	databaseURL, err := requireAbsoluteURL("DATABASE_URL", cfg.Migration.DatabaseURL, "postgres", "postgresql")
	if err != nil {
		return err
	}
	if databaseURL.User == nil || strings.TrimSpace(databaseURL.User.Username()) == "" {
		return errors.New("DATABASE_URL must include a database username")
	}
	password, present := databaseURL.User.Password()
	if !present || len(password) < 24 {
		return errors.New("the PostgreSQL password must contain at least 24 URL-safe characters")
	}
	if !isURLSafeSecret(password) {
		return errors.New("the PostgreSQL password must use only letters, numbers, underscore, or hyphen")
	}
	if _, weak := weakDatabasePasswords[strings.ToLower(password)]; weak || hasPlaceholderPrefix(strings.ToLower(password)) {
		return errors.New("the PostgreSQL password is a known weak or placeholder value")
	}
	if databaseURL.Path == "" || databaseURL.Path == "/" {
		return errors.New("DATABASE_URL must include a database name")
	}
	if raw := strings.TrimSpace(cfg.Environment["PUBLIC_BASE_URL"]); raw != "" {
		publicURL, err := requireAbsoluteURL("PUBLIC_BASE_URL", raw, "http", "https")
		if err != nil {
			return err
		}
		if publicURL.User != nil {
			return errors.New("PUBLIC_BASE_URL must not contain credentials")
		}
	}
	if value := strings.TrimSpace(cfg.Environment["JWT_SECRET"]); value != "" && (len(value) < 32 || hasPlaceholderPrefix(strings.ToLower(value))) {
		return errors.New("JWT_SECRET must contain at least 32 non-placeholder characters when explicitly configured")
	}
	if value := strings.TrimSpace(cfg.Environment["ENCRYPTION_KEY"]); value != "" && (len(value) != 32 || hasPlaceholderPrefix(strings.ToLower(value))) {
		return errors.New("ENCRYPTION_KEY must contain exactly 32 non-placeholder characters when explicitly configured")
	}
	return validateAdminPreflight(cfg.Environment)
}

func requireAbsoluteURL(name, raw string, protocols ...string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" {
		return nil, fmt.Errorf("%s must be an absolute URL", name)
	}
	for _, protocol := range protocols {
		if parsed.Scheme == protocol {
			return parsed, nil
		}
	}
	return nil, fmt.Errorf("%s must use one of these protocols: %s", name, strings.Join(protocols, ", "))
}

func validateAdminPreflight(environment map[string]string) error {
	for _, name := range []string{"ADMIN_USERNAME", "ADMIN_PASSWORD"} {
		raw := environment[name]
		if strings.ContainsAny(raw, "\r\n") {
			return fmt.Errorf("%s must not contain line breaks", name)
		}
		value := strings.TrimSpace(raw)
		if value != "" && (strings.HasPrefix(value, "'") || strings.HasPrefix(value, "\"") || strings.HasSuffix(value, "'") || strings.HasSuffix(value, "\"")) {
			return fmt.Errorf("%s must not start or end with a quote", name)
		}
	}
	username := strings.TrimSpace(environment["ADMIN_USERNAME"])
	password := strings.TrimSpace(environment["ADMIN_PASSWORD"])
	if username != "" && !hasPlaceholderPrefix(strings.ToLower(username)) && len(username) > 50 {
		return errors.New("ADMIN_USERNAME must contain at most 50 characters")
	}
	if password != "" && !hasPlaceholderPrefix(strings.ToLower(password)) {
		if err := passwordpolicy.Validate("ADMIN_PASSWORD", password, 8); err != nil {
			return err
		}
	}
	return nil
}

func isURLSafeSecret(value string) bool {
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-' {
			continue
		}
		return false
	}
	return value != ""
}
