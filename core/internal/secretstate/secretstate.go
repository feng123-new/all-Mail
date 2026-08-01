package secretstate

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const (
	runtimeSecretsFilename = "runtime-secrets.env"
	bootstrapAdminFilename = "bootstrap-admin.env"
	legacySecretsFilename  = "bootstrap-secrets.env"
)

var placeholderPrefixes = []string{"replace-with-", "changeme-", "example-"}

type State struct {
	StateDir           string
	RuntimeSecretsFile string
	BootstrapAdminFile string
	LegacySecretsFile  string
	JWTSecret          string
	EncryptionKey      string
	CreatedKeys        []string
}

func WithLock(stateDir string, timeout time.Duration, run func() error) error {
	if err := prepareDirectory(stateDir); err != nil {
		return err
	}
	lockPath := filepath.Join(stateDir, ".bootstrap-secrets.lock")
	lockFile, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("open runtime secret lock: %w", err)
	}
	defer lockFile.Close()
	if err := os.Chmod(lockPath, 0o600); err != nil {
		return fmt.Errorf("set runtime secret lock permissions: %w", err)
	}
	deadline := time.Now().Add(timeout)
	for {
		err = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			return fmt.Errorf("lock runtime secret state: %w", err)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out after %s waiting for runtime secret lock", timeout)
		}
		time.Sleep(100 * time.Millisecond)
	}
	defer syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)
	return run()
}

func Resolve(stateDir string, environment map[string]string, allowGenerate bool) (State, error) {
	if err := validateAdminEnvironment(environment); err != nil {
		return State{}, err
	}
	if err := prepareDirectory(stateDir); err != nil {
		return State{}, err
	}
	state := State{
		StateDir:           stateDir,
		RuntimeSecretsFile: filepath.Join(stateDir, runtimeSecretsFilename),
		BootstrapAdminFile: filepath.Join(stateDir, bootstrapAdminFilename),
		LegacySecretsFile:  filepath.Join(stateDir, legacySecretsFilename),
	}
	existingRuntime, err := ReadEnvFile(state.RuntimeSecretsFile)
	if err != nil {
		return State{}, err
	}
	legacy, err := ReadEnvFile(state.LegacySecretsFile)
	if err != nil {
		return State{}, err
	}
	existingAdmin, err := ReadEnvFile(state.BootstrapAdminFile)
	if err != nil {
		return State{}, err
	}
	persisted := make(map[string]string)
	for _, key := range []string{"JWT_SECRET", "ENCRYPTION_KEY"} {
		legacyValue := strings.TrimSpace(legacy[key])
		runtimeValue := strings.TrimSpace(existingRuntime[key])
		if !isMissing(legacyValue) && !isMissing(runtimeValue) && legacyValue != runtimeValue {
			return State{}, fmt.Errorf("%s conflicts between legacy and runtime secret files", key)
		}
		if !isMissing(runtimeValue) {
			persisted[key] = runtimeValue
		} else if !isMissing(legacyValue) {
			persisted[key] = legacyValue
		}
	}

	resolve := func(key string, generate func() (string, error)) (string, error) {
		environmentValue := strings.TrimSpace(environment[key])
		persistedValue := strings.TrimSpace(persisted[key])
		if !isMissing(environmentValue) {
			if !isMissing(persistedValue) && environmentValue != persistedValue {
				return "", fmt.Errorf("%s conflicts between environment and persisted secret state", key)
			}
			return environmentValue, nil
		}
		if !isMissing(persistedValue) {
			return persistedValue, nil
		}
		if !allowGenerate {
			return "", fmt.Errorf("%s is required for an existing database", key)
		}
		value, err := generate()
		if err != nil {
			return "", err
		}
		persisted[key] = value
		state.CreatedKeys = append(state.CreatedKeys, key)
		return value, nil
	}
	state.JWTSecret, err = resolve("JWT_SECRET", func() (string, error) { return randomHex(32) })
	if err != nil {
		return State{}, err
	}
	state.EncryptionKey, err = resolve("ENCRYPTION_KEY", func() (string, error) { return randomHex(16) })
	if err != nil {
		return State{}, err
	}
	if err := validateRuntimeSecrets(state.JWTSecret, state.EncryptionKey); err != nil {
		return State{}, err
	}
	if err := WriteEnvFile(state.RuntimeSecretsFile, "Auto-generated all-Mail runtime secrets", persisted); err != nil {
		return State{}, err
	}

	if !isMissing(legacy["ADMIN_PASSWORD"]) {
		migratedAdmin := selectEntries(legacy, "ADMIN_USERNAME", "ADMIN_PASSWORD")
		for key, value := range selectEntries(environment, "ADMIN_USERNAME", "ADMIN_PASSWORD") {
			migratedAdmin[key] = value
		}
		for key, value := range selectEntries(existingAdmin, "ADMIN_USERNAME", "ADMIN_PASSWORD") {
			migratedAdmin[key] = value
		}
		if isMissing(migratedAdmin["ADMIN_USERNAME"]) {
			migratedAdmin["ADMIN_USERNAME"] = "admin"
		}
		if !isMissing(migratedAdmin["ADMIN_PASSWORD"]) {
			if err := WriteEnvFile(state.BootstrapAdminFile, "One-time all-Mail bootstrap administrator credential", migratedAdmin); err != nil {
				return State{}, err
			}
		}
	}
	return state, nil
}

