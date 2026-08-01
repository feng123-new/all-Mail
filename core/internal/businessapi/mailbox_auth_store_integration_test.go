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

func TestPostgresMailboxAuthenticationStorePreservesMembershipAndSessionTransitions(t *testing.T) {
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

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("temporary-password"), 10)
	if err != nil {
		t.Fatal(err)
	}
	var adminID, domainID, userID int64
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if domainID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		}
		if userID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM mailbox_users WHERE id = $1`, userID)
		}
		if adminID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
		}
	}()

	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "mailbox-auth-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE', TRUE, TRUE, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "mailbox-auth-"+suffix+".example", adminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	email := "mailbox-auth-" + suffix + "@example.test"
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO mailbox_users (
			username, email, password_hash, status, two_factor_enabled,
			must_change_password, session_version, created_at, updated_at
		)
		VALUES ($1, $2, $3, 'ACTIVE', FALSE, TRUE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "mailbox-auth-"+suffix, email, string(passwordHash)).Scan(&userID); err != nil {
		t.Fatal(err)
	}

	mailboxIDs := make([]int64, 3)
	for index, mailbox := range []struct {
		localPart string
		status    string
		owned     bool
	}{
		{localPart: "owned", status: "ACTIVE", owned: true},
		{localPart: "member", status: "ACTIVE"},
		{localPart: "disabled", status: "DISABLED"},
	} {
		var ownerID any
		if mailbox.owned {
			ownerID = userID
		}
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO domain_mailboxes (
				domain_id, local_part, address, status, provisioning_mode, owner_user_id, updated_at
			)
			VALUES ($1, $2, $3, $4, 'MANUAL', $5, CURRENT_TIMESTAMP)
			RETURNING id
		`, domainID, mailbox.localPart, mailbox.localPart+"-"+suffix+"@example.test", mailbox.status, ownerID).Scan(&mailboxIDs[index]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO mailbox_memberships (mailbox_id, user_id, role, created_at, updated_at)
		VALUES ($1, $3, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
		       ($2, $3, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, mailboxIDs[1], mailboxIDs[2], userID); err != nil {
		t.Fatal(err)
	}

	identity, err := store.FindMailboxAuthenticationByIdentifier(ctx, email)
	if err != nil || identity.ID != userID || identity.SessionVersion != 1 ||
		!equalInt64s(identity.MailboxIDs, []int64{mailboxIDs[0], mailboxIDs[1]}) {
		t.Fatalf("loaded mailbox identity = %#v, %v", identity, err)
	}
	loginAt := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	identity, err = store.RecordMailboxLogin(ctx, userID, 1, loginAt, "203.0.113.8")
	if err != nil || identity.SessionVersion != 1 || identity.LastLoginAt == nil || !identity.LastLoginAt.Equal(loginAt) ||
		identity.LastLoginIP == nil || *identity.LastLoginIP != "203.0.113.8" {
		t.Fatalf("recorded mailbox login = %#v, %v", identity, err)
	}

	identity, err = store.SetMailboxTwoFactorSecret(ctx, userID, 1, "encrypted-secret")
	if err != nil || identity.SessionVersion != 2 || identity.TwoFactorEnabled || identity.TwoFactorSecret == nil {
		t.Fatalf("stored pending mailbox 2FA = %#v, %v", identity, err)
	}
	if _, err := store.EnableMailboxTwoFactor(ctx, userID, 1, "encrypted-secret"); !errors.Is(err, errNotFound) {
		t.Fatalf("stale mailbox setup mutation error = %v", err)
	}
	identity, err = store.EnableMailboxTwoFactor(ctx, userID, 2, "encrypted-secret")
	if err != nil || identity.SessionVersion != 3 || !identity.TwoFactorEnabled {
		t.Fatalf("enabled mailbox 2FA = %#v, %v", identity, err)
	}
	identity, err = store.DisableMailboxTwoFactor(ctx, userID, 3, "encrypted-secret")
	if err != nil || identity.SessionVersion != 4 || identity.TwoFactorEnabled || identity.TwoFactorSecret != nil {
		t.Fatalf("disabled mailbox 2FA = %#v, %v", identity, err)
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte("replacement-password"), 10)
	if err != nil {
		t.Fatal(err)
	}
	identity, err = store.ChangeMailboxPassword(ctx, userID, 4, string(passwordHash), string(newHash))
	if err != nil || identity.SessionVersion != 5 || identity.MustChangePassword || identity.PasswordHash != string(newHash) {
		t.Fatalf("changed mailbox password = %#v, %v", identity, err)
	}
}
