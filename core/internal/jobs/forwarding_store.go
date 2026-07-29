package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	forwardingLockKey int64 = 0x414c4c4d465744
)

type forwardingOwnerLock struct {
	connection *pgx.Conn
}

func acquireForwardingOwner(ctx context.Context, databaseURL string) (*forwardingOwnerLock, error) {
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect forwarding owner: %w", err)
	}
	var acquired bool
	if err := connection.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", forwardingLockKey).Scan(&acquired); err != nil {
		connection.Close(context.Background())
		return nil, fmt.Errorf("acquire forwarding owner lock: %w", err)
	}
	if !acquired {
		connection.Close(context.Background())
		return nil, fmt.Errorf("forwarding owner lock is held by another runtime")
	}
	return &forwardingOwnerLock{connection: connection}, nil
}

func (l *forwardingOwnerLock) Ping(ctx context.Context) error {
	return l.connection.Ping(ctx)
}

func (l *forwardingOwnerLock) Close(ctx context.Context) {
	_, _ = l.connection.Exec(ctx, "SELECT pg_advisory_unlock($1)", forwardingLockKey)
	_ = l.connection.Close(ctx)
}

type postgresForwardingStore struct {
	pool          *pgxpool.Pool
	leaseDuration time.Duration
}

func newPostgresForwardingStore(ctx context.Context, databaseURL string, leaseDuration time.Duration) (*postgresForwardingStore, error) {
	if leaseDuration <= 0 {
		return nil, fmt.Errorf("forwarding lease duration must be positive")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create forwarding pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping forwarding database: %w", err)
	}
	return &postgresForwardingStore{pool: pool, leaseDuration: leaseDuration}, nil
}

func (s *postgresForwardingStore) Close() {
	s.pool.Close()
}