func Finalize(state State, encryptionExport, jwtExport string) error {
	if encryptionExport != "" {
		if err := WriteSecretFile(encryptionExport, state.EncryptionKey); err != nil {
			return err
		}
	}
	if jwtExport != "" {
		if err := WriteSecretFile(jwtExport, state.JWTSecret); err != nil {
			return err
		}
	}
	if err := os.Remove(state.LegacySecretsFile); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove migrated legacy secret bundle: %w", err)
		}
	} else if err := syncDirectory(filepath.Dir(state.LegacySecretsFile)); err != nil {
		return err
	}
	return nil
}

func ReadEnvFile(path string) (map[string]string, error) {
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read environment file %s: %w", path, err)
	}
	return ParseEnvText(string(content)), nil
}

func ParseEnvText(content string) map[string]string {
	result := make(map[string]string)
	for _, rawLine := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		separator := strings.IndexByte(line, '=')
		if separator < 0 {
			continue
		}
		key := strings.TrimSpace(line[:separator])
		if key == "" {
			continue
		}
		value := strings.TrimSpace(line[separator+1:])
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			value = value[1 : len(value)-1]
		}
		result[key] = value
	}
	return result
}

func WriteEnvFile(path, title string, entries map[string]string) error {
	keys := []string{"JWT_SECRET", "ENCRYPTION_KEY", "ADMIN_USERNAME", "ADMIN_PASSWORD"}
	var content strings.Builder
	fmt.Fprintf(&content, "# %s\n", title)
	content.WriteString("# Keep this file private and preserve it with the matching database backup.\n")
	for _, key := range keys {
		if value, ok := entries[key]; ok && !isMissing(value) {
			fmt.Fprintf(&content, "%s=%s\n", key, value)
		}
	}
	return writeAtomic(path, []byte(content.String()))
}

func WriteSecretFile(path, value string) error {
	return writeAtomic(path, []byte(value+"\n"))
}

func GenerateAdminPassword() (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate administrator password: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func IsMissing(value string) bool {
	return isMissing(value)
}

func prepareDirectory(path string) error {
	if strings.TrimSpace(path) == "" || filepath.Clean(path) == string(filepath.Separator) {
		return fmt.Errorf("unsafe runtime state directory %q", path)
	}
	if err := os.MkdirAll(path, 0o700); err != nil {
		return fmt.Errorf("create runtime state directory: %w", err)
	}
	if err := os.Chmod(path, 0o700); err != nil {
		return fmt.Errorf("set runtime state directory permissions: %w", err)
	}
	if os.Geteuid() == 0 {
		if err := os.Chown(path, 10001, 10001); err != nil {
			return fmt.Errorf("set runtime state directory ownership: %w", err)
		}
	}
	return nil
}

func writeAtomic(path string, content []byte) error {
	if err := prepareDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".allmail-secret-*")
	if err != nil {
		return fmt.Errorf("create temporary secret file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("set temporary secret permissions: %w", err)
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary secret file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary secret file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary secret file: %w", err)
	}
	if os.Geteuid() == 0 {
		if err := os.Chown(temporaryPath, 10001, 10001); err != nil {
			return fmt.Errorf("set secret file ownership: %w", err)
		}
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("publish secret file %s: %w", path, err)
	}
	return syncDirectory(filepath.Dir(path))
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open secret directory for sync: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync secret directory: %w", err)
	}
	return nil
}

func validateRuntimeSecrets(jwtSecret, encryptionKey string) error {
	if len(strings.TrimSpace(jwtSecret)) < 32 || isMissing(jwtSecret) {
		return errors.New("JWT_SECRET must contain at least 32 non-placeholder characters")
	}
	if len(strings.TrimSpace(encryptionKey)) != 32 || isMissing(encryptionKey) {
		return errors.New("ENCRYPTION_KEY must contain exactly 32 non-placeholder characters")
	}
	return nil
}

func validateAdminEnvironment(environment map[string]string) error {
	for _, key := range []string{"ADMIN_USERNAME", "ADMIN_PASSWORD"} {
		raw := environment[key]
		if strings.ContainsAny(raw, "\r\n") {
			return fmt.Errorf("%s must not contain line breaks", key)
		}
		value := strings.TrimSpace(raw)
		if value != "" && (strings.HasPrefix(value, "'") || strings.HasPrefix(value, "\"") || strings.HasSuffix(value, "'") || strings.HasSuffix(value, "\"")) {
			return fmt.Errorf("%s must not start or end with a quote", key)
		}
	}
	username := strings.TrimSpace(environment["ADMIN_USERNAME"])
	password := strings.TrimSpace(environment["ADMIN_PASSWORD"])
	if !isMissing(username) && len(username) > 50 {
		return errors.New("ADMIN_USERNAME must contain at most 50 characters")
	}
	if !isMissing(password) && len(password) < 8 {
		return errors.New("ADMIN_PASSWORD must contain at least 8 characters")
	}
	return nil
}

func selectEntries(source map[string]string, keys ...string) map[string]string {
	result := make(map[string]string)
	for _, key := range keys {
		if value := strings.TrimSpace(source[key]); !isMissing(value) {
			result[key] = value
		}
	}
	return result
}

func isMissing(value string) bool {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return true
	}
	for _, prefix := range placeholderPrefixes {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}
	return false
}

func randomHex(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate runtime secret: %w", err)
	}
	return hex.EncodeToString(value), nil
}
