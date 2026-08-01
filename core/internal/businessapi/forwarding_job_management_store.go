package businessapi

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const forwardingLastErrorPreviewLimit = 160

type managedForwardingJobRow struct {
	ID                 int64
	InboundMessageID   int64
	MailboxIDValue     sql.NullInt64
	Mode               string
	ForwardTo          string
	Status             string
	AttemptCount       int
	LastError          sql.NullString
	ProviderMessageID  sql.NullString
	NextAttemptAt      sql.NullTime
	ProcessedAt        sql.NullTime
	CreatedAt          time.Time
	UpdatedAt          time.Time
	MailboxID          sql.NullInt64
	MailboxAddress     sql.NullString
	ProvisioningMode   sql.NullString
	MailboxForwardMode sql.NullString
	MailboxForwardTo   sql.NullString
	DomainID           int64
	DomainName         string
	DomainCanSend      bool
	DomainCanReceive   bool
	InboundFrom        string
	InboundSubject     sql.NullString
	MatchedAddress     string
	FinalAddress       string
	RouteKind          sql.NullString
	ReceivedAt         time.Time
	PortalState        string
	TextPreview        sql.NullString
	HTMLPreview        sql.NullString
}

type managedForwardingJobScanner interface {
	Scan(...any) error
}

func (s *PostgresStore) listManagedForwardingJobs(ctx context.Context, input managedForwardingJobListInput) (map[string]any, error) {
	var mailboxID, domainID any
	if input.MailboxID != nil {
		mailboxID = *input.MailboxID
	}
	if input.DomainID != nil {
		domainID = *input.DomainID
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM mailbox_forward_jobs AS job
		JOIN inbound_messages AS message ON message.id = job.inbound_message_id
		WHERE ($1 = '' OR job.status::text = $1)
		  AND ($2 = '' OR job.mode::text = $2)
		  AND ($3::bigint IS NULL OR job.mailbox_id = $3)
		  AND ($4::bigint IS NULL OR message.domain_id = $4)
		  AND ($5 = '' OR job.forward_to ILIKE '%' || $5 || '%'
		       OR message.from_address ILIKE '%' || $5 || '%'
		       OR COALESCE(message.subject, '') ILIKE '%' || $5 || '%'
		       OR message.matched_address ILIKE '%' || $5 || '%'
		       OR message.final_address ILIKE '%' || $5 || '%')
	`, input.Status, input.Mode, mailboxID, domainID, input.Keyword).Scan(&total); err != nil {
		return nil, fmt.Errorf("count forwarding jobs: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			job.id, job.inbound_message_id, job.mailbox_id, job.mode::text,
			job.forward_to, job.status::text, job.attempt_count, job.last_error,
			job.provider_message_id, job.next_attempt_at, job.processed_at,
			job.created_at, job.updated_at,
			mailbox.id, mailbox.address, mailbox.provisioning_mode::text,
			domain.id, domain.name, domain.can_send, domain.can_receive,
			message.from_address, message.subject, message.matched_address,
			message.final_address, message.route_kind, message.received_at,
			message.portal_state::text
		FROM mailbox_forward_jobs AS job
		JOIN inbound_messages AS message ON message.id = job.inbound_message_id
		JOIN domains AS domain ON domain.id = message.domain_id
		LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
		WHERE ($1 = '' OR job.status::text = $1)
		  AND ($2 = '' OR job.mode::text = $2)
		  AND ($3::bigint IS NULL OR job.mailbox_id = $3)
		  AND ($4::bigint IS NULL OR message.domain_id = $4)
		  AND ($5 = '' OR job.forward_to ILIKE '%' || $5 || '%'
		       OR message.from_address ILIKE '%' || $5 || '%'
		       OR COALESCE(message.subject, '') ILIKE '%' || $5 || '%'
		       OR message.matched_address ILIKE '%' || $5 || '%'
		       OR message.final_address ILIKE '%' || $5 || '%')
		ORDER BY job.created_at DESC, job.id DESC
		LIMIT $6 OFFSET $7
	`, input.Status, input.Mode, mailboxID, domainID, input.Keyword, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return nil, fmt.Errorf("list forwarding jobs: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, input.PageSize)
	for rows.Next() {
		row, err := scanManagedForwardingJobList(rows)
		if err != nil {
			return nil, fmt.Errorf("scan forwarding job: %w", err)
		}
		list = append(list, row.listResponse())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate forwarding jobs: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": input.Page, "pageSize": input.PageSize}, nil
}

func (s *PostgresStore) getManagedForwardingJob(ctx context.Context, id int64) (map[string]any, error) {
	row, err := scanManagedForwardingJobDetail(s.pool.QueryRow(ctx, `
		SELECT
			job.id, job.inbound_message_id, job.mailbox_id, job.mode::text,
			job.forward_to, job.status::text, job.attempt_count, job.last_error,
			job.provider_message_id, job.next_attempt_at, job.processed_at,
			job.created_at, job.updated_at,
			mailbox.id, mailbox.address, mailbox.provisioning_mode::text,
			mailbox.forward_mode::text, mailbox.forward_to,
			domain.id, domain.name, domain.can_send, domain.can_receive,
			message.from_address, message.subject, message.matched_address,
			message.final_address, message.route_kind, message.received_at,
			message.portal_state::text, message.text_preview, message.html_preview
		FROM mailbox_forward_jobs AS job
		JOIN inbound_messages AS message ON message.id = job.inbound_message_id
		JOIN domains AS domain ON domain.id = message.domain_id
		LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
		WHERE job.id = $1
	`, id))
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("FORWARDING_JOB_NOT_FOUND")
		}
		return nil, fmt.Errorf("get forwarding job: %w", err)
	}
	return row.detailResponse(), nil
}

func (s *PostgresStore) requeueManagedForwardingJob(ctx context.Context, id int64) (map[string]any, error) {
	var status string
	if err := s.pool.QueryRow(ctx, `SELECT status::text FROM mailbox_forward_jobs WHERE id = $1`, id).Scan(&status); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("FORWARDING_JOB_NOT_FOUND")
		}
		return nil, fmt.Errorf("load forwarding job for requeue: %w", err)
	}
	if status != "FAILED" && status != "SKIPPED" {
		return nil, managementBadRequest("FORWARDING_JOB_REQUEUE_NOT_ALLOWED", fmt.Errorf("status is %s", status))
	}
	var updatedID int64
	var nextStatus string
	var attemptCount int
	var lastError, providerMessageID sql.NullString
	var nextAttemptAt time.Time
	var processedAt sql.NullTime
	var updatedAt time.Time
	err := s.pool.QueryRow(ctx, `
		UPDATE mailbox_forward_jobs
		SET status = 'PENDING',
		    attempt_count = 0,
		    last_error = NULL,
		    provider_message_id = NULL,
		    next_attempt_at = CURRENT_TIMESTAMP,
		    processed_at = NULL,
		    claim_token = NULL,
		    lease_expires_at = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status IN ('FAILED', 'SKIPPED')
		RETURNING id, status::text, attempt_count, last_error,
		          provider_message_id, next_attempt_at, processed_at, updated_at
	`, id).Scan(&updatedID, &nextStatus, &attemptCount, &lastError, &providerMessageID, &nextAttemptAt, &processedAt, &updatedAt)
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementBadRequest("FORWARDING_JOB_REQUEUE_NOT_ALLOWED", fmt.Errorf("job status changed"))
		}
		return nil, fmt.Errorf("requeue forwarding job: %w", err)
	}
	return map[string]any{
		"id": fmt.Sprint(updatedID), "status": nextStatus, "attemptCount": attemptCount,
		"lastError": nullablePortalString(lastError), "providerMessageId": nullablePortalString(providerMessageID),
		"nextAttemptAt": formatAPITime(nextAttemptAt), "processedAt": nullableTimeValue(processedAt),
		"updatedAt": formatAPITime(updatedAt),
	}, nil
}

