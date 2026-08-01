package initialize

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/secretstate"
)

func migrateBootstrapAdminSecret(sourcePath, targetPath string) error {
	sourcePath = filepath.Clean(strings.TrimSpace(sourcePath))
	targetPath = filepath.Clean(strings.TrimSpace(targetPath))
	if sourcePath == targetPath {
		return nil
	}

	source, err := secretstate.ReadEnvFile(sourcePath)
	if err != nil {
		return err
	}
	sourcePassword := strings.TrimSpace(source["ADMIN_PASSWORD"])
	if secretstate.IsMissing(sourcePassword) {
		return nil
	}
	sourceUsername := strings.TrimSpace(source["ADMIN_USERNAME"])
	if secretstate.IsMissing(sourceUsername) {
		sourceUsername = "admin"
	}

	target, err := secretstate.ReadEnvFile(targetPath)
	if err != nil {
		return err
	}
	targetPassword := strings.TrimSpace(target["ADMIN_PASSWORD"])
	if !secretstate.IsMissing(targetPassword) {
		targetUsername := strings.TrimSpace(target["ADMIN_USERNAME"])
		if secretstate.IsMissing(targetUsername) {
			targetUsername = "admin"
		}
		if targetUsername != sourceUsername || targetPassword != sourcePassword {
			return fmt.Errorf("bootstrap administrator credential conflicts between %s and %s", sourcePath, targetPath)
		}
	} else if err := secretstate.WriteEnvFile(targetPath, "One-time all-Mail bootstrap administrator credential", map[string]string{
		"ADMIN_USERNAME": sourceUsername,
		"ADMIN_PASSWORD": sourcePassword,
	}); err != nil {
		return err
	}

	if err := os.Remove(sourcePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove migrated administrator bootstrap secret: %w", err)
	}
	return nil
}

func writeRuntimeBoundaryManifest(bootstrapFile string) error {
	directory := filepath.Dir(filepath.Clean(bootstrapFile))
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create isolated bootstrap directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("set isolated bootstrap directory permissions: %w", err)
	}
	if os.Geteuid() == 0 {
		if err := os.Chown(directory, 10001, 10001); err != nil {
			return fmt.Errorf("set isolated bootstrap directory ownership: %w", err)
		}
	}

	manifestPath := filepath.Join(directory, "runtime-secrets.env")
	content := []byte("# all-Mail least-privilege runtime secret references\n" +
		"# Long-lived secret values are not mounted in this service.\n" +
		"JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret\n" +
		"ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key\n" +
		"REDIS_PASSWORD_FILE=/var/lib/all-mail-redis/redis-password\n")
	if err := os.WriteFile(manifestPath, content, 0o600); err != nil {
		return fmt.Errorf("write runtime boundary manifest: %w", err)
	}
	if err := os.Chmod(manifestPath, 0o600); err != nil {
		return fmt.Errorf("set runtime boundary manifest permissions: %w", err)
	}
	if os.Geteuid() == 0 {
		if err := os.Chown(manifestPath, 10001, 10001); err != nil {
			return fmt.Errorf("set runtime boundary manifest ownership: %w", err)
		}
	}
	return nil
}
