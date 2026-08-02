package secretstate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var (
	testJWTSecret              = strings.Repeat("j", 32)
	alternateTestJWTSecret     = strings.Repeat("k", 32)
	testEncryptionKey          = strings.Repeat("e", 32)
	alternateTestEncryptionKey = strings.Repeat("f", 32)
)

func TestParseEnvTextPreservesCompatibilitySyntax(t *testing.T) {
	parsed := ParseEnvText("# ignored\r\n JWT_SECRET = 'abc=123' \r\nENCRYPTION_KEY=\"def\"\ninvalid\n")
	if parsed["JWT_SECRET"] != "abc=123" || parsed["ENCRYPTION_KEY"] != "def" {
		t.Fatalf("parsed = %#v", parsed)
	}
}

func TestResolveGeneratesStableSplitRuntimeState(t *testing.T) {
	directory := t.TempDir()
	first, err := Resolve(directory, map[string]string{"ADMIN_USERNAME": "admin"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.JWTSecret) != 64 || len(first.EncryptionKey) != 32 || len(first.RedisPassword) != 64 || len(first.CreatedKeys) != 6 {
		t.Fatalf("first state = %#v", first)
	}
	second, err := Resolve(directory, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if second.JWTSecret != first.JWTSecret || second.EncryptionKey != first.EncryptionKey || second.RedisPassword != first.RedisPassword || len(second.CreatedKeys) != 0 {
		t.Fatalf("second state = %#v", second)
	}
	info, err := os.Stat(first.RuntimeSecretsFile)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("runtime secret mode = %o", info.Mode().Perm())
	}
}

func TestResolveAddsRedisPasswordToExistingRuntimeState(t *testing.T) {
	directory := t.TempDir()
	runtimeFile := filepath.Join(directory, runtimeSecretsFilename)
	if err := os.WriteFile(runtimeFile, []byte("JWT_SECRET="+testJWTSecret+"\nENCRYPTION_KEY="+testEncryptionKey+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := Resolve(directory, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.RedisPassword) != 64 || len(state.CreatedKeys) != 4 || state.CreatedKeys[0] != "REDIS_PASSWORD" {
		t.Fatalf("upgraded state = %#v", state)
	}
	persisted, err := ReadEnvFile(runtimeFile)
	if err != nil {
		t.Fatal(err)
	}
	if persisted["REDIS_PASSWORD"] != state.RedisPassword {
		t.Fatalf("persisted Redis password was not upgraded: %#v", persisted)
	}
}

func TestResolveMigratesLegacyAdminWithoutRemovingBundle(t *testing.T) {
	directory := t.TempDir()
	legacy := filepath.Join(directory, legacySecretsFilename)
	if err := os.WriteFile(legacy, []byte("JWT_SECRET="+testJWTSecret+"\nENCRYPTION_KEY="+testEncryptionKey+"\nADMIN_PASSWORD=legacy-password\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := Resolve(directory, map[string]string{"ADMIN_USERNAME": "operator"}, false)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := ReadEnvFile(state.BootstrapAdminFile)
	if err != nil {
		t.Fatal(err)
	}
	if admin["ADMIN_USERNAME"] != "operator" || admin["ADMIN_PASSWORD"] != "legacy-password" {
		t.Fatalf("admin = %#v", admin)
	}
	if _, err := os.Stat(legacy); err != nil {
		t.Fatalf("legacy bundle removed before finalize: %v", err)
	}
}

func TestResolveRejectsEnvironmentKeyRotation(t *testing.T) {
	directory := t.TempDir()
	runtimeFile := filepath.Join(directory, runtimeSecretsFilename)
	if err := os.WriteFile(runtimeFile, []byte("JWT_SECRET="+testJWTSecret+"\nENCRYPTION_KEY="+testEncryptionKey+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Resolve(directory, map[string]string{
		"ENCRYPTION_KEY": alternateTestEncryptionKey,
	}, false)
	if err == nil {
		t.Fatal("conflicting encryption-key override was accepted")
	}
}

func TestResolveRejectsLegacyRuntimeConflict(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, runtimeSecretsFilename), []byte("JWT_SECRET="+testJWTSecret+"\nENCRYPTION_KEY="+testEncryptionKey+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, legacySecretsFilename), []byte("JWT_SECRET="+alternateTestJWTSecret+"\nENCRYPTION_KEY="+testEncryptionKey+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Resolve(directory, nil, false); err == nil {
		t.Fatal("conflicting legacy runtime secret state was accepted")
	}
}
