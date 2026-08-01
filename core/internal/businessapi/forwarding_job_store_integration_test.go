package businessapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

type forwardingJobFixtureOptions struct {
	Status          string
	Mode            string
	AttemptCount    int
	LastError       string
	ProviderMessage string
	NextAttemptAt   *time.Time
	ClaimToken      string
	LeaseExpiresAt  *time.Time
	PortalState     string
	Subject         string
	TextPreview     string
	HTMLPreview     string
	CreatedAt       time.Time
}

type forwardingJobFixture struct {
	AdminID   int64
	DomainID  int64
	MailboxID int64
	MessageID int64
	JobID     int64
	CreatedAt time.Time
}

func TestPostgresForwardingJobAdminReadParity(t *testing.T) {
	store, ctx := forwardingJobIntegrationStore(t)
	marker := fmt.Sprintf("forwarding-read-%d", time.Now().UnixNano())
	baseTime := time.Date(2026, 4, 2, 12, 0, 0, 0, time.UTC)
	fullError := strings.Repeat("delivery failure ", 20)
	older := seedForwardingJobAdminFixture(t, ctx, store, forwardingJobFixtureOptions{
		Status: "FAILED", Mode: "MOVE", AttemptCount: 2, LastError: fullError,
		Subject: marker + " older", TextPreview: "plain body", HTMLPreview: "<p>html body</p>", CreatedAt: baseTime,
	})
	newer := seedForwardingJobAdminFixture(t, ctx, store, forwardingJobFixtureOptions{
		Status: "FAILED", Mode: "MOVE", AttemptCount: 1, LastError: "newer failure",
		Subject: marker + " newer", CreatedAt: baseTime.Add(time.Minute),
	})

	ordered, err := store.ListForwardingJobs(ctx, forwardingJobListInput{
		Page: 1, PageSize: 20, Status: "FAILED", Mode: "MOVE", Keyword: strings.ToUpper(marker),
	})
	if err != nil {
		t.Fatal(err)
	}
	if ordered.Total != 2 || len(ordered.List) != 2 || ordered.List[0].ID != fmt.Sprint(newer.JobID) || ordered.List[1].ID != fmt.Sprint(older.JobID) {
		t.Fatalf("ordered forwarding jobs = %#v", ordered)
	}

	filtered, err := store.ListForwardingJobs(ctx, forwardingJobListInput{
		Page: 1, PageSize: 5, Status: "FAILED", Mode: "MOVE",
		MailboxID: &older.MailboxID, DomainID: &older.DomainID, Keyword: marker,
	})
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Total != 1 || len(filtered.List) != 1 {
		t.Fatalf("filtered forwarding jobs = %#v", filtered)
	}
	item := filtered.List[0]
	if item.ID != fmt.Sprint(older.JobID) || item.InboundMessageID != fmt.Sprint(older.MessageID) ||
		item.Mailbox == nil || item.Mailbox.ID != older.MailboxID || item.Domain.ID != older.DomainID ||
		item.InboundMessage.Subject == nil || *item.InboundMessage.Subject != marker+" older" {
		t.Fatalf("forwarding list item = %#v", item)
	}
	if item.LastError == nil || utf8.RuneCountInString(*item.LastError) != 160 || !strings.HasSuffix(*item.LastError, "\u2026") {
		t.Fatalf("forwarding error preview = %q", valueOrEmpty(item.LastError))
	}

	detail, err := store.GetForwardingJob(ctx, older.JobID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.ID != fmt.Sprint(older.JobID) || detail.LastError == nil || *detail.LastError != fullError ||
		detail.Mailbox == nil || detail.Mailbox.ForwardMode != "MOVE" ||
		!detail.InboundMessage.HasTextPreview || !detail.InboundMessage.HasHTMLPreview {
		t.Fatalf("forwarding detail = %#v", detail)
	}

	_, err = store.GetForwardingJob(ctx, older.JobID+9_000_000_000)
	assertForwardingRequestError(t, err, http.StatusNotFound, "FORWARDING_JOB_NOT_FOUND")
}

func TestPostgresForwardingJobRequeueTransitions(t *testing.T) {
	store, ctx := forwardingJobIntegrationStore(t)
	requeueAt := time.Date(2026, 4, 2, 13, 0, 0, 0, time.UTC)
	futureRetry := requeueAt.Add(10 * time.Minute)
	staleLease := requeueAt.Add(-time.Minute)

	for _, testCase := range []struct {
		name   string
		status string
		next   *time.Time
	}{
		{name: "scheduled failed", status: "FAILED", next: &futureRetry},
		{name: "terminal failed", status: "FAILED"},
		{name: "skipped", status: "SKIPPED"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := seedForwardingJobAdminFixture(t, ctx, store, forwardingJobFixtureOptions{
				Status: testCase.status, Mode: "COPY", AttemptCount: 3, LastError: "terminal failure",
				ProviderMessage: "stale-provider-id", NextAttemptAt: testCase.next,
				ClaimToken: "stale-terminal-token", LeaseExpiresAt: &staleLease,
				PortalState: "FORWARDED_HIDDEN", Subject: "requeue " + testCase.name,
				CreatedAt: requeueAt.Add(-time.Hour),
			})

			result, err := store.RequeueForwardingJob(ctx, fixture.JobID, requeueAt)
			if err != nil {
				t.Fatal(err)
			}
			if result.ID != fmt.Sprint(fixture.JobID) || result.Status != "PENDING" || result.AttemptCount != 0 ||
				result.LastError != nil || result.ProviderMessageID != nil || result.ProcessedAt != nil ||
				result.NextAttemptAt != formatAPITime(requeueAt) || result.UpdatedAt != formatAPITime(requeueAt) {
				t.Fatalf("requeue result = %#v", result)
			}

			var status, mode, forwardTo, portalState string
			var attemptCount int
			var inboundMessageID int64
			var mailboxID int64
			var lastError, providerMessageID, claimToken sql.NullString
			var nextAttemptAt, processedAt, leaseExpiresAt sql.NullTime
			var createdAt, updatedAt time.Time
			err = store.pool.QueryRow(ctx, `
				SELECT job.status::text, job.attempt_count, job.last_error, job.provider_message_id,
				       job.next_attempt_at, job.processed_at, job.claim_token, job.lease_expires_at,
				       job.inbound_message_id, job.mailbox_id, job.mode::text, job.forward_to,
				       job.created_at, job.updated_at, message.portal_state::text
				FROM mailbox_forward_jobs AS job
				JOIN inbound_messages AS message ON message.id = job.inbound_message_id
				WHERE job.id = $1
			`, fixture.JobID).Scan(
				&status, &attemptCount, &lastError, &providerMessageID,
				&nextAttemptAt, &processedAt, &claimToken, &leaseExpiresAt,
				&inboundMessageID, &mailboxID, &mode, &forwardTo,
				&createdAt, &updatedAt, &portalState,
			)
			if err != nil {
				t.Fatal(err)
			}
			if status != "PENDING" || attemptCount != 0 || lastError.Valid || providerMessageID.Valid ||
				!nextAttemptAt.Valid || !nextAttemptAt.Time.Equal(requeueAt) || processedAt.Valid || claimToken.Valid || leaseExpiresAt.Valid {
				t.Fatalf("persisted reset = status=%s attempts=%d error=%v provider=%v next=%v processed=%v claim=%v lease=%v",
					status, attemptCount, lastError, providerMessageID, nextAttemptAt, processedAt, claimToken, leaseExpiresAt)
			}
			if inboundMessageID != fixture.MessageID || mailboxID != fixture.MailboxID || mode != "COPY" ||
				forwardTo != "target@example.net" || !createdAt.Equal(fixture.CreatedAt) || !updatedAt.Equal(requeueAt) || portalState != "FORWARDED_HIDDEN" {
				t.Fatalf("requeue changed immutable data: message=%d mailbox=%d mode=%s target=%s created=%v updated=%v portal=%s",
					inboundMessageID, mailboxID, mode, forwardTo, createdAt, updatedAt, portalState)
			}
		})
	}
}

