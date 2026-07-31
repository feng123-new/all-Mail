package businessapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

func TestPostgresAPIKeyAndExternalRouteIntegrationSendManagementRoutes(t *testing.T) {
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
	const encryptionKey = "pr35-send-integration-key-0123456789"
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	domainName := "send-" + suffix + ".example.test"
	var adminID, domainID, configID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, two_factor_enabled, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "send-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if domainID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		}
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
	}()
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE', TRUE, TRUE, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainName, adminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	encryptedAPIKey, err := legacycrypto.Encrypt(encryptionKey, "resend-fixture-api-key")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domain_sending_configs (
			domain_id, provider, api_key_encrypted, from_name_default, reply_to_default,
			status, created_at, updated_at
		)
		VALUES ($1, 'RESEND', $2, 'Fixture Sender', $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID, encryptedAPIKey, "reply@"+domainName).Scan(&configID); err != nil {
		t.Fatal(err)
	}

	var sendCount atomic.Int64
	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.Host != "api.resend.com" || request.URL.Path != "/emails" {
			return nil, fmt.Errorf("unexpected Resend request %s %s", request.Method, request.URL.String())
		}
		if request.Header.Get("Authorization") != "Bearer resend-fixture-api-key" || request.Header.Get("Idempotency-Key") == "" {
			return nil, fmt.Errorf("invalid Resend authentication or idempotency headers")
		}
		return providerJSONResponse(http.StatusOK, fmt.Sprintf(`{"id":"resend-message-%d"}`, sendCount.Add(1))), nil
	})
	now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	server := &Server{
		cfg: config.GoBusinessAPIConfig{
			EncryptionKey: encryptionKey, JWTSecret: testJWTSecret,
			QueryTimeout: 10 * time.Second, ProviderTimeout: 5 * time.Second,
		},
		logger:             slog.New(slog.NewTextHandler(io.Discard, nil)),
		store:              store,
		providerHTTPClient: &http.Client{Transport: transport, Timeout: 5 * time.Second},
		now:                func() time.Time { return now },
	}

	authenticated := func(method, target string, body []byte) *http.Request {
		request := httptest.NewRequest(method, target, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		token := signTestJWT(t, adminID, "admin-console", now.Add(time.Hour))
		request.AddCookie(&http.Cookie{Name: "token", Value: token})
		return request
	}
	assertResponse := func(request *http.Request, expectedStatus int) map[string]any {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != expectedStatus {
			t.Fatalf("%s %s response = %d %s", request.Method, request.URL.Path, response.Code, response.Body.String())
		}
		var payload map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload
	}

	assertResponse(authenticated(http.MethodGet, "/admin/send/configs?domainId="+strconv.FormatInt(domainID, 10), nil), http.StatusOK)
	messageIDs := make([]string, 0, 2)
	for index := 0; index < 2; index++ {
		body, err := json.Marshal(map[string]any{
			"domainId": domainID, "from": "sender@" + domainName, "to": []string{"recipient@example.test"},
			"subject": fmt.Sprintf("fixture %d", index), "text": "fixture body",
		})
		if err != nil {
			t.Fatal(err)
		}
		payload := assertResponse(authenticated(http.MethodPost, "/admin/send/messages", body), http.StatusOK)
		data, ok := payload["data"].(map[string]any)
		if !ok || data["status"] != "SENT" {
			t.Fatalf("send payload = %#v", payload)
		}
		messageIDs = append(messageIDs, fmt.Sprint(data["id"]))
	}
	history := assertResponse(authenticated(http.MethodGet, "/admin/send/messages?domainId="+strconv.FormatInt(domainID, 10), nil), http.StatusOK)
	if !strings.Contains(fmt.Sprint(history), "resend-message-1") || !strings.Contains(fmt.Sprint(history), "resend-message-2") {
		t.Fatalf("outbound history = %#v", history)
	}
	assertResponse(authenticated(http.MethodDelete, "/admin/send/messages/"+messageIDs[0], nil), http.StatusOK)
	batchBody, err := json.Marshal(map[string]any{"ids": []string{messageIDs[1]}})
	if err != nil {
		t.Fatal(err)
	}
	assertResponse(authenticated(http.MethodPost, "/admin/send/messages/batch-delete", batchBody), http.StatusOK)
	assertResponse(authenticated(http.MethodDelete, "/admin/send/configs/"+strconv.FormatInt(configID, 10), nil), http.StatusOK)
}
