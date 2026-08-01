package businessapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const forwardingJobRelationsAndFilters = `
	FROM mailbox_forward_jobs AS job
	JOIN inbound_messages AS message ON message.id = job.inbound_message_id
	JOIN domains AS domain ON domain.id = message.domain_id
	LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
	WHERE ($1::text IS NULL OR job.status::text = $1::text)
	  AND ($2::text IS NULL OR job.mode::text = $2::text)
	  AND ($3::bigint IS NULL OR job.mailbox_id = $3::bigint)
	  AND ($4::bigint IS NULL OR message.domain_id = $4::bigint)
	  AND (
		$5::text IS NULL
		OR job.forward_to ILIKE '%' || $5::text || '%'
		OR message.from_address ILIKE '%' || $5::text || '%'
		OR message.subject ILIKE '%' || $5::text || '%'
		OR message.matched_address ILIKE '%' || $5::text || '%'
		OR message.final_address ILIKE '%' || $5::text || '%'
	  )`

const forwardingJobListProjection = `
	SELECT
		job.id,
		job.inbound_message_id,
		job.mailbox_id,
		message.domain_id,
		job.mode::text,
		job.forward_to,
		job.status::text,
		job.attempt_count,
		job.last_error,
		job.provider_message_id,
		job.next_attempt_at,
		job.processed_at,
		job.created_at,
		job.updated_at,
		mailbox.id,
		mailbox.address,
		mailbox.provisioning_mode::text,
		domain.id,
		domain.name,
		domain.can_send,
		domain.can_receive,
		message.id,
		message.from_address,
		message.subject,
		message.matched_address,
		message.final_address,
		message.route_kind,
		message.received_at,
		message.portal_state::text`

type forwardingJobDatabaseRow struct {
	ID                     int64
	InboundMessageID       int64
	MailboxID              sql.NullInt64
	DomainID               int64
	Mode                   string
	ForwardTo              string
	Status                 string
	AttemptCount           int
	LastError              sql.NullString
	ProviderMessageID      sql.NullString
	NextAttemptAt          sql.NullTime
	ProcessedAt            sql.NullTime
	CreatedAt              time.Time
	UpdatedAt              time.Time
	JoinedMailboxID        sql.NullInt64
	MailboxAddress         sql.NullString
	MailboxProvisioning    sql.NullString
	JoinedDomainID         int64
	DomainName             string
	DomainCanSend          bool
	DomainCanReceive       bool
	JoinedInboundMessageID int64
	FromAddress            string
	Subject                sql.NullString
	MatchedAddress         string
	FinalAddress           string
	RouteKind              sql.NullString
	ReceivedAt             time.Time
	PortalState            string
	MailboxForwardMode     sql.NullString
	MailboxForwardTo       sql.NullString
	TextPreview            sql.NullString
	HTMLPreview            sql.NullString
}

type forwardingJobRowScanner interface {
	Scan(...any) error
}

func (s *PostgresStore) ListForwardingJobs(ctx context.Context, input forwardingJobListInput) (forwardingJobListResult, error) {
	filterArguments := []any{
		nullableForwardingJobFilter(input.Status),
		nullableForwardingJobFilter(input.Mode),
		nullableForwardingJobID(input.MailboxID),
		nullableForwardingJobID(input.DomainID),
		nullableForwardingJobFilter(input.Keyword),
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*)::bigint`+forwardingJobRelationsAndFilters, filterArguments...).Scan(&total); err != nil {
		return forwardingJobListResult{}, fmt.Errorf("count forwarding jobs: %w", err)
	}

	offset := (input.Page - 1) * input.PageSize
	queryArguments := append(append([]any{}, filterArguments...), input.PageSize, offset)
	rows, err := s.pool.Query(ctx, forwardingJobListProjection+forwardingJobRelationsAndFilters+`
		ORDER BY job.created_at DESC, job.id DESC
		LIMIT $6 OFFSET $7`, queryArguments...)
	if err != nil {
		return forwardingJobListResult{}, fmt.Errorf("list forwarding jobs: %w", err)
	}
	defer rows.Close()

	list := make([]forwardingJobListItem, 0, input.PageSize)
	for rows.Next() {
		row, err := scanForwardingJobDatabaseRow(rows)
		if err != nil {
			return forwardingJobListResult{}, fmt.Errorf("scan forwarding job list item: %w", err)
		}
		list = append(list, row.listItem())
	}
	if err := rows.Err(); err != nil {
		return forwardingJobListResult{}, fmt.Errorf("iterate forwarding jobs: %w", err)
	}
	return forwardingJobListResult{List: list, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *PostgresStore) GetForwardingJob(ctx context.Context, id int64) (forwardingJobDetail, error) {
	row, err := scanForwardingJobDetailDatabaseRow(s.pool.QueryRow(ctx, forwardingJobListProjection+`,
		mailbox.forward_mode::text,
		mailbox.forward_to,
		message.text_preview,
		message.html_preview
	FROM mailbox_forward_jobs AS job
	JOIN inbound_messages AS message ON message.id = job.inbound_message_id
	JOIN domains AS domain ON domain.id = message.domain_id
	LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
	WHERE job.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return forwardingJobDetail{}, &requestError{Status: http.StatusNotFound, Code: "FORWARDING_JOB_NOT_FOUND"}
	}
	if err != nil {
		return forwardingJobDetail{}, fmt.Errorf("get forwarding job: %w", err)
	}
	return row.detail(), nil
}