func TestPostgresForwardingJobRequeueDeniesNonTerminalStates(t *testing.T) {
	store, ctx := forwardingJobIntegrationStore(t)
	now := time.Date(2026, 4, 2, 13, 0, 0, 0, time.UTC)
	activeLease := now.Add(time.Minute)
	expiredLease := now.Add(-time.Minute)

	for _, testCase := range []struct {
		name       string
		status     string
		next       *time.Time
		claimToken string
		lease      *time.Time
		providerID string
	}{
		{name: "pending", status: "PENDING", next: &now},
		{name: "running active lease", status: "RUNNING", next: &now, claimToken: "active-worker", lease: &activeLease},
		{name: "running expired lease", status: "RUNNING", next: &now, claimToken: "expired-worker", lease: &expiredLease},
		{name: "sent", status: "SENT", providerID: "provider-sent"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := seedForwardingJobAdminFixture(t, ctx, store, forwardingJobFixtureOptions{
				Status: testCase.status, Mode: "COPY", AttemptCount: 4, LastError: "preserve me",
				ProviderMessage: testCase.providerID, NextAttemptAt: testCase.next,
				ClaimToken: testCase.claimToken, LeaseExpiresAt: testCase.lease,
				Subject: "denied " + testCase.name, CreatedAt: now.Add(-time.Hour),
			})

			_, err := store.RequeueForwardingJob(ctx, fixture.JobID, now)
			assertForwardingRequestError(t, err, http.StatusBadRequest, "FORWARDING_JOB_REQUEUE_NOT_ALLOWED")

			var status string
			var attemptCount int
			var claimToken, providerMessageID sql.NullString
			if err := store.pool.QueryRow(ctx, `
				SELECT status::text, attempt_count, claim_token, provider_message_id
				FROM mailbox_forward_jobs WHERE id = $1
			`, fixture.JobID).Scan(&status, &attemptCount, &claimToken, &providerMessageID); err != nil {
				t.Fatal(err)
			}
			if status != testCase.status || attemptCount != 4 || valueOrEmpty(nullableStringValue(claimToken)) != testCase.claimToken ||
				valueOrEmpty(nullableStringValue(providerMessageID)) != testCase.providerID {
				t.Fatalf("denied state changed: status=%s attempts=%d claim=%v provider=%v", status, attemptCount, claimToken, providerMessageID)
			}
		})
	}
}

