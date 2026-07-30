package businessapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresAPIKeyAndExternalRouteIntegration(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	redisURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL and ALLMAIL_GO_BUSINESS_TEST_REDIS_URL are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `
		TRUNCATE TABLE
			api_logs, email_usage, domain_mailbox_usage, inbound_messages,
			domain_mailboxes, domains, email_accounts, email_groups, api_keys, admins
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatal(err)
	}

	var adminID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, updated_at)
		VALUES ('go-admin', 'unused', 'SUPER_ADMIN', 'ACTIVE', FALSE, CURRENT_TIMESTAMP)
		RETURNING id
	`).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	var groupID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO email_groups (name, updated_at)
		VALUES ('primary', CURRENT_TIMESTAMP)
		RETURNING id
	`).Scan(&groupID); err != nil {
		t.Fatal(err)
	}
	var emailID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO email_accounts (email, provider, auth_type, status, group_id, updated_at)
		VALUES ('pool@example.com', 'GMAIL', 'GOOGLE_OAUTH', 'ACTIVE', $1, CURRENT_TIMESTAMP)
		RETURNING id
	`, groupID).Scan(&emailID); err != nil {
		t.Fatal(err)
	}
	var domainID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, updated_at)
		VALUES ('example.org', 'ACTIVE', TRUE, TRUE, $1, CURRENT_TIMESTAMP)
		RETURNING id
	`, adminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	var mailboxID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO domain_mailboxes (
			domain_id, local_part, address, status, provisioning_mode, batch_tag, updated_at
		) VALUES ($1, 'pool', 'pool@example.org', 'ACTIVE', 'API_POOL', 'batch-a', CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID).Scan(&mailboxID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO inbound_messages (
			domain_id, mailbox_id, matched_address, final_address, delivery_key,
			from_address, to_address, subject, text_preview, received_at, updated_at
		) VALUES ($1, $2, 'pool@example.org', 'pool@example.org', 'delivery-1',
			'sender@example.net', 'pool@example.org', 'integration message', 'hello',
			CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, domainID, mailboxID); err != nil {
		t.Fatal(err)
	}

	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	limiter, err := newRedisRateLimiter(redisURL, 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err := limiter.Ping(ctx); err != nil {
		t.Fatal(err)
	}

	created, err := store.CreateAPIKey(ctx, APIKeyCreateInput{
		Name:             "integration",
		RateLimit:        100,
		Permissions:      map[string]bool{"*": true},
		AllowedGroupIDs:  []int64{groupID},
		AllowedEmailIDs:  []int64{emailID},
		AllowedDomainIDs: []int64{domainID},
	}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAPIKey(ctx, APIKeyCreateInput{
		Name: "invalid-scope", RateLimit: 60, AllowedDomainIDs: []int64{0},
	}, adminID); err == nil {
		t.Fatal("store accepted a non-positive domain scope")
	}
	if !strings.HasPrefix(created.Key, "sk_") || created.KeyPrefix != created.Key[:7] {
		t.Fatalf("created key = %#v", created)
	}
	digest := sha256.Sum256([]byte(created.Key))
	principal, err := store.FindAPIKeyByHash(ctx, hex.EncodeToString(digest[:]))
	if err != nil || principal.ID != created.ID || !permissionAllowed(principal.Permissions, actionDomainListMessages) {
		t.Fatalf("principal = %#v, err=%v", principal, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE api_keys SET permissions = '{"get_email":true}'::jsonb WHERE id = $1`, created.ID); err != nil {
		t.Fatal(err)
	}
	principal, err = store.FindAPIKeyByHash(ctx, hex.EncodeToString(digest[:]))
	if err != nil || !permissionAllowed(principal.Permissions, actionExternalAllocateMailbox) {
		t.Fatalf("legacy principal = %#v, err=%v", principal, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE api_keys SET permissions = '{"*":true}'::jsonb WHERE id = $1`, created.ID); err != nil {
		t.Fatal(err)
	}

	server := newWithDependencies(config.GoBusinessAPIConfig{
		Port:            3200,
		DatabaseURL:     databaseURL,
		RedisURL:        redisURL,
		JWTSecret:       testJWTSecret,
		ReadyTimeout:    3 * time.Second,
		QueryTimeout:    5 * time.Second,
		ShutdownTimeout: 3 * time.Second,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)), store, store, store, limiter)

	call := func(method, target string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, target, nil)
		request.Header.Set("X-API-Key", created.Key)
		request.Header.Set("X-Request-Id", "integration-request")
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		return response
	}
	if response := call(http.MethodGet, "/api/get-email?group=primary"); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "pool@example.com") {
		t.Fatalf("email allocation = %d %s", response.Code, response.Body.String())
	}
	if response := call(http.MethodGet, "/api/pool-stats?group=primary"); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"used":1`) {
		t.Fatalf("email stats = %d %s", response.Code, response.Body.String())
	}
	if response := call(http.MethodGet, "/api/domain-mail/get-mailbox?domain=example.org&batchTag=batch-a"); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "pool@example.org") {
		t.Fatalf("domain allocation = %d %s", response.Code, response.Body.String())
	}
	if response := call(http.MethodGet, "/api/domain-mail/messages/latest?email=pool@example.org"); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "integration message") {
		t.Fatalf("domain latest = %d %s", response.Code, response.Body.String())
	}

	limited, err := store.CreateAPIKey(ctx, APIKeyCreateInput{
		Name:        "limited",
		RateLimit:   1,
		Permissions: map[string]bool{actionExternalListMailboxes: true},
	}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	limitedCall := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "/api/list-emails", nil)
		request.Header.Set("X-API-Key", limited.Key)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		return response
	}
	if response := limitedCall(); response.Code != http.StatusOK {
		t.Fatalf("first limited call = %d %s", response.Code, response.Body.String())
	}
	if response := limitedCall(); response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), "RATE_LIMIT_EXCEEDED") {
		t.Fatalf("second limited call = %d %s", response.Code, response.Body.String())
	}

	var logCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM api_logs WHERE api_key_id = $1`, created.ID).Scan(&logCount); err != nil {
		t.Fatal(err)
	}
	if logCount < 4 {
		t.Fatalf("API log count = %d", logCount)
	}

	updated, err := store.UpdateAPIKey(ctx, created.ID, APIKeyUpdateInput{StatusSet: true, Status: "DISABLED"})
	if err != nil || updated.Status != "DISABLED" {
		t.Fatalf("updated = %#v, err=%v", updated, err)
	}
	if err := store.DeleteAPIKey(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
}