func (s *PostgresStore) RequeueForwardingJob(ctx context.Context, id int64, requeuedAt time.Time) (forwardingJobRequeueResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return forwardingJobRequeueResult{}, fmt.Errorf("begin forwarding job requeue: %w", err)
	}
	defer tx.Rollback(context.Background())

	var status string
	err = tx.QueryRow(ctx, `
		SELECT status::text
		FROM mailbox_forward_jobs
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return forwardingJobRequeueResult{}, &requestError{Status: http.StatusNotFound, Code: "FORWARDING_JOB_NOT_FOUND"}
	}
	if err != nil {
		return forwardingJobRequeueResult{}, fmt.Errorf("lock forwarding job for requeue: %w", err)
	}
	if status != "FAILED" && status != "SKIPPED" {
		return forwardingJobRequeueResult{}, &requestError{Status: http.StatusBadRequest, Code: "FORWARDING_JOB_REQUEUE_NOT_ALLOWED"}
	}

	var result forwardingJobRequeueResult
	var resultID int64
	var lastError, providerMessageID sql.NullString
	var processedAt sql.NullTime
	var nextAttemptAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
		UPDATE mailbox_forward_jobs
		SET status = 'PENDING'::"ForwardJobStatus",
			attempt_count = 0,
			last_error = NULL,
			provider_message_id = NULL,
			next_attempt_at = $2,
			processed_at = NULL,
			claim_token = NULL,
			lease_expires_at = NULL,
			updated_at = $2
		WHERE id = $1
		  AND status IN ('FAILED'::"ForwardJobStatus", 'SKIPPED'::"ForwardJobStatus")
		RETURNING id, status::text, attempt_count, last_error, provider_message_id,
			next_attempt_at, processed_at, updated_at
	`, id, requeuedAt).Scan(
		&resultID,
		&result.Status,
		&result.AttemptCount,
		&lastError,
		&providerMessageID,
		&nextAttemptAt,
		&processedAt,
		&updatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return forwardingJobRequeueResult{}, &requestError{Status: http.StatusBadRequest, Code: "FORWARDING_JOB_REQUEUE_NOT_ALLOWED"}
	}
	if err != nil {
		return forwardingJobRequeueResult{}, fmt.Errorf("update forwarding job for requeue: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return forwardingJobRequeueResult{}, fmt.Errorf("commit forwarding job requeue: %w", err)
	}

	result.ID = strconv.FormatInt(resultID, 10)
	result.LastError = nullableStringValue(lastError)
	result.ProviderMessageID = nullableStringValue(providerMessageID)
	result.NextAttemptAt = formatAPITime(nextAttemptAt)
	result.ProcessedAt = nullableTimeValue(processedAt)
	result.UpdatedAt = formatAPITime(updatedAt)
	return result, nil
}

func scanForwardingJobDatabaseRow(scanner forwardingJobRowScanner) (forwardingJobDatabaseRow, error) {
	var row forwardingJobDatabaseRow
	err := scanner.Scan(row.commonScanDestinations()...)
	return row, err
}

func scanForwardingJobDetailDatabaseRow(scanner forwardingJobRowScanner) (forwardingJobDatabaseRow, error) {
	var row forwardingJobDatabaseRow
	destinations := append(row.commonScanDestinations(),
		&row.MailboxForwardMode,
		&row.MailboxForwardTo,
		&row.TextPreview,
		&row.HTMLPreview,
	)
	err := scanner.Scan(destinations...)
	return row, err
}