func scanManagedForwardingJobList(scanner managedForwardingJobScanner) (managedForwardingJobRow, error) {
	var row managedForwardingJobRow
	err := scanner.Scan(
		&row.ID, &row.InboundMessageID, &row.MailboxIDValue, &row.Mode,
		&row.ForwardTo, &row.Status, &row.AttemptCount, &row.LastError,
		&row.ProviderMessageID, &row.NextAttemptAt, &row.ProcessedAt,
		&row.CreatedAt, &row.UpdatedAt,
		&row.MailboxID, &row.MailboxAddress, &row.ProvisioningMode,
		&row.DomainID, &row.DomainName, &row.DomainCanSend, &row.DomainCanReceive,
		&row.InboundFrom, &row.InboundSubject, &row.MatchedAddress,
		&row.FinalAddress, &row.RouteKind, &row.ReceivedAt, &row.PortalState,
	)
	return row, err
}

func scanManagedForwardingJobDetail(scanner managedForwardingJobScanner) (managedForwardingJobRow, error) {
	var row managedForwardingJobRow
	err := scanner.Scan(
		&row.ID, &row.InboundMessageID, &row.MailboxIDValue, &row.Mode,
		&row.ForwardTo, &row.Status, &row.AttemptCount, &row.LastError,
		&row.ProviderMessageID, &row.NextAttemptAt, &row.ProcessedAt,
		&row.CreatedAt, &row.UpdatedAt,
		&row.MailboxID, &row.MailboxAddress, &row.ProvisioningMode,
		&row.MailboxForwardMode, &row.MailboxForwardTo,
		&row.DomainID, &row.DomainName, &row.DomainCanSend, &row.DomainCanReceive,
		&row.InboundFrom, &row.InboundSubject, &row.MatchedAddress,
		&row.FinalAddress, &row.RouteKind, &row.ReceivedAt, &row.PortalState,
		&row.TextPreview, &row.HTMLPreview,
	)
	return row, err
}

