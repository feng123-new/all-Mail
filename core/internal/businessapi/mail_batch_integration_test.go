package businessapi

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestPostgresBatchMailOperationContractIntegration(t *testing.T) {
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
	insertAccount := func(email, provider, authType, status string) int64 {
		t.Helper()
		var id int64
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO email_accounts (
				email, provider, auth_type, provider_config, capabilities, status,
				mailbox_status, created_at, updated_at
			)
			VALUES ($1, $2::"MailProvider", $3::"MailAuthType", '{}'::jsonb, '{}'::jsonb,
			        $4::"EmailStatus", '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id
		`, email, provider, authType, status).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	gmailID := insertAccount("batch-gmail-"+suffix+"@example.test", "GMAIL", "GOOGLE_OAUTH", "ACTIVE")
	disabledID := insertAccount("batch-disabled-"+suffix+"@example.test", "QQ", "APP_PASSWORD", "DISABLED")
	unsupportedID := insertAccount("batch-unsupported-"+suffix+"@example.test", "QQ", "APP_PASSWORD", "ACTIVE")
	ids := []int64{gmailID, disabledID, unsupportedID}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_accounts WHERE id = ANY($1::bigint[])`, ids)
	}()

	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodGet || request.URL.Path != "/gmail/v1/users/me/messages" {
			return nil, fmt.Errorf("unexpected batch provider request %s %s", request.Method, request.URL.String())
		}
		if request.URL.Query().Get("labelIds") == "SPAM" {
			return providerJSONResponse(http.StatusBadGateway, `{"error":"fixture failure"}`), nil
		}
		return providerJSONResponse(http.StatusOK, `{"messages":[]}`), nil
	})
	server := &Server{
		cfg: config.GoBusinessAPIConfig{
			EncryptionKey: "pr35-batch-integration-key-0123456789", QueryTimeout: 10 * time.Second, ProviderTimeout: 10 * time.Second,
		},
		logger:             slog.New(slog.NewTextHandler(io.Discard, nil)),
		store:              store,
		providerHTTPClient: &http.Client{Transport: transport, Timeout: 5 * time.Second},
		providerTokenSource: func(context.Context, mailAccountCredentials) (string, error) {
			return "batch-access-token", nil
		},
		now: time.Now,
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin/emails/batch-clear-mailbox", strings.NewReader(fmt.Sprintf(
		`{"ids":[%d,%d,%d],"mailbox":"INBOX"}`,
		gmailID, disabledID, unsupportedID,
	)))
	server.batchClearMailAccounts(response, request, Admin{})
	if response.Code != http.StatusOK {
		t.Fatalf("batch clear response = %d %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{`"targeted":3`, `"successCount":1`, `"errorCount":0`, `"skippedCount":2`, `"EMAIL_TARGET_DISABLED"`, `"MAILBOX_CLEAR_UNSUPPORTED"`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("batch clear response missing %s: %s", expected, response.Body.String())
		}
	}

	response = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/admin/emails/batch-fetch-mails", strings.NewReader(fmt.Sprintf(
		`{"ids":[%d,%d],"mailboxes":["INBOX","SENT","Junk"]}`,
		gmailID, disabledID,
	)))
	server.batchFetchMailAccounts(response, request, Admin{})
	if response.Code != http.StatusOK {
		t.Fatalf("batch fetch response = %d %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{`"targeted":2`, `"successCount":0`, `"partialCount":1`, `"errorCount":0`, `"skippedCount":1`, `"EMAIL_BATCH_FETCH_PARTIAL"`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("batch fetch response missing %s: %s", expected, response.Body.String())
		}
	}
	var storedStatus string
	if err := store.pool.QueryRow(ctx, `SELECT status::text FROM email_accounts WHERE id = $1`, gmailID).Scan(&storedStatus); err != nil {
		t.Fatal(err)
	}
	if storedStatus != "ACTIVE" {
		t.Fatalf("partial batch fetch stored status = %s", storedStatus)
	}
	clientID, refreshToken := "transition-client", "transition-refresh"
	if _, err := store.updateMailAccount(ctx, unsupportedID, mailAccountUpdateInput{
		ProviderPresent: true, Provider: "GMAIL", AuthTypePresent: true, AuthType: "GOOGLE_OAUTH",
		ClientIDPresent: true, ClientID: &clientID, RefreshTokenPresent: true, RefreshToken: &refreshToken,
		PasswordPresent: true, Password: nil,
	}, "pr35-batch-integration-key-0123456789"); err != nil {
		t.Fatal(err)
	}
	var readMode, imapHost, smtpHost string
	if err := store.pool.QueryRow(ctx, `
		SELECT provider_config->>'readMode', provider_config->>'imapHost', provider_config->>'smtpHost'
		FROM email_accounts WHERE id = $1
	`, unsupportedID).Scan(&readMode, &imapHost, &smtpHost); err != nil {
		t.Fatal(err)
	}
	if readMode != "GMAIL_API" || imapHost != "imap.gmail.com" || smtpHost != "smtp.gmail.com" {
		t.Fatalf("provider transition config = %s, %s, %s", readMode, imapHost, smtpHost)
	}
	if _, err := store.pool.Exec(ctx, `
		UPDATE email_accounts
		SET provider_config = provider_config || '{"oauthTenant":"organizations","oauthScopes":"openid https://www.googleapis.com/auth/gmail.modify"}'::jsonb
		WHERE id = $1
	`, unsupportedID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.updateMailAccount(ctx, unsupportedID, mailAccountUpdateInput{
		ProviderPresent: true, Provider: "GMAIL", AuthTypePresent: true, AuthType: "GOOGLE_OAUTH",
		StatusPresent: true, Status: "ACTIVE",
	}, "pr35-batch-integration-key-0123456789"); err != nil {
		t.Fatal(err)
	}
	var oauthTenant, oauthScopes string
	if err := store.pool.QueryRow(ctx, `
		SELECT provider_config->>'oauthTenant', provider_config->>'oauthScopes'
		FROM email_accounts WHERE id = $1
	`, unsupportedID).Scan(&oauthTenant, &oauthScopes); err != nil {
		t.Fatal(err)
	}
	if oauthTenant != "organizations" || !strings.Contains(oauthScopes, "gmail.modify") {
		t.Fatalf("same-profile update lost OAuth authority = %q, %q", oauthTenant, oauthScopes)
	}
}
