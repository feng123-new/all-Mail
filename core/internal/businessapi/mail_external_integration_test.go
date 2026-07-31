package businessapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestPostgresAPIKeyAndExternalRouteIntegrationProviderMailRoutes(t *testing.T) {
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
	email := "provider-route-" + suffix + "@example.test"
	apiKey := "sk_pr35_provider_route_" + suffix
	var adminID, emailID, apiKeyID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, two_factor_enabled, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "provider-route-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if apiKeyID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM api_keys WHERE id = $1`, apiKeyID)
		}
		if emailID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_accounts WHERE id = $1`, emailID)
		}
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
	}()
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO email_accounts (
			email, provider, auth_type, provider_config, capabilities, status, mailbox_status, created_at, updated_at
		)
		VALUES ($1, 'GMAIL', 'GOOGLE_OAUTH', '{}'::jsonb, '{}'::jsonb, 'ACTIVE', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, email).Scan(&emailID); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(apiKey))
	permissions := `{"external_read_latest_message":true,"external_list_messages":true,"external_clear_mailbox":true}`
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO api_keys (
			name, key_prefix, key_hash, permissions, allowed_email_ids, rate_limit, status,
			usage_count, created_by, created_at, updated_at
		)
		VALUES ($1, 'sk_pr35_', $2, $3::jsonb, jsonb_build_array($4::bigint), 100, 'ACTIVE', 0, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "provider-route-key-"+suffix, hex.EncodeToString(digest[:]), permissions, emailID, adminID).Scan(&apiKeyID); err != nil {
		t.Fatal(err)
	}

	var requestMutex sync.Mutex
	remoteRequests := make([]string, 0)
	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requestMutex.Lock()
		remoteRequests = append(remoteRequests, request.Method+" "+request.URL.Path)
		requestMutex.Unlock()
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/gmail/v1/users/me/messages":
			return providerJSONResponse(http.StatusOK, `{"messages":[{"id":"external-message-1"}]}`), nil
		case request.Method == http.MethodGet && request.URL.Path == "/gmail/v1/users/me/messages/external-message-1":
			return providerJSONResponse(http.StatusOK, `{"id":"external-message-1","payload":{"mimeType":"text/plain","headers":[{"name":"Subject","value":"external fixture"}],"body":{"data":"ZXh0ZXJuYWwgYm9keQ"}}}`), nil
		case request.Method == http.MethodPost && request.URL.Path == "/gmail/v1/users/me/messages/external-message-1/trash":
			return providerJSONResponse(http.StatusOK, `{}`), nil
		default:
			return nil, fmt.Errorf("unexpected provider route request %s %s", request.Method, request.URL.String())
		}
	})
	server := &Server{
		cfg: config.GoBusinessAPIConfig{
			EncryptionKey: "provider-route-encryption-key-0123456789", QueryTimeout: 10 * time.Second, ProviderTimeout: 5 * time.Second,
		},
		logger:             slog.New(slog.NewTextHandler(io.Discard, nil)),
		store:              store,
		apiKeyStore:        store,
		rateLimiter:        allowAllRateLimiter{},
		providerHTTPClient: &http.Client{Transport: transport, Timeout: 5 * time.Second},
		providerTokenSource: func(context.Context, mailAccountCredentials) (string, error) {
			return "external-route-access-token", nil
		},
		now: time.Now,
	}
	for _, path := range []string{
		"/api/mail_new?email=" + email,
		"/api/mail_all?email=" + email,
		"/api/process-mailbox?email=" + email,
	} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("X-API-Key", apiKey)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"success":true`) || !strings.Contains(response.Body.String(), email) {
			t.Fatalf("%s response = %d %s", path, response.Code, response.Body.String())
		}
	}
	requestMutex.Lock()
	requests := strings.Join(remoteRequests, "\n")
	requestMutex.Unlock()
	for _, expected := range []string{
		"GET /gmail/v1/users/me/messages",
		"GET /gmail/v1/users/me/messages/external-message-1",
		"POST /gmail/v1/users/me/messages/external-message-1/trash",
	} {
		if !strings.Contains(requests, expected) {
			t.Fatalf("provider route requests missing %q:\n%s", expected, requests)
		}
	}
}
