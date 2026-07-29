package jobs

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"github.com/feng123-new/all-Mail/core/internal/provider"
	"github.com/jackc/pgx/v5/pgxpool"
)

type capturedForwardRequest struct {
	IdempotencyKey string
	Authorization  string
	Payload        provider.SendRequest
}

type forwardingScenario struct {
	Mode          string
	MailboxMode   string
	JobStatus     string
	AttemptCount  int
	NextAttemptAt *time.Time
	ClaimToken    *string
	LeaseExpires  *time.Time
}

type seededForwardingScenario struct {
	JobID     int64
	MessageID int64
}

func TestPostgresForwardingIntegration(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_FORWARDING_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_FORWARDING_TEST_DATABASE_URL is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatal(err)
	}

	var responseStatus atomic.Int32
	responseStatus.Store(http.StatusOK)
	var responseSequence atomic.Int64
	requests := make(chan capturedForwardRequest, 32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload provider.SendRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requests <- capturedForwardRequest{
			IdempotencyKey: r.Header.Get("Idempotency-Key"),
			Authorization:  r.Header.Get("Authorization"),
			Payload:        payload,
		}
		status := int(responseStatus.Load())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if status >= 200 && status < 300 {
			_, _ = fmt.Fprintf(w, `{"id":"provider-%d"}`, responseSequence.Add(1))
			return
		}
		_, _ = fmt.Fprintf(w, `{"message":"provider status %d","name":"provider_error"}`, status)
	}))
	defer server.Close()

	const encryptionSecret = "integration-encryption-secret"
	store, err := newPostgresForwardingStore(ctx, databaseURL, 3*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	worker := newForwardingWorker(
		store,
		provider.NewResendClient(server.URL, server.Client()),
		func(value string) (string, error) { return legacycrypto.Decrypt(encryptionSecret, value) },
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		10,
	)

	clean := func(t *testing.T) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			TRUNCATE TABLE mailbox_forward_jobs, inbound_messages, domain_sending_configs,
				domain_mailboxes, domains, admins RESTART IDENTITY CASCADE`); err != nil {
			t.Fatal(err)
		}
		drainForwardRequests(requests)
		responseStatus.Store(http.StatusOK)
	}

	t.Run("copy marks the job sent and preserves the message", func(t *testing.T) {
		clean(t)
		now := time.Now().UTC()
		seed := seedForwardingScenario(t, ctx, pool, encryptionSecret, now, forwardingScenario{
			Mode:        "COPY",
			MailboxMode: "COPY",
			JobStatus:   "PENDING",
		})
		if err := worker.runOnce(ctx, now); err != nil {
			t.Fatal(err)
		}
		status, attempts, providerID, nextAttempt, lastError := loadForwardingJobState(t, ctx, pool, seed.JobID)
		if status != "SENT" || attempts != 1 || providerID == "" || nextAttempt != nil || lastError != "" {
			t.Fatalf("job state = status=%s attempts=%d provider=%q next=%v error=%q", status, attempts, providerID, nextAttempt, lastError)
		}
		if portal := loadPortalState(t, ctx, pool, seed.MessageID); portal != "VISIBLE" {
			t.Fatalf("portal state = %s, want VISIBLE", portal)
		}
		request := receiveForwardRequest(t, requests)
		if request.IdempotencyKey != fmt.Sprintf("mailbox-forward/%d/%d", seed.JobID, seed.MessageID) {
			t.Fatalf("idempotency key = %q", request.IdempotencyKey)
		}
		if request.Authorization != "Bearer re_integration_secret" {
			t.Fatalf("authorization = %q", request.Authorization)
		}
	})

	t.Run("move marks the job sent and hides the message", func(t *testing.T) {
		clean(t)
		now := time.Now().UTC()
		seed := seedForwardingScenario(t, ctx, pool, encryptionSecret, now, forwardingScenario{
			Mode:        "MOVE",
			MailboxMode: "MOVE",
			JobStatus:   "PENDING",
		})
		if err := worker.runOnce(ctx, now); err != nil {
			t.Fatal(err)
		}
		if portal := loadPortalState(t, ctx, pool, seed.MessageID); portal != "FORWARDED_HIDDEN" {
			t.Fatalf("portal state = %s, want FORWARDED_HIDDEN", portal)
		}
		if status, _, _, _, _ := loadForwardingJobState(t, ctx, pool, seed.JobID); status != "SENT" {
			t.Fatalf("job status = %s, want SENT", status)
		}
		_ = receiveForwardRequest(t, requests)
	})

	t.Run("retryable provider failure keeps a stable idempotency key", func(t *testing.T) {
		clean(t)
		now := time.Now().UTC()
		seed := seedForwardingScenario(t, ctx, pool, encryptionSecret, now, forwardingScenario{
			Mode:        "COPY",
			MailboxMode: "COPY",
			JobStatus:   "PENDING",
		})
		responseStatus.Store(http.StatusServiceUnavailable)
		if err := worker.runOnce(ctx, now); err != nil {
			t.Fatal(err)
		}
		first := receiveForwardRequest(t, requests)
		status, attempts, _, nextAttempt, _ := loadForwardingJobState(t, ctx, pool, seed.JobID)
		if status != "FAILED" || attempts != 1 || nextAttempt == nil {
			t.Fatalf("failed state = status=%s attempts=%d next=%v", status, attempts, nextAttempt)
		}

		responseStatus.Store(http.StatusOK)
		if err := worker.runOnce(ctx, nextAttempt.Add(time.Second)); err != nil {
			t.Fatal(err)
		}
		second := receiveForwardRequest(t, requests)
		if first.IdempotencyKey != second.IdempotencyKey {
			t.Fatalf("idempotency key changed: %q -> %q", first.IdempotencyKey, second.IdempotencyKey)
		}
		if status, attempts, _, _, _ := loadForwardingJobState(t, ctx, pool, seed.JobID); status != "SENT" || attempts != 2 {
			t.Fatalf("retry state = status=%s attempts=%d", status, attempts)
		}
	})

	t.Run("permanent provider failure is not rescheduled", func(t *testing.T) {
		clean(t)
		now := time.Now().UTC()
		seed := seedForwardingScenario(t, ctx, pool, encryptionSecret, now, forwardingScenario{
			Mode:        "COPY",
			MailboxMode: "COPY",
			JobStatus:   "PENDING",
		})
		responseStatus.Store(http.StatusBadRequest)
		if err := worker.runOnce(ctx, now); err != nil {
			t.Fatal(err)
		}
		_ = receiveForwardRequest(t, requests)
		status, attempts, _, nextAttempt, _ := loadForwardingJobState(t, ctx, pool, seed.JobID)
		if status != "FAILED" || attempts != 1 || nextAttempt != nil {
			t.Fatalf("permanent failure state = status=%s attempts=%d next=%v", status, attempts, nextAttempt)
		}
	})

	t.Run("changed mailbox configuration skips the job without sending", func(t *testing.T) {
		clean(t)
		now := time.Now().UTC()
		seed := seedForwardingScenario(t, ctx, pool, encryptionSecret, now, forwardingScenario{
			Mode:        "COPY",
			MailboxMode: "DISABLED",
			JobStatus:   "PENDING",
		})
		if err := worker.runOnce(ctx, now); err != nil {
			t.Fatal(err)
		}
		status, _, _, nextAttempt, _ := loadForwardingJobState(t, ctx, pool, seed.JobID)
		if status != "SKIPPED" || nextAttempt != nil {
			t.Fatalf("skip state = status=%s next=%v", status, nextAttempt)
		}
		select {
		case request := <-requests:
			t.Fatalf("unexpected provider request: %#v", request)
		default:
		}
	})

	t.Run("expired lease is reclaimed", func(t *testing.T) {
		clean(t)
		now := time.Now().UTC()
		oldToken := "old-owner-token"
		expired := now.Add(-time.Minute)
		seed := seedForwardingScenario(t, ctx, pool, encryptionSecret, now, forwardingScenario{
			Mode:          "COPY",
			MailboxMode:   "COPY",
			JobStatus:     "RUNNING",
			ClaimToken:    &oldToken,
			LeaseExpires:  &expired,
			NextAttemptAt: &expired,
		})
		if err := worker.runOnce(ctx, now); err != nil {
			t.Fatal(err)
		}
		if status, _, _, _, _ := loadForwardingJobState(t, ctx, pool, seed.JobID); status != "SENT" {
			t.Fatalf("reclaimed status = %s, want SENT", status)
		}
		_ = receiveForwardRequest(t, requests)
	})

	t.Run("claim token fences stale terminal updates", func(t *testing.T) {
		clean(t)
		now := time.Now().UTC()
		seed := seedForwardingScenario(t, ctx, pool, encryptionSecret, now, forwardingScenario{
			Mode:        "COPY",
			MailboxMode: "COPY",
			JobStatus:   "PENDING",
		})
		claims, err := store.Claim(ctx, 1, now)
		if err != nil {
			t.Fatal(err)
		}
		if len(claims) != 1 {
			t.Fatalf("claims = %d, want 1", len(claims))
		}
		job, err := store.Load(ctx, seed.JobID, claims[0].ClaimToken)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE mailbox_forward_jobs SET claim_token = 'new-owner-token' WHERE id = $1`, seed.JobID); err != nil {
			t.Fatal(err)
		}
		err = store.MarkSkipped(ctx, job, "stale", now)
		if !errors.Is(err, errClaimLost) {
			t.Fatalf("MarkSkipped() error = %v, want errClaimLost", err)
		}
	})

	t.Run("advisory lock enforces a single forwarding runtime", func(t *testing.T) {
		clean(t)
		first, err := acquireForwardingOwner(ctx, databaseURL)
		if err != nil {
			t.Fatal(err)
		}
		defer first.Close(context.Background())
		second, err := acquireForwardingOwner(ctx, databaseURL)
		if err == nil {
			second.Close(context.Background())
			t.Fatal("second forwarding owner unexpectedly acquired the lock")
		}
	})
}

