package jobs

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/provider"
)

const (
	forwardingMaxAttempts    = 3
	forwardingInitialBackoff = 30 * time.Second
	forwardingMaxBackoff     = 5 * time.Minute
)

var (
	stylePattern  = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	scriptPattern = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	tagPattern    = regexp.MustCompile(`(?s)<[^>]+>`)
	spacePattern  = regexp.MustCompile(`\s+`)
)

var errClaimLost = errors.New("forwarding claim lost")

type claimedForwardJob struct {
	ID             int64
	ClaimToken     string
	PreviousStatus string
}

type forwardingJob struct {
	ID                 int64
	ClaimToken         string
	InboundMessageID   int64
	Mode               string
	ForwardTo          string
	AttemptCount       int
	MailboxStatus      string
	MailboxForwardMode string
	MailboxForwardTo   string
	DomainStatus       string
	DomainCanSend      bool
	APIKeyEncrypted    string
	FromNameDefault    string
	ReplyToDefault     string
	MatchedAddress     string
	FinalAddress       string
	FromAddress        string
	Subject            string
	TextPreview        string
	HTMLPreview        string
	RouteKind          string
	ReceivedAt         time.Time
}

type forwardingStore interface {
	Claim(context.Context, int, time.Time) ([]claimedForwardJob, error)
	Release(context.Context, []claimedForwardJob, time.Time) error
	Load(context.Context, int64, string) (forwardingJob, error)
	MarkSkipped(context.Context, forwardingJob, string, time.Time) error
	MarkFailed(context.Context, forwardingJob, string, *time.Time, time.Time) error
	MarkSent(context.Context, forwardingJob, string, time.Time) error
}

type forwardingSender interface {
	Send(context.Context, string, provider.SendRequest) (provider.SendResult, error)
}

type decryptForwardingKey func(string) (string, error)

type forwardingWorker struct {
	store     forwardingStore
	sender    forwardingSender
	decrypt   decryptForwardingKey
	logger    *slog.Logger
	batchSize int
}

func newForwardingWorker(store forwardingStore, sender forwardingSender, decrypt decryptForwardingKey, logger *slog.Logger, batchSize int) *forwardingWorker {
	return &forwardingWorker{store: store, sender: sender, decrypt: decrypt, logger: logger, batchSize: batchSize}
}

