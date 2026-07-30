package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

const goBusinessAPIURLEnvironment = "GO_BUSINESS_API_URL"

type GoBusinessAPIConfig struct {
	Port            int
	DatabaseURL     string
	JWTSecret       string
	ReadyTimeout    time.Duration
	QueryTimeout    time.Duration
	ShutdownTimeout time.Duration
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
	shutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}
	jwtSecret, err := loadJWTSecretFile()
	if err != nil {
		return GoBusinessAPIConfig{}, err
	}

	cfg := GoBusinessAPIConfig{
		Port:            port,
		DatabaseURL:     strings.TrimSpace(os.Getenv("DATABASE_URL")),
		JWTSecret:       jwtSecret,
		ReadyTimeout:    time.Duration(readySeconds) * time.Second,
		QueryTimeout:    time.Duration(querySeconds) * time.Second,
		ShutdownTimeout: time.Duration(shutdownSeconds) * time.Second,
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return GoBusinessAPIConfig{}, errors.New("PORT must be between 1 and 65535")
	}
	if cfg.DatabaseURL == "" {
		return GoBusinessAPIConfig{}, errors.New("DATABASE_URL is required for the Go business API")
	}
	if cfg.ReadyTimeout <= 0 || cfg.QueryTimeout <= 0 || cfg.ShutdownTimeout <= 0 {
		return GoBusinessAPIConfig{}, errors.New("Go business API timeouts must be positive")
	}
	if err := validateAbsoluteURL("DATABASE_URL", cfg.DatabaseURL, "postgres", "postgresql"); err != nil {
		return GoBusinessAPIConfig{}, err
	}
	return cfg, nil
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
