package businessapi

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type MailboxPortalSentMessageListInput struct {
	MailboxUserID int64
	MailboxID     int64
	Page          int
	PageSize      int
}

type MailboxPortalForwardingJobListInput struct {
	MailboxUserID int64
	MailboxID     *int64
	Page          int
	PageSize      int
}

type MailboxPortalForwardingUpdateInput struct {
	MailboxUserID int64
	MailboxID     int64
	ForwardMode   string
	ForwardTo     *string
}

type MailboxPortalSendMailbox struct {
	ID               int64
	DomainID         int64
	Address          string
	DomainCanSend    bool
	DomainCanReceive bool
}

func (s *PostgresStore) ListMailboxPortalSentMessages(ctx context.Context, input MailboxPortalSentMessageListInput) (map[string]any, error) {
	if err := s.ensureMailboxPortalAccess(ctx, input.MailboxUserID, input.MailboxID); err != nil {
		return nil, err
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM outbound_messages
		WHERE mailbox_id = $1
	`, input.MailboxID).Scan(&total); err != nil {
		return nil, fmt.Errorf("count mailbox portal sent messages: %w", err)
	}
	rows, err := s.pool.Query(ctx, outboundMessageSelect+`
		WHERE message.mailbox_id = $1
		ORDER BY message.created_at DESC, message.id DESC
		LIMIT $2 OFFSET $3
	`, input.MailboxID, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return nil, fmt.Errorf("list mailbox portal sent messages: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, input.PageSize)
	for rows.Next() {
		row, err := scanOutboundMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("scan mailbox portal sent message: %w", err)
		}
		list = append(list, safeOutboundMessage(row, false))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mailbox portal sent messages: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": input.Page, "pageSize": input.PageSize}, nil
}

func (s *PostgresStore) GetMailboxPortalSentMessage(ctx context.Context, id, mailboxUserID int64) (map[string]any, error) {
	row, err := scanOutboundMessage(s.pool.QueryRow(ctx, outboundMessageSelect+`
		WHERE message.id = $1
		  AND message.mailbox_id IS NOT NULL
		  AND EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $2
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1 FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		  )
	`, id, mailboxUserID))
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, errNotFound
		}
		return nil, fmt.Errorf("get mailbox portal sent message: %w", err)
	}
	return safeOutboundMessage(row, true), nil
}

func (s *PostgresStore) ListMailboxPortalForwardingJobs(ctx context.Context, input MailboxPortalForwardingJobListInput) (map[string]any, error) {
	var mailboxFilter any
	if input.MailboxID != nil {
		if err := s.ensureMailboxPortalAccess(ctx, input.MailboxUserID, *input.MailboxID); err != nil {
			return nil, err
		}
		mailboxFilter = *input.MailboxID
	}
	access := `
		EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $1
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1 FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		)
	`
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM mailbox_forward_jobs AS job
		JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
		WHERE `+access+`
		  AND ($2::bigint IS NULL OR job.mailbox_id = $2)
	`, input.MailboxUserID, mailboxFilter).Scan(&total); err != nil {
		return nil, fmt.Errorf("count mailbox portal forwarding jobs: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT job.id, job.status::text, job.mode::text, job.forward_to,
		       job.attempt_count, job.last_error, job.processed_at,
		       job.created_at, job.next_attempt_at,
		       message.id, message.subject, message.from_address, message.final_address
		FROM mailbox_forward_jobs AS job
		JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
		JOIN inbound_messages AS message ON message.id = job.inbound_message_id
		WHERE `+access+`
		  AND ($2::bigint IS NULL OR job.mailbox_id = $2)
		ORDER BY job.created_at DESC, job.id DESC
		LIMIT $3 OFFSET $4
	`, input.MailboxUserID, mailboxFilter, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return nil, fmt.Errorf("list mailbox portal forwarding jobs: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, input.PageSize)
	for rows.Next() {
		var id, inboundID int64
		var status, mode, forwardTo, fromAddress, finalAddress string
		var subject, lastError sql.NullString
		var attemptCount int
		var processedAt, nextAttemptAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(
			&id, &status, &mode, &forwardTo, &attemptCount, &lastError,
			&processedAt, &createdAt, &nextAttemptAt,
			&inboundID, &subject, &fromAddress, &finalAddress,
		); err != nil {
			return nil, fmt.Errorf("scan mailbox portal forwarding job: %w", err)
		}
		list = append(list, map[string]any{
			"id": fmt.Sprint(id), "status": status, "mode": mode,
			"forwardTo": forwardTo, "attemptCount": attemptCount,
			"lastError":   nullablePortalString(lastError),
			"processedAt": nullableTimeValue(processedAt), "createdAt": formatAPITime(createdAt),
			"nextAttemptAt": nullableTimeValue(nextAttemptAt),
			"inboundMessage": map[string]any{
				"id": fmt.Sprint(inboundID), "subject": nullablePortalString(subject),
				"fromAddress": fromAddress, "finalAddress": finalAddress,
			},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mailbox portal forwarding jobs: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": input.Page, "pageSize": input.PageSize}, nil
}

func (s *PostgresStore) UpdateMailboxPortalForwarding(ctx context.Context, input MailboxPortalForwardingUpdateInput) (map[string]any, error) {
	var forwardTo any
	if input.ForwardMode != "DISABLED" && input.ForwardTo != nil {
		forwardTo = *input.ForwardTo
	}
	var id, domainID int64
	var address, provisioningMode, forwardMode, domainName string
	var storedForwardTo sql.NullString
	var updatedAt time.Time
	var canSend, canReceive, sendReady bool
	err := s.pool.QueryRow(ctx, `
		WITH updated AS (
			UPDATE domain_mailboxes AS mailbox
			SET forward_mode = $3::"ForwardMode",
			    forward_to = $4,
			    updated_at = CURRENT_TIMESTAMP
			WHERE mailbox.id = $2
			  AND mailbox.status = 'ACTIVE'
			  AND EXISTS (
				SELECT 1 FROM mailbox_users AS portal_user
				WHERE portal_user.id = $1
				  AND portal_user.status = 'ACTIVE'
				  AND (
					mailbox.owner_user_id = portal_user.id
					OR EXISTS (
						SELECT 1 FROM mailbox_memberships AS membership
						WHERE membership.mailbox_id = mailbox.id
						  AND membership.user_id = portal_user.id
					)
				  )
			  )
			RETURNING mailbox.*
		)
		SELECT updated.id, updated.domain_id, updated.address,
		       updated.provisioning_mode::text, updated.forward_mode::text,
		       updated.forward_to, updated.updated_at,
		       domain.name, domain.can_send, domain.can_receive,
		       EXISTS (
				SELECT 1 FROM domain_sending_configs AS sending
				WHERE sending.domain_id = domain.id
				  AND sending.provider = 'RESEND' AND sending.status = 'ACTIVE'
		       )
		FROM updated
		JOIN domains AS domain ON domain.id = updated.domain_id
	`, input.MailboxUserID, input.MailboxID, input.ForwardMode, forwardTo).Scan(
		&id, &domainID, &address, &provisioningMode, &forwardMode,
		&storedForwardTo, &updatedAt, &domainName, &canSend, &canReceive, &sendReady,
	)
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, errNotFound
		}
		return nil, fmt.Errorf("update mailbox portal forwarding: %w", err)
	}
	result := map[string]any{
		"id": id, "address": address, "provisioningMode": provisioningMode,
		"forwardMode": forwardMode, "forwardTo": nullablePortalString(storedForwardTo),
		"updatedAt": formatAPITime(updatedAt),
		"domain":    map[string]any{"id": domainID, "name": domainName, "canSend": canSend, "canReceive": canReceive},
		"sendReady": canSend && sendReady,
	}
	for key, value := range hostedInternalProtocolSummary(provisioningMode, canSend, canReceive) {
		result[key] = value
	}
	return result, nil
}

func (s *PostgresStore) GetMailboxPortalSendMailbox(ctx context.Context, mailboxUserID, mailboxID int64) (MailboxPortalSendMailbox, error) {
	var result MailboxPortalSendMailbox
	err := s.pool.QueryRow(ctx, `
		SELECT mailbox.id, mailbox.domain_id, mailbox.address,
		       domain.can_send, domain.can_receive
		FROM domain_mailboxes AS mailbox
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE mailbox.id = $2
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND EXISTS (
			SELECT 1 FROM mailbox_users AS portal_user
			WHERE portal_user.id = $1
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1 FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		  )
	`, mailboxUserID, mailboxID).Scan(
		&result.ID, &result.DomainID, &result.Address,
		&result.DomainCanSend, &result.DomainCanReceive,
	)
	if err != nil {
		if errorsIsNoRows(err) {
			return MailboxPortalSendMailbox{}, errNotFound
		}
		return MailboxPortalSendMailbox{}, fmt.Errorf("load mailbox portal send mailbox: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) ensureMailboxPortalAccess(ctx context.Context, mailboxUserID, mailboxID int64) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM domain_mailboxes AS mailbox
			JOIN mailbox_users AS portal_user ON portal_user.id = $1
			WHERE mailbox.id = $2
			  AND mailbox.status = 'ACTIVE'
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1 FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		)
	`, mailboxUserID, mailboxID).Scan(&exists); err != nil {
		return fmt.Errorf("verify mailbox portal access: %w", err)
	}
	if !exists {
		return errNotFound
	}
	return nil
}
