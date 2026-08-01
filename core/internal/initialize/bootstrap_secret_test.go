package initialize

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/secretstate"
)

func TestMigrateBootstrapAdminSecretMovesCredential(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "legacy", "bootstrap-admin.env")
	target := filepath.Join(directory, "isolated", "bootstrap-admin.env")
	if err := secretstate.WriteEnvFile(source, "legacy", map[string]string{
		"ADMIN_USERNAME": "legacy-admin",
		"ADMIN_PASSWORD": "Legacy-Bootstrap-Password-123!",
	}); err != nil {
		t.Fatal(err)
	}

	if err := migrateBootstrapAdminSecret(source, target); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("legacy bootstrap file still exists: %v", err)
	}
	entries, err := secretstate.ReadEnvFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if entries["ADMIN_USERNAME"] != "legacy-admin" || entries["ADMIN_PASSWORD"] != "Legacy-Bootstrap-Password-123!" {
		t.Fatalf("migrated credential = %#v", entries)
	}
}

func TestMigrateBootstrapAdminSecretRejectsConflict(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "legacy", "bootstrap-admin.env")
	target := filepath.Join(directory, "isolated", "bootstrap-admin.env")
	if err := secretstate.WriteEnvFile(source, "legacy", map[string]string{
		"ADMIN_USERNAME": "admin",
		"ADMIN_PASSWORD": "Legacy-Bootstrap-Password-123!",
	}); err != nil {
		t.Fatal(err)
	}
	if err := secretstate.WriteEnvFile(target, "target", map[string]string{
		"ADMIN_USERNAME": "admin",
		"ADMIN_PASSWORD": "Different-Bootstrap-Password-456!",
	}); err != nil {
		t.Fatal(err)
	}

	if err := migrateBootstrapAdminSecret(source, target); err == nil {
		t.Fatal("conflicting bootstrap credentials were accepted")
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("source was removed after conflict: %v", err)
	}
}

func TestWriteRuntimeBoundaryManifestContainsReferencesOnly(t *testing.T) {
	bootstrap := filepath.Join(t.TempDir(), "isolated", "bootstrap-admin.env")
	if err := writeRuntimeBoundaryManifest(bootstrap); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(filepath.Dir(bootstrap), "runtime-secrets.env"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, forbidden := range []string{"JWT_SECRET=", "ENCRYPTION_KEY=", "REDIS_PASSWORD="} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("boundary manifest contains raw secret key %q: %s", forbidden, text)
		}
	}
	for _, required := range []string{"JWT_SECRET_FILE=", "ENCRYPTION_KEY_FILE=", "REDIS_PASSWORD_FILE="} {
		if !strings.Contains(text, required) {
			t.Fatalf("boundary manifest omits %q: %s", required, text)
		}
	}
}