func seedForwardingScenario(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	encryptionSecret string,
	now time.Time,
	scenario forwardingScenario,
) seededForwardingScenario {
	t.Helper()
	if scenario.Mode == "" {
		scenario.Mode = "COPY"
	}
	if scenario.MailboxMode == "" {
		scenario.MailboxMode = scenario.Mode
	}
	if scenario.JobStatus == "" {
		scenario.JobStatus = "PENDING"
	}
	if scenario.NextAttemptAt == nil {
		value := now.Add(-time.Second)
		scenario.NextAttemptAt = &value
	}
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	var adminID int
	if err := pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, created_at, updated_at)
		VALUES ($1, 'hash', $2, $2)
		RETURNING id`, "integration-admin-"+unique, now).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	var domainID int
	if err := pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE'::"DomainStatus", true, true, $2, $3, $3)
		RETURNING id`, "integration-"+unique+".example", adminID, now).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	encryptedAPIKey := encryptLegacyValue(t, encryptionSecret, "re_integration_secret")
	if _, err := pool.Exec(ctx, `
		INSERT INTO domain_sending_configs
			(domain_id, provider, api_key_encrypted, from_name_default, status, created_at, updated_at)
		VALUES ($1, 'RESEND'::"SendProvider", $2, 'Integration Forwarder', 'ACTIVE'::"Status", $3, $3)`,
		domainID, encryptedAPIKey, now); err != nil {
		t.Fatal(err)
	}
	address := "inbox-" + unique + "@integration.example"
	var mailboxID int
	if err := pool.QueryRow(ctx, `
		INSERT INTO domain_mailboxes
			(domain_id, local_part, address, status, forward_mode, forward_to, created_at, updated_at)
		VALUES ($1, $2, $3, 'ACTIVE'::"DomainMailboxStatus", $4::"ForwardMode", 'target@example.net', $5, $5)
		RETURNING id`, domainID, "inbox-"+unique, address, scenario.MailboxMode, now).Scan(&mailboxID); err != nil {
		t.Fatal(err)
	}
	var messageID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO inbound_messages
			(domain_id, mailbox_id, matched_address, final_address, delivery_key,
			 from_address, to_address, subject, text_preview, html_preview, route_kind,
			 received_at, portal_state, created_at, updated_at)
		VALUES ($1, $2, $3, $3, $4, 'sender@example.org', $3, 'Integration subject',
			'Integration body', '<p>Integration body</p>', 'EXACT_MAILBOX', $5,
			'VISIBLE'::"PortalState", $5, $5)
		RETURNING id`, domainID, mailboxID, address, "delivery-"+unique, now).Scan(&messageID); err != nil {
		t.Fatal(err)
	}
	var jobID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO mailbox_forward_jobs
			(inbound_message_id, mailbox_id, mode, forward_to, status, attempt_count,
			 next_attempt_at, claim_token, lease_expires_at, created_at, updated_at)
		VALUES ($1, $2, $3::"ForwardMode", 'target@example.net', $4::"ForwardJobStatus", $5,
			$6, $7, $8, $9, $9)
		RETURNING id`,
		messageID,
		mailboxID,
		scenario.Mode,
		scenario.JobStatus,
		scenario.AttemptCount,
		scenario.NextAttemptAt,
		scenario.ClaimToken,
		scenario.LeaseExpires,
		now,
	).Scan(&jobID); err != nil {
		t.Fatal(err)
	}
	return seededForwardingScenario{JobID: jobID, MessageID: messageID}
}

