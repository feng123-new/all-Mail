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

const goBusinessAPIURLEnvironment = "GO_BUSINESS_API_URL"

type GoBusinessAPIConfig struct {
	Port                   int
	DatabaseURL            string
	RedisURL               string
	JWTSecret              string
	EncryptionKey          string
	Admin2FAWindow         int
	JWTLifetime            time.Duration
	AdminLoginMaxAttempts  int
	AdminLoginLockDuration time.Duration
	BootstrapAdminFile     string
	SecureCookies          bool
	IngressAllowedSkew     time.Duration
	ReadyTimeout           time.Duration
	QueryTimeout           time.Duration
	ProviderTimeout        time.Duration
	ShutdownTimeout        time.Duration
}

func LoadGoBusinessAPIURL() (string, error) {
	value := strings.TrimSpace(os.Getenv(goBusinessAPIURLEnvironment))
	if value == "" {
		return "", errors.New("GO_BUSINESS_API_URL is required while private Go business routes are active")
	}
	if err := validateAbsoluteURL(goBusinessAPIURLEnvironment, value, "http", "https"); err != nil {
		return "", err
	}
	return value, nil
}

func LoadGoBusinessAPI() (GoBusinessAPIConfig, error) {
	port, err := envInt("PORT", 3200)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	readySeconds, err := envInt("READY_TIMEOUT_SECONDS", 5)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	querySeconds, err := envInt("GO_BUSINESS_QUERY_TIMEOUT_SECONDS", 10)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	providerSeconds, err := envInt("MAIL_PROVIDER_TIMEOUT_SECONDS", 300)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	shutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	ingressSkewSeconds, err := envInt("INGRESS_ALLOWED_SKEW_SECONDS", 300)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	admin2FAWindow, err := envInt("ADMIN_2FA_WINDOW", 1)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	jwtLifetime, err := parseJWTLifetime(env("JWT_EXPIRES_IN", "2h"))
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	adminLoginMaxAttempts, err := envInt("ADMIN_LOGIN_MAX_ATTEMPTS", 5)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	adminLoginLockMinutes, err := envInt("ADMIN_LOGIN_LOCK_MINUTES", 15)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	runtimeEnvironment := env("NODE_ENV", "development")
	if runtimeEnvironment != "development" && runtimeEnvironment != "test" && runtimeEnvironment != "production" {
		return GoBusinessAPIConfig{}, errors.New("NODE_ENV must be development, test, or production")
	}
	jwtSecret, err := loadJWTSecretFile()
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	encryptionKey, err := loadEncryptionKeyFile()
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	redisURL, err := loadRedisURLWithPasswordFile(strings.TrimSpace(os.Getenv("REDIS_URL")), runtimeEnvironment)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}

	cfg := GoBusinessAPIConfig{
		Port:                   port,
		DatabaseURL:            strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RedisURL:               redisURL,
		JWTSecret:              jwtSecret,
		EncryptionKey:          encryptionKey,
		Admin2FAWindow:         admin2FAWindow,
		JWTLifetime:            jwtLifetime,
		AdminLoginMaxAttempts:  adminLoginMaxAttempts,
		AdminLoginLockDuration: time.Duration(adminLoginLockMinutes) * time.Minute,
		BootstrapAdminFile:     env("BOOTSTRAP_ADMIN_SECRET_FILE", "/var/lib/all-mail/bootstrap-admin.env"),
		SecureCookies:          runtimeEnvironment == "production",
		IngressAllowedSkew:     time.Duration(ingressSkewSeconds) * time.Second,
		ReadyTimeout:           time.Duration(readySeconds) * time.Second,
		QueryTimeout:           time.Duration(querySeconds) * time.Second,
		ProviderTimeout:        time.Duration(providerSeconds) * time.Second,
		ShutdownTimeout:        time.Duration(shutdownSeconds) * time.Second,
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return GoBusinessAPIConfig{}, errors.New("PORT must be between 1 and 65535")
	}
	if cfg.DatabaseURL == "" {
		return GoBusinessAPIConfig{}, errors.New("DATABASE_URL is required for the Go business API")
	}
	if cfg.RedisURL == "" {
		return GoBusinessAPIConfig{}, errors.New("REDIS_URL is required for the Go business API")
	}
	if cfg.ReadyTimeout <= 0 || cfg.QueryTimeout <= 0 || cfg.ProviderTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return GoBusinessAPIConfig{}, errors.New("Go business API timeouts must be positive")
	}
	if cfg.IngressAllowedSkew < time.Second || cfg.IngressAllowedSkew > time.Hour {
		return GoBusinessAPIConfig{}, errors.New("INGRESS_ALLOWED_SKEW_SECONDS must be between 1 and 3600")
	}
	if cfg.Admin2FAWindow < 0 || cfg.Admin2FAWindow > 5 {
		return GoBusinessAPIConfig{}, errors.New("ADMIN_2FA_WINDOW must be between 0 and 5")
	}
	if cfg.JWTLifetime <= 0 {
		return GoBusinessAPIConfig{}, errors.New("JWT_EXPIRES_IN must be positive")
	}
	if cfg.AdminLoginMaxAttempts < 1 {
		return GoBusinessAPIConfig{}, errors.New("ADMIN_LOGIN_MAX_ATTEMPTS must be at least 1")
	}
	if cfg.AdminLoginLockDuration < time.Minute {
		return GoBusinessAPIConfig{}, errors.New("ADMIN_LOGIN_LOCK_MINUTES must be at least 1")
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return GoBusinessAPIConfig{}, err
	}
	if err := validateRedisURL(cfg.RedisURL); err != nil {
		return GoBusinessAPIConfig{}, err
	}
	return cfg, nil
}

