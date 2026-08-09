package businessapi

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

type realisticImportFixture struct {
	name      string
	line      string
	provider  string
	authType  string
	readMode  string
	imapHost  string
	smtpHost  string
	wantError bool
}

func realisticImportFixtures(suffix string) []realisticImportFixture {
	return []realisticImportFixture{
		{
			name:     "hotmail vendor email-first oauth",
			line:     fmt.Sprintf("audit-%s@hotmail.com----hotmail-login-pass----11111111-2222-3333-4444-555555555555----M.audit-refresh-%s", suffix, suffix),
			provider: "OUTLOOK",
			authType: "MICROSOFT_OAUTH",
			readMode: "IMAP_ONLY",
		},
		{
			name:     "gmail tokenized oauth",
			line:     fmt.Sprintf("GMAIL_OAUTH----audit-%s@gmail.com----audit-%s.apps.googleusercontent.com----gmail-client-secret----1//audit-refresh-%s----gmail-login-pass", suffix, suffix, suffix),
			provider: "GMAIL",
			authType: "GOOGLE_OAUTH",
		},
		{
			name:     "qq app password",
			line:     fmt.Sprintf("QQ_IMAP_SMTP----audit-%s@qq.com----qq-app-password----qq-login-pass", suffix),
			provider: "QQ",
			authType: "APP_PASSWORD",
			imapHost: "imap.qq.com",
			smtpHost: "smtp.qq.com",
		},
		{
			name:     "mail.com app password",
			line:     fmt.Sprintf("MAILCOM_IMAP_SMTP----audit-%s@mail.com----mailcom-app-password----mailcom-login-pass", suffix),
			provider: "MAILCOM",
			authType: "APP_PASSWORD",
			imapHost: "imap.mail.com",
			smtpHost: "smtp.mail.com",
		},
		{
			name:     "custom imap smtp complete profile",
			line:     fmt.Sprintf("CUSTOM_IMAP_SMTP----audit-%s@example.test----custom-app-password----imap.example.test----993----true----smtp.example.test----465----true----INBOX----Spam----Sent----custom-login-pass", suffix),
			provider: "CUSTOM_IMAP_SMTP",
			authType: "APP_PASSWORD",
			imapHost: "imap.example.test",
			smtpHost: "smtp.example.test",
		},
		{
			name:      "malformed email",
			line:      "not-an-email----bad-password",
			wantError: true,
		},
		{
			name:      "oauth missing refresh token",
			line:      "GMAIL_OAUTH----broken@gmail.com----client-only",
			wantError: true,
		},
	}
}