func (row managedForwardingJobRow) listResponse() map[string]any {
	lastError := nullablePortalString(row.LastError)
	if row.LastError.Valid && len(row.LastError.String) > forwardingLastErrorPreviewLimit {
		preview := []rune(row.LastError.String)
		if len(preview) > forwardingLastErrorPreviewLimit {
			preview = append(preview[:forwardingLastErrorPreviewLimit-1], '…')
		}
		lastError = string(preview)
	}
	result := map[string]any{
		"id": fmt.Sprint(row.ID), "inboundMessageId": fmt.Sprint(row.InboundMessageID),
		"mailboxId": nullableInt64Value(row.MailboxIDValue), "domainId": row.DomainID,
		"mode": row.Mode, "forwardTo": row.ForwardTo, "status": row.Status,
		"attemptCount": row.AttemptCount, "providerMessageId": nullablePortalString(row.ProviderMessageID),
		"nextAttemptAt": nullableTimeValue(row.NextAttemptAt), "processedAt": nullableTimeValue(row.ProcessedAt),
		"createdAt": formatAPITime(row.CreatedAt), "updatedAt": formatAPITime(row.UpdatedAt),
		"lastError": lastError,
		"mailbox":   nil,
		"domain":    map[string]any{"id": row.DomainID, "name": row.DomainName, "canSend": row.DomainCanSend, "canReceive": row.DomainCanReceive},
		"inboundMessage": map[string]any{
			"id": fmt.Sprint(row.InboundMessageID), "fromAddress": row.InboundFrom,
			"subject": nullablePortalString(row.InboundSubject), "matchedAddress": row.MatchedAddress,
			"finalAddress": row.FinalAddress, "routeKind": nullablePortalString(row.RouteKind),
			"receivedAt": formatAPITime(row.ReceivedAt), "portalState": row.PortalState,
		},
	}
	if row.MailboxID.Valid && row.MailboxAddress.Valid && row.ProvisioningMode.Valid {
		result["mailbox"] = map[string]any{
			"id": row.MailboxID.Int64, "address": row.MailboxAddress.String,
			"provisioningMode": row.ProvisioningMode.String,
		}
	}
	return result
}

func (row managedForwardingJobRow) detailResponse() map[string]any {
	result := row.listResponse()
	result["lastError"] = nullablePortalString(row.LastError)
	if row.MailboxID.Valid && row.MailboxAddress.Valid && row.ProvisioningMode.Valid {
		result["mailbox"] = map[string]any{
			"id": row.MailboxID.Int64, "address": row.MailboxAddress.String,
			"provisioningMode": row.ProvisioningMode.String,
			"forwardMode":      nullablePortalString(row.MailboxForwardMode),
			"forwardTo":        nullablePortalString(row.MailboxForwardTo),
		}
	}
	inbound := result["inboundMessage"].(map[string]any)
	inbound["hasTextPreview"] = row.TextPreview.Valid && strings.TrimSpace(row.TextPreview.String) != ""
	inbound["hasHtmlPreview"] = row.HTMLPreview.Valid && strings.TrimSpace(row.HTMLPreview.String) != ""
	return result
}
