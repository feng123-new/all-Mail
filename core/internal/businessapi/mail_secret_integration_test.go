package businessapi

import (
	"context"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

func TestPostgresMailSecretStepUpIntegration(t *testing.T) {
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

	const encryptionKey = "pr35-secret-step-up-key-0123456789"
	const totpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	now := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	encryptedTOTP, err := legacycrypto.Encrypt(encryptionKey, totpSecret)
	if err != nil {
		t.Fatal(err)
	}
	encryptedPassword, err := legacycrypto.Encrypt(encryptionKey, "mail-app-password")
	if err != nil {
		t.Fatal(err)
	}
	encryptedLoginPassword, err := legacycrypto.Encrypt(encryptionKey, "original-login-password")
	if err != nil {
		t.Fatal(err)
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	var adminID, accountID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (
			username, password_hash, role, status, must_change_password,
			two_factor_enabled, two_factor_secret, session_version, created_at, updated_at
		)
		VALUES ($1, 'unused-test-hash', 'SUPER_ADMIN', 'ACTIVE', FALSE, TRUE, $2, 1,
		        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "pr35-step-up-"+suffix, encryptedTOTP).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO email_accounts (
			email, provider, auth_type, password, account_login_password,
			provider_config, capabilities, status, mailbox_status, created_at, updated_at
		)
		VALUES ($1, 'QQ', 'APP_PASSWORD', $2, $3, '{}'::jsonb, '{}'::jsonb,
		        'ACTIVE', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "pr35-step-up-"+suffix+"@example.test", encryptedPassword, encryptedLoginPassword).Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM api_logs WHERE metadata->>'adminId' = $1`, strconv.FormatInt(adminID, 10))
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_accounts WHERE id = $1`, accountID)
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
	}()

	server := &Server{
		cfg: config.GoBusinessAPIConfig{
			JWTSecret: testJWTSecret, EncryptionKey: encryptionKey, Admin2FAWindow: 1,
			QueryTimeout: 10 * time.Second, ProviderTimeout: 10 * time.Second,
		},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		store:  store,
		now:    func() time.Time { return now },
	}
	adminToken := signTestJWT(t, adminID, adminJWTAudience, now.Add(time.Hour))
	request := func(method, target, body string) *http.Request {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "token", Value: adminToken})
		return req
	}

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request(
		http.MethodPut,
		fmt.Sprintf("/admin/emails/%d", accountID),
		`{"accountLoginPassword":"bypass-attempt"}`,
	))
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"ACCOUNT_LOGIN_PASSWORD_GRANT_REQUIRED"`) {
		t.Fatalf("ungranted update response = %d %s", response.Code, response.Body.String())
	}

	secretBytes, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(totpSecret)
	if err != nil {
		t.Fatal(err)
	}
	otp := totpCode(secretBytes, now.Unix()/30)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request(http.MethodPost, "/admin/emails/reveal-unlock", `{"otp":"000000"}`))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("invalid reveal unlock response = %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request(http.MethodPost, "/admin/emails/reveal-unlock", `{"otp":"`+otp+`"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("reveal unlock response = %d %s", response.Code, response.Body.String())
	}
	var unlock struct {
		Data struct {
			GrantToken string `json:"grantToken"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &unlock); err != nil || unlock.Data.GrantToken == "" {
		t.Fatalf("decode reveal unlock response: %v; body=%s", err, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request(
		http.MethodPut,
		fmt.Sprintf("/admin/emails/%d", accountID),
		`{"accountLoginPassword":"updated-login-password","accountPasswordGrantToken":"`+unlock.Data.GrantToken+`"}`,
	))
	if response.Code != http.StatusOK {
		t.Fatalf("granted update response = %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request(
		http.MethodPost,
		fmt.Sprintf("/admin/emails/%d/reveal-secrets", accountID),
		`{"grantToken":"`+unlock.Data.GrantToken+`","fields":["accountLoginPassword"]}`,
	))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"accountLoginPassword":"updated-login-password"`) {
		t.Fatalf("reveal secrets response = %d %s", response.Code, response.Body.String())
	}
	var unlockTotal, unlockSuccess, unlockFailure, revealSuccess int
	if err := store.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE action = 'admin_reveal_external_secret_unlock'),
			COUNT(*) FILTER (WHERE action = 'admin_reveal_external_secret_unlock' AND response_code = 200 AND metadata->>'success' = 'true'),
			COUNT(*) FILTER (WHERE action = 'admin_reveal_external_secret_unlock' AND response_code = 401 AND metadata->>'success' = 'false'),
			COUNT(*) FILTER (WHERE action = 'admin_reveal_external_secret' AND email_account_id = $2 AND response_code = 200 AND metadata->>'success' = 'true')
		FROM api_logs
		WHERE metadata->>'adminId' = $1
	`, strconv.FormatInt(adminID, 10), accountID).Scan(&unlockTotal, &unlockSuccess, &unlockFailure, &revealSuccess); err != nil {
		t.Fatal(err)
	}
	if unlockTotal != 2 || unlockSuccess != 1 || unlockFailure != 1 || revealSuccess != 1 {
		t.Fatalf("secret audit counts = unlock total %d success %d failure %d, reveal success %d", unlockTotal, unlockSuccess, unlockFailure, revealSuccess)
	}
}
