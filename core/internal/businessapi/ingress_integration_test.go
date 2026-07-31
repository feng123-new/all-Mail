package businessapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

func TestPostgresAPIKeyAndExternalRouteIntegrationIngress(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	redisURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("Go business PostgreSQL and Redis integration URLs are not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	limiter, err := newRedisRateLimiter(redisURL, 5*time.Second)
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	if _, err := limiter.command(ctx, "FLUSHDB"); err != nil {
		store.Close()
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = limiter.command(cleanupCtx, "FLUSHDB")
		limiter.Close()
		store.Close()
	}()

	secretEnvelope := encryptIngressTestSecret(t, testIngressEncryptionKey, testIngressSigningSecret)
	secretDigest := sha256.Sum256([]byte(testIngressSigningSecret))
	signingKeyHash := hex.EncodeToString(secretDigest[:])
	var adminID, domainID, mailboxID, endpointID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (
			username, password_hash, email, role, status, must_change_password,
			two_factor_enabled, session_version, created_at, updated_at
		)
		VALUES (
			'integration-ingress-admin', 'not-used', 'integration-ingress-admin@example.net',
			'SUPER_ADMIN', 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
		RETURNING id
	`).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (
			name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at
		)
		VALUES (
			'integration-ingress.example', 'ACTIVE', TRUE, FALSE, $1,
			CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
		RETURNING id
	`, adminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domain_mailboxes (
			domain_id, local_part, address, status, provisioning_mode, can_login,
			forward_mode, forward_to, created_at, updated_at
		)
		VALUES (
			$1, 'inbox', 'inbox@integration-ingress.example', 'ACTIVE', 'MANUAL', TRUE,
			'COPY', 'forward-target@example.net', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
		RETURNING id
	`, domainID).Scan(&mailboxID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO ingress_endpoints (
			domain_id, key_id, name, provider, signing_key_hash,
			signing_secret_encrypted, status, created_at, updated_at
		)
		VALUES (
			$1, $2, 'integration ingress', 'CLOUDFLARE_WORKER', $3,
			$4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
		RETURNING id
	`, domainID, testIngressKeyID, signingKeyHash, secretEnvelope).Scan(&endpointID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM ingress_endpoints WHERE id = $1`, endpointID)
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
	})

	cfg := config.GoBusinessAPIConfig{
		Port:               3200,
		DatabaseURL:        databaseURL,
		RedisURL:           redisURL,
		JWTSecret:          testJWTSecret,
		EncryptionKey:      testIngressEncryptionKey,
		IngressAllowedSkew: 5 * time.Minute,
		ReadyTimeout:       5 * time.Second,
		QueryTimeout:       10 * time.Second,
		ShutdownTimeout:    5 * time.Second,
	}
	server := newWithDependencies(
		cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		store,
		store,
		store,
		limiter,
	)
	server.ingressStore = store
	server.replayProtector = limiter
	fixedNow := time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return fixedNow }

	body := integrationIngressBody("integration-delivery-key")
	first := signedIngressRequest(t, body, testIngressSigningSecret, fixedNow)
	first.Header.Set("X-Request-Id", "integration-ingress-request-1")
	firstResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(firstResponse, first)
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("first ingress response = %d %s", firstResponse.Code, firstResponse.Body.String())
	}
	var firstPayload struct {
		Success bool          `json:"success"`
		Data    IngressResult `json:"data"`
	}
	if err := json.Unmarshal(firstResponse.Body.Bytes(), &firstPayload); err != nil {
		t.Fatal(err)
	}
	if !firstPayload.Success || firstPayload.Data.Duplicate || firstPayload.Data.Route != "EXACT_MAILBOX" ||
		firstPayload.Data.DomainID != domainID || firstPayload.Data.MailboxID != mailboxID {
		t.Fatalf("first ingress payload = %#v", firstPayload)
	}

	var inboundCount, forwardCount int64
	var verificationCode, rawObjectKey string
	if err := store.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint, COALESCE(MAX(verification_code), ''), COALESCE(MAX(raw_object_key), '')
		FROM inbound_messages
		WHERE domain_id = $1 AND delivery_key = 'integration-delivery-key'
	`, domainID).Scan(&inboundCount, &verificationCode, &rawObjectKey); err != nil {
		t.Fatal(err)
	}
	if inboundCount != 1 || verificationCode != "654321" || rawObjectKey != "allmail-edge/raw/ab/integration-delivery-key.eml" {
		t.Fatalf("persisted ingress = count %d code %q key %q", inboundCount, verificationCode, rawObjectKey)
	}
	if err := store.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM mailbox_forward_jobs AS job
		JOIN inbound_messages AS message ON message.id = job.inbound_message_id
		WHERE message.domain_id = $1
		  AND message.delivery_key = 'integration-delivery-key'
		  AND job.status = 'PENDING'
	`, domainID).Scan(&forwardCount); err != nil {
		t.Fatal(err)
	}
	if forwardCount != 1 {
		t.Fatalf("forward jobs = %d, want 1", forwardCount)
	}
	var endpointUsed bool
	if err := store.pool.QueryRow(ctx, `SELECT last_used_at IS NOT NULL FROM ingress_endpoints WHERE id = $1`, endpointID).Scan(&endpointUsed); err != nil {
		t.Fatal(err)
	}
	if !endpointUsed {
		t.Fatal("ingress endpoint usage timestamp was not updated")
	}

	replayRequest := signedIngressRequest(t, body, testIngressSigningSecret, fixedNow)
	replayRequest.Header.Set("X-Request-Id", "integration-ingress-request-replay")
	replayResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(replayResponse, replayRequest)
	if replayResponse.Code != http.StatusConflict || !strings.Contains(replayResponse.Body.String(), "INGRESS_REPLAY_DETECTED") {
		t.Fatalf("replay response = %d %s", replayResponse.Code, replayResponse.Body.String())
	}

	replayKey := fmt.Sprintf("ingress:replay:%s:%s", testIngressKeyID, "integration-delivery-key")
	if err := limiter.Release(ctx, replayKey, "integration-ingress-request-1"); err != nil {
		t.Fatal(err)
	}
	duplicateRequest := signedIngressRequest(t, body, testIngressSigningSecret, fixedNow)
	duplicateRequest.Header.Set("X-Request-Id", "integration-ingress-request-duplicate")
	duplicateResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(duplicateResponse, duplicateRequest)
	if duplicateResponse.Code != http.StatusOK || !strings.Contains(duplicateResponse.Body.String(), `"duplicate":true`) {
		t.Fatalf("duplicate response = %d %s", duplicateResponse.Code, duplicateResponse.Body.String())
	}
	if err := store.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM inbound_messages
		WHERE domain_id = $1 AND delivery_key = 'integration-delivery-key'
	`, domainID).Scan(&inboundCount); err != nil {
		t.Fatal(err)
	}
	if inboundCount != 1 {
		t.Fatalf("duplicate ingress created %d messages", inboundCount)
	}
}

func integrationIngressBody(deliveryKey string) string {
	return fmt.Sprintf(`{
		"provider":"CLOUDFLARE_EMAIL_ROUTING",
		"deliveryKey":%q,
		"receivedAt":"2026-07-30T00:00:00Z",
		"envelope":{"from":"sender@example.net","to":"inbox@integration-ingress.example"},
		"routing":{
			"domain":"integration-ingress.example",
			"localPart":"inbox",
			"matchedAddress":"inbox@integration-ingress.example"
		},
		"message":{
			"messageId":"<integration-message@example.net>",
			"subject":"Integration verification",
			"textPreview":"Your verification code is 654321",
			"headers":{"message-id":"<integration-message@example.net>"},
			"attachments":[],
			"rawObjectKey":"allmail-edge/raw/ab/integration-delivery-key.eml",
			"storageStatus":"STORED"
		}
	}`, deliveryKey)
}