func (w *forwardingWorker) runOnce(ctx context.Context, now time.Time) (runErr error) {
	claimed, err := w.store.Claim(ctx, w.batchSize, now)
	if err != nil {
		return fmt.Errorf("claim forwarding jobs: %w", err)
	}
	remaining := append([]claimedForwardJob(nil), claimed...)
	defer func() {
		if len(remaining) == 0 {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := w.store.Release(cleanupCtx, remaining, time.Now().UTC()); err != nil {
			releaseErr := fmt.Errorf("release %d unprocessed forwarding claims: %w", len(remaining), err)
			w.logger.Error("failed to release unprocessed forwarding claims", "count", len(remaining), "error", err)
			if runErr != nil {
				runErr = errors.Join(runErr, releaseErr)
			} else {
				runErr = releaseErr
			}
		}
	}()

	for len(remaining) > 0 {
		claim := remaining[0]
		job, err := w.store.Load(ctx, claim.ID, claim.ClaimToken)
		if errors.Is(err, errClaimLost) {
			remaining = remaining[1:]
			continue
		}
		if err != nil {
			return fmt.Errorf("load forwarding job %d: %w", claim.ID, err)
		}
		if err := w.process(ctx, job, now); err != nil {
			if errors.Is(err, errClaimLost) {
				w.logger.Warn("forwarding claim lost before terminal update", "job_id", job.ID)
				remaining = remaining[1:]
				continue
			}
			return err
		}
		remaining = remaining[1:]
	}
	return nil
}

func (w *forwardingWorker) process(ctx context.Context, job forwardingJob, now time.Time) error {
	if job.MailboxStatus != "ACTIVE" {
		return w.fail(ctx, job, "Mailbox is no longer active for forwarding", false, now)
	}
	currentTarget := normalizeEmail(job.MailboxForwardTo)
	if job.MailboxForwardMode == "DISABLED" || currentTarget == "" || currentTarget != normalizeEmail(job.ForwardTo) {
		return w.store.MarkSkipped(ctx, job, "Forwarding configuration changed after job creation", now)
	}
	if job.DomainStatus != "ACTIVE" {
		return w.fail(ctx, job, "Domain is not active for forwarding", false, now)
	}
	if !job.DomainCanSend {
		return w.fail(ctx, job, "Domain cannot send forwarded mail", false, now)
	}
	if job.APIKeyEncrypted == "" {
		return w.fail(ctx, job, "No active sending configuration is available for this domain", false, now)
	}
	forwardTo, err := validateEmail(job.ForwardTo)
	if err != nil {
		return w.fail(ctx, job, "Forward target email is invalid", false, now)
	}
	apiKey, err := w.decrypt(job.APIKeyEncrypted)
	if err != nil {
		return w.fail(ctx, job, err.Error(), true, now)
	}
	subject, text, htmlBody := buildForwardingBodies(job)
	replyTo := job.ReplyToDefault
	if originalSender, senderErr := validateEmail(job.FromAddress); senderErr == nil {
		replyTo = originalSender
	}
	from := job.FinalAddress
	if job.FromNameDefault != "" {
		from = fmt.Sprintf("%s <%s>", job.FromNameDefault, job.FinalAddress)
	}
	result, err := w.sender.Send(ctx, apiKey, provider.SendRequest{
		From:           from,
		To:             []string{forwardTo},
		Subject:        subject,
		HTML:           htmlBody,
		Text:           text,
		ReplyTo:        replyTo,
		IdempotencyKey: fmt.Sprintf("mailbox-forward/%d/%d", job.ID, job.InboundMessageID),
	})
	if err != nil {
		return w.fail(ctx, job, err.Error(), isRetryableForwardingError(err), now)
	}
	return w.store.MarkSent(ctx, job, result.ID, now)
}

func (w *forwardingWorker) fail(ctx context.Context, job forwardingJob, message string, retryable bool, now time.Time) error {
	nextAttemptCount := job.AttemptCount + 1
	var retryAt *time.Time
	if retryable && nextAttemptCount < forwardingMaxAttempts {
		delay := forwardingInitialBackoff << (nextAttemptCount - 1)
		if delay > forwardingMaxBackoff {
			delay = forwardingMaxBackoff
		}
		next := now.Add(delay)
		retryAt = &next
	}
	return w.store.MarkFailed(ctx, job, message, retryAt, now)
}

func buildForwardingBodies(job forwardingJob) (string, string, string) {
	subject := strings.TrimSpace(job.Subject)
	if subject == "" {
		subject = "(no subject)"
	}
	if !strings.HasPrefix(strings.ToLower(subject), "fwd:") {
		subject = "Fwd: " + subject
	}
	metadata := []string{
		"Original sender: " + job.FromAddress,
		"Matched mailbox: " + job.MatchedAddress,
		"Final mailbox: " + job.FinalAddress,
		"Received at: " + job.ReceivedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if job.RouteKind != "" {
		metadata = append(metadata, "Route kind: "+job.RouteKind)
	}
	textPreview := strings.TrimSpace(job.TextPreview)
	htmlPreview := strings.TrimSpace(job.HTMLPreview)
	content := textPreview
	if content == "" && htmlPreview != "" {
		content = stripHTML(htmlPreview)
	}
	if content == "" {
		content = "No preview content was captured for this inbound message."
	}
	text := strings.Join(append([]string{"Forwarded inbound message", ""}, append(metadata, "", content)...), "\n")
	htmlContent := htmlPreview
	if htmlContent == "" && textPreview != "" {
		htmlContent = "<pre>" + html.EscapeString(textPreview) + "</pre>"
	}
	if htmlContent == "" {
		htmlContent = "<p>No preview content was captured for this inbound message.</p>"
	}
	items := make([]string, 0, len(metadata))
	for _, line := range metadata {
		items = append(items, "<li>"+html.EscapeString(line)+"</li>")
	}
	htmlBody := "<div><p>Forwarded inbound message</p><ul>" + strings.Join(items, "") + "</ul>" + htmlContent + "</div>"
	return subject, text, htmlBody
}

func stripHTML(value string) string {
	value = stylePattern.ReplaceAllString(value, " ")
	value = scriptPattern.ReplaceAllString(value, " ")
	value = tagPattern.ReplaceAllString(value, " ")
	return strings.TrimSpace(spacePattern.ReplaceAllString(value, " "))
}

func validateEmail(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	parsed, err := mail.ParseAddress(normalized)
	if err != nil || !strings.EqualFold(parsed.Address, normalized) || !strings.Contains(parsed.Address, "@") {
		return "", fmt.Errorf("invalid email")
	}
	return normalized, nil
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func isRetryableForwardingError(err error) bool {
	if err == nil {
		return false
	}
	var classified interface{ Retryable() bool }
	if errors.As(err, &classified) {
		return classified.Retryable()
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return !strings.Contains(message, "invalid email") &&
		!strings.Contains(message, "invalid recipient") &&
		!strings.Contains(message, "invalid_idempotent_request")
}