func (s *postgresForwardingStore) Claim(ctx context.Context, limit int, now time.Time) ([]claimedForwardJob, error) {
	token, err := newClaimToken()
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		WITH claimable AS (
			SELECT id,
				CASE
					WHEN status = 'RUNNING'::"ForwardJobStatus" THEN 'FAILED'
					ELSE status::text
				END AS previous_status
			FROM mailbox_forward_jobs
			WHERE (
				status IN ('PENDING'::"ForwardJobStatus", 'FAILED'::"ForwardJobStatus")
				AND next_attempt_at IS NOT NULL
				AND next_attempt_at <= $1
			) OR (
				status = 'RUNNING'::"ForwardJobStatus"
				AND COALESCE(lease_expires_at, updated_at + make_interval(secs => $5::int)) <= $1
			)
			ORDER BY next_attempt_at ASC, created_at ASC, id ASC
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		UPDATE mailbox_forward_jobs AS job
		SET status = 'RUNNING'::"ForwardJobStatus",
			claim_token = $3,
			lease_expires_at = $4,
			updated_at = $1
		FROM claimable
		WHERE job.id = claimable.id
		RETURNING job.id, job.claim_token, claimable.previous_status`, now, limit, token, now.Add(s.leaseDuration), int(s.leaseDuration/time.Second))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	claimed := []claimedForwardJob{}
	for rows.Next() {
		var job claimedForwardJob
		if err := rows.Scan(&job.ID, &job.ClaimToken, &job.PreviousStatus); err != nil {
			return nil, err
		}
		claimed = append(claimed, job)
	}
	return claimed, rows.Err()
}

func (s *postgresForwardingStore) Release(ctx context.Context, claims []claimedForwardJob, releasedAt time.Time) error {
	if len(claims) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin forwarding claim release: %w", err)
	}
	defer tx.Rollback(context.Background())

	for _, claim := range claims {
		status := claim.PreviousStatus
		if status != "PENDING" && status != "FAILED" {
			status = "FAILED"
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mailbox_forward_jobs
			SET status = $3::"ForwardJobStatus",
				claim_token = NULL,
				lease_expires_at = NULL,
				updated_at = $4
			WHERE id = $1
			  AND status = 'RUNNING'::"ForwardJobStatus"
			  AND claim_token = $2`, claim.ID, claim.ClaimToken, status, releasedAt); err != nil {
			return fmt.Errorf("release forwarding claim %d: %w", claim.ID, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit forwarding claim release: %w", err)
	}
	return nil
}

func (s *postgresForwardingStore) Load(ctx context.Context, id int64, token string) (forwardingJob, error) {
	var job forwardingJob
	err := s.pool.QueryRow(ctx, `
		SELECT job.id, job.claim_token, job.inbound_message_id, job.mode::text,
			job.forward_to, job.attempt_count,
			COALESCE(mailbox.status::text, ''), COALESCE(mailbox.forward_mode::text, ''), COALESCE(mailbox.forward_to, ''),
			COALESCE(domain.status::text, ''), COALESCE(domain.can_send, false),
			COALESCE(config.api_key_encrypted, ''), COALESCE(config.from_name_default, ''), COALESCE(config.reply_to_default, ''),
			message.matched_address, message.final_address, message.from_address, COALESCE(message.subject, ''),
			COALESCE(message.text_preview, ''), COALESCE(message.html_preview, ''), COALESCE(message.route_kind, ''), message.received_at
		FROM mailbox_forward_jobs AS job
		JOIN inbound_messages AS message ON message.id = job.inbound_message_id
		LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
		LEFT JOIN domains AS domain ON domain.id = mailbox.domain_id
		LEFT JOIN LATERAL (
			SELECT api_key_encrypted, from_name_default, reply_to_default
			FROM domain_sending_configs
			WHERE domain_id = domain.id AND provider = 'RESEND'::"SendProvider" AND status = 'ACTIVE'::"Status"
			ORDER BY id ASC
			LIMIT 1
		) AS config ON true
		WHERE job.id = $1 AND job.status = 'RUNNING'::"ForwardJobStatus" AND job.claim_token = $2`, id, token).Scan(
		&job.ID, &job.ClaimToken, &job.InboundMessageID, &job.Mode,
		&job.ForwardTo, &job.AttemptCount,
		&job.MailboxStatus, &job.MailboxForwardMode, &job.MailboxForwardTo,
		&job.DomainStatus, &job.DomainCanSend,
		&job.APIKeyEncrypted, &job.FromNameDefault, &job.ReplyToDefault,
		&job.MatchedAddress, &job.FinalAddress, &job.FromAddress, &job.Subject,
		&job.TextPreview, &job.HTMLPreview, &job.RouteKind, &job.ReceivedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return forwardingJob{}, errClaimLost
	}
	return job, err
}

func (s *postgresForwardingStore) MarkSkipped(ctx context.Context, job forwardingJob, reason string, processedAt time.Time) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE mailbox_forward_jobs
		SET status = 'SKIPPED'::"ForwardJobStatus", last_error = $3, next_attempt_at = NULL,
			processed_at = $4, claim_token = NULL, lease_expires_at = NULL, updated_at = $4
		WHERE id = $1 AND status = 'RUNNING'::"ForwardJobStatus" AND claim_token = $2`, job.ID, job.ClaimToken, reason, processedAt)
	return requireClaim(command.RowsAffected(), err)
}

func (s *postgresForwardingStore) MarkFailed(ctx context.Context, job forwardingJob, message string, retryAt *time.Time, processedAt time.Time) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE mailbox_forward_jobs
		SET status = 'FAILED'::"ForwardJobStatus", attempt_count = attempt_count + 1,
			last_error = $3, next_attempt_at = $4, processed_at = $5,
			claim_token = NULL, lease_expires_at = NULL, updated_at = $5
		WHERE id = $1 AND status = 'RUNNING'::"ForwardJobStatus" AND claim_token = $2`, job.ID, job.ClaimToken, message, retryAt, processedAt)
	return requireClaim(command.RowsAffected(), err)
}

func (s *postgresForwardingStore) MarkSent(ctx context.Context, job forwardingJob, providerMessageID string, processedAt time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	command, err := tx.Exec(ctx, `
		UPDATE mailbox_forward_jobs
		SET status = 'SENT'::"ForwardJobStatus", attempt_count = attempt_count + 1,
			last_error = NULL, provider_message_id = $3, next_attempt_at = NULL,
			processed_at = $4, claim_token = NULL, lease_expires_at = NULL, updated_at = $4
		WHERE id = $1 AND status = 'RUNNING'::"ForwardJobStatus" AND claim_token = $2`, job.ID, job.ClaimToken, providerMessageID, processedAt)
	if err := requireClaim(command.RowsAffected(), err); err != nil {
		return err
	}
	if job.Mode == "MOVE" {
		if _, err := tx.Exec(ctx, `UPDATE inbound_messages SET portal_state = 'FORWARDED_HIDDEN'::"PortalState", updated_at = $2 WHERE id = $1`, job.InboundMessageID, processedAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func requireClaim(rows int64, err error) error {
	if err != nil {
		return err
	}
	if rows != 1 {
		return errClaimLost
	}
	return nil
}

func newClaimToken() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate forwarding claim token: %w", err)
	}
	return hex.EncodeToString(buffer), nil
}
