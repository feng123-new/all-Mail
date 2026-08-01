package businessapi

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func TestPostgresAuthenticationStorePreservesTriggerDrivenSessionVersions(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	username := fmt.Sprintf("auth-route-%d", time.Now().UnixNano())
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("temporary-password"), 10)
	if err != nil {
		t.Fatal(err)
	}
	var adminID int64
	err = store.pool.QueryRow(ctx, `
		INSERT INTO admins (
			username, password_hash, role, status, must_change_password,
			two_factor_enabled, session_version, created_at, updated_at
		)
		VALUES ($1, $2, 'SUPER_ADMIN', 'ACTIVE', TRUE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, username, string(passwordHash)).Scan(&adminID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
	}()

	admin, err := store.FindAdminAuthenticationByUsername(ctx, username)
	if err != nil || admin.SessionVersion != 1 || !admin.MustChangePassword || admin.PasswordHash != string(passwordHash) {
		t.Fatalf("loaded authentication admin = %#v, %v", admin, err)
	}
	loginAt := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	admin, err = store.RecordAdminLogin(ctx, adminID, 1, loginAt, "203.0.113.8")
	if err != nil || admin.SessionVersion != 1 || admin.LastLoginAt == nil || !admin.LastLoginAt.Equal(loginAt) || admin.LastLoginIP == nil || *admin.LastLoginIP != "203.0.113.8" {
		t.Fatalf("recorded login = %#v, %v", admin, err)
	}

	admin, err = store.SetAdminTwoFactorTempSecret(ctx, adminID, 1, "encrypted-temp")
	if err != nil || admin.SessionVersion != 1 || admin.TwoFactorTempSecret == nil || *admin.TwoFactorTempSecret != "encrypted-temp" {
		t.Fatalf("stored temporary 2FA = %#v, %v", admin, err)
	}
	admin, err = store.EnableAdminTwoFactor(ctx, adminID, 1, "encrypted-temp")
	if err != nil || admin.SessionVersion != 2 || !admin.TwoFactorEnabled || admin.TwoFactorSecret == nil || *admin.TwoFactorSecret != "encrypted-temp" || admin.TwoFactorTempSecret != nil {
		t.Fatalf("enabled 2FA = %#v, %v", admin, err)
	}
	if _, err := store.DisableAdminTwoFactor(ctx, adminID, 1, "encrypted-temp"); !errors.Is(err, errNotFound) {
		t.Fatalf("stale session mutation error = %v", err)
	}
	admin, err = store.DisableAdminTwoFactor(ctx, adminID, 2, "encrypted-temp")
	if err != nil || admin.SessionVersion != 3 || admin.TwoFactorEnabled || admin.TwoFactorSecret != nil {
		t.Fatalf("disabled 2FA = %#v, %v", admin, err)
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte("replacement-password"), 10)
	if err != nil {
		t.Fatal(err)
	}
	admin, err = store.ChangeAdminPassword(ctx, adminID, 3, string(passwordHash), string(newHash))
	if err != nil || admin.SessionVersion != 4 || admin.MustChangePassword || admin.PasswordHash != string(newHash) {
		t.Fatalf("changed password = %#v, %v", admin, err)
	}
}
