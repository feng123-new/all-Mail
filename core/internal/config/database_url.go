package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

const maxDatabaseURLFileBytes = 4096

func loadRuntimeDatabaseURL(runtime string) (string, error) {
	raw := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	path := strings.TrimSpace(os.Getenv("DATABASE_URL_FILE"))
	if raw != "" && path != "" {
		return "", fmt.Errorf("%s must configure only one of DATABASE_URL or DATABASE_URL_FILE", runtime)
	}
	if path != "" {
		content, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read DATABASE_URL_FILE for %s: %w", runtime, err)
		}
		if len(content) > maxDatabaseURLFileBytes {
			return "", fmt.Errorf("DATABASE_URL_FILE for %s is too large", runtime)
		}
		raw = strings.TrimSpace(string(content))
	}
	if raw == "" {
		return "", fmt.Errorf("DATABASE_URL_FILE or DATABASE_URL is required for %s", runtime)
	}
	if strings.ContainsAny(raw, "\r\n") {
		return "", errors.New("database URL must be a single line")
	}
	return raw, nil
}