func TestRealisticImportParserAudit(t *testing.T) {
	for _, fixture := range realisticImportFixtures("parser") {
		t.Run(fixture.name, func(t *testing.T) {
			account, err := parseImportedMailAccount(fixture.line, defaultMailImportSeparator)
			if fixture.wantError {
				if err == nil {
					t.Fatalf("parse unexpectedly succeeded: %#v", account)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if account.Provider != fixture.provider || account.AuthType != fixture.authType {
				t.Fatalf("profile = %s/%s, want %s/%s", account.Provider, account.AuthType, fixture.provider, fixture.authType)
			}
			if fixture.readMode != "" && account.ProviderConfig.ReadMode != fixture.readMode {
				t.Fatalf("read mode = %q, want %q", account.ProviderConfig.ReadMode, fixture.readMode)
			}
			if fixture.imapHost != "" && account.ProviderConfig.IMAPHost != fixture.imapHost {
				t.Fatalf("imap host = %q, want %q", account.ProviderConfig.IMAPHost, fixture.imapHost)
			}
			if fixture.smtpHost != "" && account.ProviderConfig.SMTPHost != fixture.smtpHost {
				t.Fatalf("smtp host = %q, want %q", account.ProviderConfig.SMTPHost, fixture.smtpHost)
			}
		})
	}
}

func TestPostgresRealisticImportRoundTripAudit(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	group, err := store.createManagedEmailGroup(ctx, "realistic-import-audit-"+suffix, nil, "GRAPH_FIRST")
	if err != nil {
		t.Fatal(err)
	}

	fixtures := realisticImportFixtures(suffix)
	emails := make([]string, 0, 5)
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		for _, email := range emails {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_accounts WHERE email = $1`, email)
		}
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_groups WHERE id = $1`, group.ID)
	}()

	encryptionKey := strings.Repeat("audit-key-", 8)
	successCount := 0
	failureCount := 0
	for _, fixture := range fixtures {
		account, parseErr := parseImportedMailAccount(fixture.line, defaultMailImportSeparator)
		if parseErr == nil {
			parseErr = store.upsertImportedMailAccount(ctx, account, &group.ID, encryptionKey)
		}
		if fixture.wantError {
			if parseErr == nil {
				t.Fatalf("%s unexpectedly imported", fixture.name)
			}
			failureCount++
			continue
		}
		if parseErr != nil {
			t.Fatalf("%s import failed: %v", fixture.name, parseErr)
		}
		successCount++
		emails = append(emails, account.Email)
		assertRealisticStoredRow(t, ctx, store, account, group.ID)
	}

	if successCount != 5 || failureCount != 2 {
		t.Fatalf("mixed import summary = %d success / %d failed, want 5 / 2", successCount, failureCount)
	}
	var storedCount int
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM email_accounts WHERE group_id = $1`, group.ID).Scan(&storedCount); err != nil {
		t.Fatal(err)
	}
	if storedCount != successCount {
		t.Fatalf("stored rows = %d, want %d", storedCount, successCount)
	}

	exported, err := store.exportMailAccounts(ctx, nil, &group.ID, defaultMailImportSeparator, true, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	exportedLines := strings.Split(strings.TrimSpace(exported), "\n")
	if len(exportedLines) != successCount {
		t.Fatalf("exported lines = %d, want %d", len(exportedLines), successCount)
	}
	for _, line := range exportedLines {
		if _, err := parseImportedMailAccount(line, defaultMailImportSeparator); err != nil {
			t.Fatalf("exported line cannot be re-imported: %v\n%s", err, line)
		}
	}

	first, err := parseImportedMailAccount(fixtures[0].line, defaultMailImportSeparator)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.upsertImportedMailAccount(ctx, first, &group.ID, encryptionKey); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM email_accounts WHERE email = $1`, first.Email).Scan(&storedCount); err != nil {
		t.Fatal(err)
	}
	if storedCount != 1 {
		t.Fatalf("upsert created %d rows for %s, want 1", storedCount, first.Email)
	}

	t.Logf("realistic import audit passed: %d stored, %d rejected, %d export lines re-importable", successCount, failureCount, len(exportedLines))
}

func assertRealisticStoredRow(t *testing.T, ctx context.Context, store *PostgresStore, account importedMailAccount, groupID int64) {
	t.Helper()
	var provider, authType string
	var encryptedRefreshToken, encryptedPassword sql.NullString
	var storedGroupID sql.NullInt64
	if err := store.pool.QueryRow(ctx, `
		SELECT provider::text, auth_type::text, refresh_token, password, group_id
		FROM email_accounts
		WHERE email = $1
	`, account.Email).Scan(&provider, &authType, &encryptedRefreshToken, &encryptedPassword, &storedGroupID); err != nil {
		t.Fatal(err)
	}
	if provider != account.Provider || authType != account.AuthType {
		t.Fatalf("stored profile for %s = %s/%s, want %s/%s", account.Email, provider, authType, account.Provider, account.AuthType)
	}
	if !storedGroupID.Valid || storedGroupID.Int64 != groupID {
		t.Fatalf("stored group for %s = %#v, want %d", account.Email, storedGroupID, groupID)
	}
	if account.RefreshToken != nil {
		if !encryptedRefreshToken.Valid || encryptedRefreshToken.String == *account.RefreshToken {
			t.Fatalf("refresh token for %s was missing or stored in plaintext", account.Email)
		}
	}
	if account.Password != nil {
		if !encryptedPassword.Valid || encryptedPassword.String == *account.Password {
			t.Fatalf("password for %s was missing or stored in plaintext", account.Email)
		}
	}
}