func (row *forwardingJobDatabaseRow) commonScanDestinations() []any {
	return []any{
		&row.ID,
		&row.InboundMessageID,
		&row.MailboxID,
		&row.DomainID,
		&row.Mode,
		&row.ForwardTo,
		&row.Status,
		&row.AttemptCount,
		&row.LastError,
		&row.ProviderMessageID,
		&row.NextAttemptAt,
		&row.ProcessedAt,
		&row.CreatedAt,
		&row.UpdatedAt,
		&row.JoinedMailboxID,
		&row.MailboxAddress,
		&row.MailboxProvisioning,
		&row.JoinedDomainID,
		&row.DomainName,
		&row.DomainCanSend,
		&row.DomainCanReceive,
		&row.JoinedInboundMessageID,
		&row.FromAddress,
		&row.Subject,
		&row.MatchedAddress,
		&row.FinalAddress,
		&row.RouteKind,
		&row.ReceivedAt,
		&row.PortalState,
	}
}

func (row forwardingJobDatabaseRow) common(lastError *string) forwardingJobCommon {
	return forwardingJobCommon{
		ID:                strconv.FormatInt(row.ID, 10),
		InboundMessageID:  strconv.FormatInt(row.InboundMessageID, 10),
		MailboxID:         nullableInt64Value(row.MailboxID),
		DomainID:          row.DomainID,
		Mode:              row.Mode,
		ForwardTo:         row.ForwardTo,
		Status:            row.Status,
		AttemptCount:      row.AttemptCount,
		LastError:         lastError,
		ProviderMessageID: nullableStringValue(row.ProviderMessageID),
		NextAttemptAt:     nullableTimeValue(row.NextAttemptAt),
		ProcessedAt:       nullableTimeValue(row.ProcessedAt),
		CreatedAt:         formatAPITime(row.CreatedAt),
		UpdatedAt:         formatAPITime(row.UpdatedAt),
	}
}

func (row forwardingJobDatabaseRow) domain() forwardingJobDomainSummary {
	return forwardingJobDomainSummary{
		ID: row.JoinedDomainID, Name: row.DomainName,
		CanSend: row.DomainCanSend, CanReceive: row.DomainCanReceive,
	}
}

func (row forwardingJobDatabaseRow) inbound() forwardingJobInboundSummary {
	return forwardingJobInboundSummary{
		ID:             strconv.FormatInt(row.JoinedInboundMessageID, 10),
		FromAddress:    row.FromAddress,
		Subject:        nullableStringValue(row.Subject),
		MatchedAddress: row.MatchedAddress,
		FinalAddress:   row.FinalAddress,
		RouteKind:      nullableStringValue(row.RouteKind),
		ReceivedAt:     formatAPITime(row.ReceivedAt),
		PortalState:    row.PortalState,
	}
}

func (row forwardingJobDatabaseRow) listItem() forwardingJobListItem {
	var mailbox *forwardingJobMailboxSummary
	if row.JoinedMailboxID.Valid {
		mailbox = &forwardingJobMailboxSummary{
			ID: row.JoinedMailboxID.Int64, Address: row.MailboxAddress.String,
			ProvisioningMode: row.MailboxProvisioning.String,
		}
	}
	return forwardingJobListItem{
		forwardingJobCommon: row.common(truncateForwardingJobLastError(nullableStringValue(row.LastError))),
		Mailbox:             mailbox,
		Domain:              row.domain(),
		InboundMessage:      row.inbound(),
	}
}

func (row forwardingJobDatabaseRow) detail() forwardingJobDetail {
	var mailbox *forwardingJobMailboxDetail
	if row.JoinedMailboxID.Valid {
		mailbox = &forwardingJobMailboxDetail{
			ID: row.JoinedMailboxID.Int64, Address: row.MailboxAddress.String,
			ProvisioningMode: row.MailboxProvisioning.String,
			ForwardMode:      row.MailboxForwardMode.String,
			ForwardTo:        nullableStringValue(row.MailboxForwardTo),
		}
	}
	return forwardingJobDetail{
		forwardingJobCommon: row.common(nullableStringValue(row.LastError)),
		Mailbox:             mailbox,
		Domain:              row.domain(),
		InboundMessage: forwardingJobInboundDetail{
			forwardingJobInboundSummary: row.inbound(),
			HasTextPreview:              strings.TrimSpace(row.TextPreview.String) != "",
			HasHTMLPreview:              strings.TrimSpace(row.HTMLPreview.String) != "",
		},
	}
}

func nullableForwardingJobFilter(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableForwardingJobID(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}