func parseJWTLifetime(raw string) (time.Duration, error) {
	const maxDuration = time.Duration(1<<63 - 1)

	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, errors.New("JWT_EXPIRES_IN must not be empty")
	}
	multiplier := uint64(1)
	digits := value
	switch value[len(value)-1] {
	case 's':
		digits = value[:len(value)-1]
	case 'm':
		digits = value[:len(value)-1]
		multiplier = 60
	case 'h':
		digits = value[:len(value)-1]
		multiplier = 60 * 60
	case 'd':
		digits = value[:len(value)-1]
		multiplier = 24 * 60 * 60
	}
	if digits == "" || digits[0] == '0' {
		return 0, errors.New("JWT_EXPIRES_IN must be a positive integer with an optional s, m, h, or d suffix")
	}
	for _, digit := range digits {
		if digit < '0' || digit > '9' {
			return 0, errors.New("JWT_EXPIRES_IN must be a positive integer with an optional s, m, h, or d suffix")
		}
	}
	amount, err := strconv.ParseUint(digits, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse JWT_EXPIRES_IN: %w", err)
	}
	maxSeconds := uint64(maxDuration / time.Second)
	if amount > maxSeconds/multiplier {
		return 0, errors.New("JWT_EXPIRES_IN is too large")
	}
	return time.Duration(amount*multiplier) * time.Second, nil
}

func (c GoBusinessAPIConfig) Address() string {
	return fmt.Sprintf(":%d", c.Port)
}

func loadJWTSecretFile() (string, error) {
	secretFile := strings.TrimSpace(os.Getenv("JWT_SECRET_FILE"))
	if secretFile == "" {
		return "", errors.New("JWT_SECRET_FILE is required for the Go business API")
	}
	content, err := os.ReadFile(secretFile)
	if err != nil {
		return "", fmt.Errorf("read JWT_SECRET_FILE: %w", err)
	}
	secret := strings.TrimSpace(string(content))
	if len(secret) < 32 {
		return "", errors.New("JWT_SECRET_FILE must contain at least 32 characters")
	}
	return secret, nil
}

func loadRedisURLWithPasswordFile(rawURL, runtimeEnvironment string) (string, error) {
	passwordFile := strings.TrimSpace(os.Getenv("REDIS_PASSWORD_FILE"))
	if passwordFile == "" {
		if runtimeEnvironment == "production" {
			return "", errors.New("REDIS_PASSWORD_FILE is required for the production Go business API")
		}
		return rawURL, nil
	}
	content, err := os.ReadFile(passwordFile)
	if err != nil {
		return "", fmt.Errorf("read REDIS_PASSWORD_FILE: %w", err)
	}
	password := strings.TrimSpace(string(content))
	if len(password) < 32 {
		return "", errors.New("REDIS_PASSWORD_FILE must contain at least 32 characters")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return "", errors.New("REDIS_URL must be an absolute Redis URL")
	}
	username := ""
	if parsed.User != nil {
		username = parsed.User.Username()
	}
	parsed.User = url.UserPassword(username, password)
	return parsed.String(), nil
}

func validateRedisURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return errors.New("REDIS_URL must be an absolute Redis URL")
	}
	if parsed.Scheme != "redis" && parsed.Scheme != "rediss" {
		return errors.New("REDIS_URL must use redis or rediss")
	}
	return nil
}
