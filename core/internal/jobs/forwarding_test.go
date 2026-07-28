package jobs

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/provider"
)

type fakeForwardingStore struct {
	job       forwardingJob
	sent      bool
	skipped   bool
	failed    bool
	retryAt   *time.Time
	lastError string
}

func (s *fakeForwardingStore) Claim(context.Context, int, time.Time) ([]claimedForwardJob, error) {
	return []claimedForwardJob{{ID: s.job.ID, ClaimToken: s.job.ClaimToken}}, nil
}

func (s *fakeForwardingStore) Load(context.Context, int64, string) (forwardingJob, error) {
	return s.job, nil
}

func (s *fakeForwardingStore) MarkSkipped(context.Context, forwardingJob, string, time.Time) error {
	s.skipped = true
	return nil
}

func (s *fakeForwardingStore) MarkFailed(_ context.Context, _ forwardingJob, message string, retryAt *time.Time, _ time.Time) error {
	s.failed = true
	s.lastError = message
	s.retryAt = retryAt
	return nil
}

func (s *fakeForwardingStore) MarkSent(context.Context, forwardingJob, string, time.Time) error {
	s.sent = true
	return nil
}

type fakeSender struct {
	request provider.SendRequest
	err     error
}

func (s *fakeSender) Send(_ context.Context, _ string, request provider.SendRequest) (provider.SendResult, error) {
	s.request = request
	return provider.SendResult{ID: "provider-1"}, s.err
}

func testForwardingJob() forwardingJob {
	return forwardingJob{
		ID:                 1,
		ClaimToken:         "claim-token",
		InboundMessageID:   10,
		Mode:               "COPY",
		ForwardTo:          "target@example.net",
		AttemptCount:       0,
		MailboxStatus:      "ACTIVE",
		MailboxForwardMode: "COPY",
		MailboxForwardTo:   "target@example.net",
		DomainStatus:       "ACTIVE",
		DomainCanSend:      true,
		APIKeyEncrypted:    "encrypted-key",
		FromNameDefault:    "Forwarder",
		MatchedAddress:     "inbox@example.com",
		FinalAddress:       "inbox@example.com",
		FromAddress:        "sender@example.org",
		Subject:            "Worker test",
		TextPreview:        "hello world",
		HTMLPreview:        "<p>hello world</p>",
		RouteKind:          "EXACT_MAILBOX",
		ReceivedAt:         time.Date(2026, 3, 29, 11, 59, 0, 0, time.UTC),
	}
}

func TestForwardingWorkerMarksCopyJobSent(t *testing.T) {
	store := &fakeForwardingStore{job: testForwardingJob()}
	sender := &fakeSender{}
	worker := newForwardingWorker(store, sender, func(string) (string, error) { return "re_secret", nil }, slog.New(slog.NewTextHandler(io.Discard, nil)), 10)

	if err := worker.runOnce(context.Background(), time.Date(2026, 3, 29, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if !store.sent || store.failed || store.skipped {
		t.Fatalf("sent=%v failed=%v skipped=%v", store.sent, store.failed, store.skipped)
	}
	if sender.request.IdempotencyKey != "mailbox-forward/1/10" || sender.request.Subject != "Fwd: Worker test" {
		t.Fatalf("send request = %#v", sender.request)
	}
}

func TestForwardingWorkerSkipsChangedConfiguration(t *testing.T) {
	job := testForwardingJob()
	job.MailboxForwardMode = "DISABLED"
	store := &fakeForwardingStore{job: job}
	worker := newForwardingWorker(store, &fakeSender{}, func(string) (string, error) { return "re_secret", nil }, slog.New(slog.NewTextHandler(io.Discard, nil)), 10)

	if err := worker.runOnce(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if !store.skipped || store.sent || store.failed {
		t.Fatalf("sent=%v failed=%v skipped=%v", store.sent, store.failed, store.skipped)
	}
}

func TestForwardingWorkerSchedulesRetryableFailure(t *testing.T) {
	store := &fakeForwardingStore{job: testForwardingJob()}
	worker := newForwardingWorker(store, &fakeSender{err: errors.New("temporary upstream 503")}, func(string) (string, error) { return "re_secret", nil }, slog.New(slog.NewTextHandler(io.Discard, nil)), 10)
	now := time.Date(2026, 3, 29, 12, 0, 0, 0, time.UTC)

	if err := worker.runOnce(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if !store.failed || store.retryAt == nil || !store.retryAt.Equal(now.Add(30*time.Second)) {
		t.Fatalf("failed=%v retryAt=%v", store.failed, store.retryAt)
	}
	if store.lastError != "temporary upstream 503" {
		t.Fatalf("lastError = %q", store.lastError)
	}
}

func TestForwardingWorkerRetriesTypedTransientProviderFailure(t *testing.T) {
	store := &fakeForwardingStore{job: testForwardingJob()}
	providerErr := &provider.HTTPError{StatusCode: http.StatusTooManyRequests, Code: "rate_limit_exceeded", Message: "slow down"}
	worker := newForwardingWorker(store, &fakeSender{err: providerErr}, func(string) (string, error) { return "re_secret", nil }, discardLogger(), 10)
	now := time.Date(2026, 3, 29, 12, 0, 0, 0, time.UTC)

	if err := worker.runOnce(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if !store.failed || store.retryAt == nil {
		t.Fatalf("failed=%v retryAt=%v", store.failed, store.retryAt)
	}
}

func TestForwardingWorkerDoesNotRetryTypedPermanentProviderFailure(t *testing.T) {
	store := &fakeForwardingStore{job: testForwardingJob()}
	providerErr := &provider.HTTPError{StatusCode: http.StatusBadRequest, Code: "validation_error", Message: "bad recipient"}
	worker := newForwardingWorker(store, &fakeSender{err: providerErr}, func(string) (string, error) { return "re_secret", nil }, discardLogger(), 10)

	if err := worker.runOnce(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if !store.failed || store.retryAt != nil {
		t.Fatalf("failed=%v retryAt=%v", store.failed, store.retryAt)
	}
}