func TestPostgresForwardingJobRequeueCannotStealConcurrentWorkerClaim(t *testing.T) {
	store, ctx := forwardingJobIntegrationStore(t)
	now := time.Date(2026, 4, 2, 13, 0, 0, 0, time.UTC)
	fixture := seedForwardingJobAdminFixture(t, ctx, store, forwardingJobFixtureOptions{
		Status: "FAILED", Mode: "COPY", AttemptCount: 2, LastError: "retryable",
		NextAttemptAt: &now, Subject: "worker race", CreatedAt: now.Add(-time.Hour),
	})

	workerTx, err := store.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer workerTx.Rollback(context.Background())
	workerToken := "concurrent-worker-token"
	leaseExpiresAt := now.Add(3 * time.Minute)
	if _, err := workerTx.Exec(ctx, `
		UPDATE mailbox_forward_jobs
		SET status = 'RUNNING'::"ForwardJobStatus", claim_token = $2, lease_expires_at = $3, updated_at = $4
		WHERE id = $1 AND status = 'FAILED'::"ForwardJobStatus"
	`, fixture.JobID, workerToken, leaseExpiresAt, now); err != nil {
		t.Fatal(err)
	}

	result := make(chan error, 1)
	go func() {
		_, requeueErr := store.RequeueForwardingJob(ctx, fixture.JobID, now.Add(time.Second))
		result <- requeueErr
	}()
	select {
	case err := <-result:
		t.Fatalf("requeue returned before worker transaction completed: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := workerTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		assertForwardingRequestError(t, err, http.StatusBadRequest, "FORWARDING_JOB_REQUEUE_NOT_ALLOWED")
	case <-time.After(5 * time.Second):
		t.Fatal("requeue did not finish after worker claim committed")
	}

	var status, claimToken string
	if err := store.pool.QueryRow(ctx, `SELECT status::text, claim_token FROM mailbox_forward_jobs WHERE id = $1`, fixture.JobID).Scan(&status, &claimToken); err != nil {
		t.Fatal(err)
	}
	if status != "RUNNING" || claimToken != workerToken {
		t.Fatalf("worker claim was stolen: status=%s token=%s", status, claimToken)
	}
}

func forwardingJobIntegrationStore(t *testing.T) (*PostgresStore, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	return store, ctx
}

func seedForwardingJobAdminFixture(t *testing.T, ctx context.Context, store *PostgresStore, options forwardingJobFixtureOptions) forwardingJobFixture {
	t.Helper()
	if options.Mode == "" {
		options.Mode = "COPY"
	}
	if options.PortalState == "" {
		options.PortalState = "VISIBLE"
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	}
	unique := fmt.Sprintf("%d", time.Now().UnixNano())
	fixture := forwardingJobFixture{CreatedAt: options.CreatedAt}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, created_at, updated_at)
		VALUES ($1, 'fixture', $2, $2)
		RETURNING id
	`, "forwarding-admin-"+unique, options.CreatedAt).Scan(&fixture.AdminID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if fixture.DomainID != 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, fixture.DomainID)
		}
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, fixture.AdminID)
	})
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE'::"DomainStatus", TRUE, TRUE, $2, $3, $3)
		RETURNING id
	`, "forwarding-"+unique+".example", fixture.AdminID, options.CreatedAt).Scan(&fixture.DomainID); err != nil {
		t.Fatal(err)
	}
	address := "inbox-" + unique + "@example.test"
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domain_mailboxes
			(domain_id, local_part, address, status, provisioning_mode, forward_mode, forward_to, created_at, updated_at)
		VALUES ($1, $2, $3, 'ACTIVE'::"DomainMailboxStatus", 'MANUAL'::"DomainMailboxProvisioningMode",
			$4::"ForwardMode", 'target@example.net', $5, $5)
		RETURNING id
	`, fixture.DomainID, "inbox-"+unique, address, options.Mode, options.CreatedAt).Scan(&fixture.MailboxID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO inbound_messages
			(domain_id, mailbox_id, matched_address, final_address, delivery_key, from_address, to_address,
			 subject, text_preview, html_preview, route_kind, received_at, portal_state, created_at, updated_at)
		VALUES ($1, $2, $3, $3, $4, 'sender@example.org', $3, $5, $6, $7, 'EXACT_MAILBOX',
			$8, $9::"PortalState", $8, $8)
		RETURNING id
	`, fixture.DomainID, fixture.MailboxID, address, "delivery-"+unique, options.Subject,
		nullableFixtureString(options.TextPreview), nullableFixtureString(options.HTMLPreview), options.CreatedAt,
		options.PortalState).Scan(&fixture.MessageID); err != nil {
		t.Fatal(err)
	}
	processedAt := options.CreatedAt.Add(time.Minute)
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO mailbox_forward_jobs
			(inbound_message_id, mailbox_id, mode, forward_to, status, attempt_count, last_error,
			 provider_message_id, next_attempt_at, processed_at, claim_token, lease_expires_at, created_at, updated_at)
		VALUES ($1, $2, $3::"ForwardMode", 'target@example.net', $4::"ForwardJobStatus", $5, $6,
			$7, $8, $9, $10, $11, $12, $12)
		RETURNING id
	`, fixture.MessageID, fixture.MailboxID, options.Mode, options.Status, options.AttemptCount,
		nullableFixtureString(options.LastError), nullableFixtureString(options.ProviderMessage), options.NextAttemptAt,
		processedAt, nullableFixtureString(options.ClaimToken), options.LeaseExpiresAt, options.CreatedAt).Scan(&fixture.JobID); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func nullableFixtureString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func assertForwardingRequestError(t *testing.T, err error, status int, code string) {
	t.Helper()
	var requestErr *requestError
	if !errors.As(err, &requestErr) || requestErr.Status != status || requestErr.Code != code {
		t.Fatalf("request error = %#v, want status=%d code=%s", err, status, code)
	}
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