func loadForwardingJobState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, jobID int64) (string, int, string, *time.Time, string) {
	t.Helper()
	var status string
	var attempts int
	var providerID string
	var nextAttempt *time.Time
	var lastError string
	if err := pool.QueryRow(ctx, `
		SELECT status::text, attempt_count, COALESCE(provider_message_id, ''),
			next_attempt_at, COALESCE(last_error, '')
		FROM mailbox_forward_jobs WHERE id = $1`, jobID).Scan(
		&status,
		&attempts,
		&providerID,
		&nextAttempt,
		&lastError,
	); err != nil {
		t.Fatal(err)
	}
	return status, attempts, providerID, nextAttempt, lastError
}

func loadPortalState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, messageID int64) string {
	t.Helper()
	var state string
	if err := pool.QueryRow(ctx, `SELECT portal_state::text FROM inbound_messages WHERE id = $1`, messageID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	return state
}

func receiveForwardRequest(t *testing.T, requests <-chan capturedForwardRequest) capturedForwardRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(time.Second):
		t.Fatal("provider request was not received")
		return capturedForwardRequest{}
	}
}

func drainForwardRequests(requests <-chan capturedForwardRequest) {
	for {
		select {
		case <-requests:
		default:
			return
		}
	}
}

func encryptLegacyValue(t *testing.T, secret, plaintext string) string {
	t.Helper()
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	tagStart := len(sealed) - gcm.Overhead()
	return fmt.Sprintf(
		"%s:%s:%s",
		hex.EncodeToString(nonce),
		hex.EncodeToString(sealed[tagStart:]),
		hex.EncodeToString(sealed[:tagStart]),
	)
}
