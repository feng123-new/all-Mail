package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type MailboxPortalMessageListInput struct {
	Page          int
	PageSize      int
	MailboxID     *int64
	UnreadOnly    bool
	MailboxUserID int64
}

type MailboxPortalMessageList struct {
	List     []map[string]any `json:"list"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

type MailboxPortalStore interface {
	ListMailboxPortalMailboxes(context.Context, int64) ([]map[string]any, error)
	ListMailboxPortalMessages(context.Context, MailboxPortalMessageListInput) (MailboxPortalMessageList, error)
	GetMailboxPortalMessage(context.Context, int64, int64) (map[string]any, error)
	ListMailboxPortalSentMessages(context.Context, int64, int64, int, int) (map[string]any, error)
	ListMailboxPortalForwardingJobs(context.Context, int64, *int64, int, int) (map[string]any, error)
	GetMailboxPortalSentMessage(context.Context, int64, int64) (map[string]any, error)
	UpdateMailboxPortalForwarding(context.Context, int64, int64, string, *string) (map[string]any, error)
	loadMailboxPortalSendConfig(context.Context, int64, int64, string) (resendSendConfig, error)
	createPendingOutboundMessage(context.Context, int64, *int64, *int64, string, []string, string, string, string) (int64, error)
	completeOutboundMessage(context.Context, int64, string, string, string) (map[string]any, error)
}

var _ MailboxPortalStore = (*PostgresStore)(nil)

type mailboxPortalRowScanner interface {
	Scan(...any) error
}

func (s *PostgresStore) ListMailboxPortalMailboxes(ctx context.Context, mailboxUserID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			mailbox.id, mailbox.domain_id, mailbox.local_part, mailbox.address,
			mailbox.display_name, mailbox.status::text, mailbox.provisioning_mode::text,
			mailbox.can_login, mailbox.is_catch_all_target, mailbox.forward_mode::text,
			mailbox.forward_to,
			domain.id, domain.name, domain.can_send, domain.can_receive,
			EXISTS (
				SELECT 1
				FROM domain_sending_configs AS sending
				WHERE sending.domain_id = domain.id
				  AND sending.provider = 'RESEND'
				  AND sending.status = 'ACTIVE'
			)
		FROM domain_mailboxes AS mailbox
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $1
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		)
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND domain.can_receive = TRUE
		ORDER BY mailbox.id ASC
	`, mailboxUserID)
	if err != nil {
		return nil, fmt.Errorf("list mailbox portal mailboxes: %w", err)
	}
	defer rows.Close()

	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, domainID int64
		var localPart, address, status, provisioningMode, forwardMode string
		var displayName, forwardTo sql.NullString
		var canLogin, isCatchAllTarget, domainCanSend, domainCanReceive, sendReady bool
		var domainName string
		if err := rows.Scan(
			&id, &domainID, &localPart, &address,
			&displayName, &status, &provisioningMode,
			&canLogin, &isCatchAllTarget, &forwardMode,
			&forwardTo,
			&domainID, &domainName, &domainCanSend, &domainCanReceive,
			&sendReady,
		); err != nil {
			return nil, fmt.Errorf("scan mailbox portal mailbox: %w", err)
		}
		mailbox := map[string]any{
			"id":               id,
			"domainId":         domainID,
			"localPart":        localPart,
			"address":          address,
			"displayName":      nullablePortalString(displayName),
			"status":           status,
			"provisioningMode": provisioningMode,
			"canLogin":         canLogin,
			"isCatchAllTarget": isCatchAllTarget,
			"forwardMode":      forwardMode,
			"forwardTo":        nullablePortalString(forwardTo),
			"domain": map[string]any{
				"id": domainID, "name": domainName,
				"canSend": domainCanSend, "canReceive": domainCanReceive,
			},
			"sendReady": domainCanSend && sendReady,
		}
		for key, value := range hostedInternalProtocolSummary(provisioningMode, domainCanSend, domainCanReceive) {
			mailbox[key] = value
		}
		result = append(result, mailbox)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mailbox portal mailboxes: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) ListMailboxPortalMessages(
	ctx context.Context,
	input MailboxPortalMessageListInput,
) (MailboxPortalMessageList, error) {
	var mailboxID any
	if input.MailboxID != nil {
		mailboxID = *input.MailboxID
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM inbound_messages AS message
		JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $1
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		)
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND ($2::bigint IS NULL OR message.mailbox_id = $2)
		  AND ($3::boolean = FALSE OR message.is_read = FALSE)
		  AND message.portal_state = 'VISIBLE'
		  AND message.is_deleted = FALSE
	`, input.MailboxUserID, mailboxID, input.UnreadOnly).Scan(&total); err != nil {
		return MailboxPortalMessageList{}, fmt.Errorf("count mailbox portal messages: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			message.id, message.matched_address, message.final_address,
			message.from_address, message.to_address, message.subject,
			message.text_preview, message.html_preview, message.verification_code,
			message.route_kind, message.received_at, message.storage_status::text,
			message.is_read,
			domain.id, domain.name, domain.can_send, domain.can_receive,
			mailbox.id, mailbox.address, mailbox.provisioning_mode::text
		FROM inbound_messages AS message
		JOIN domains AS domain ON domain.id = message.domain_id
		JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
		WHERE EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $1
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		)
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND ($2::bigint IS NULL OR message.mailbox_id = $2)
		  AND ($3::boolean = FALSE OR message.is_read = FALSE)
		  AND message.portal_state = 'VISIBLE'
		  AND message.is_deleted = FALSE
		ORDER BY message.received_at DESC, message.id DESC
		LIMIT $4 OFFSET $5
	`, input.MailboxUserID, mailboxID, input.UnreadOnly, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return MailboxPortalMessageList{}, fmt.Errorf("list mailbox portal messages: %w", err)
	}
	defer rows.Close()

	list := make([]map[string]any, 0, input.PageSize)
	for rows.Next() {
		row, err := scanMailboxPortalMessageListRow(rows)
		if err != nil {
			return MailboxPortalMessageList{}, fmt.Errorf("scan mailbox portal message: %w", err)
		}
		list = append(list, row.response())
	}
	if err := rows.Err(); err != nil {
		return MailboxPortalMessageList{}, fmt.Errorf("iterate mailbox portal messages: %w", err)
	}
	return MailboxPortalMessageList{List: list, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *PostgresStore) GetMailboxPortalMessage(
	ctx context.Context,
	id int64,
	mailboxUserID int64,
) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin mailbox portal message read: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	row, err := scanMailboxPortalMessageDetailRow(tx.QueryRow(ctx, `
		SELECT
			message.id, message.domain_id, message.mailbox_id,
			message.matched_address, message.final_address, message.message_id_header,
			message.from_address, message.to_address, message.subject,
			message.text_preview, message.html_preview, message.verification_code,
			message.route_kind, message.received_at, message.storage_status::text,
			message.raw_object_key, message.attachments_meta::text, message.headers_json::text,
			message.is_read, message.is_deleted, message.portal_state::text,
			message.created_at, message.updated_at,
			domain.id, domain.name, domain.can_send, domain.can_receive,
			mailbox.id, mailbox.address, mailbox.provisioning_mode::text
		FROM inbound_messages AS message
		JOIN domains AS domain ON domain.id = message.domain_id
		JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
		WHERE message.id = $1
		  AND EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $2
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		  )
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND message.portal_state = 'VISIBLE'
		  AND message.is_deleted = FALSE
		FOR UPDATE OF message
	`, id, mailboxUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load scoped mailbox portal message: %w", err)
	}

	tag, err := tx.Exec(ctx, `
		UPDATE inbound_messages AS message
		SET is_read = TRUE,
		    updated_at = CURRENT_TIMESTAMP
		FROM domain_mailboxes AS mailbox
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE message.id = $1
		  AND message.mailbox_id = mailbox.id
		  AND EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $2
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		  )
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND message.portal_state = 'VISIBLE'
		  AND message.is_deleted = FALSE
	`, id, mailboxUserID)
	if err != nil {
		return nil, fmt.Errorf("mark mailbox portal message read: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return nil, errNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit mailbox portal message read: %w", err)
	}
	row.IsRead = true
	return row.response(), nil
}

const mailboxPortalOutboundAccess = `
	EXISTS (
		SELECT 1
		FROM mailbox_users AS portal_user
		WHERE portal_user.id = $1
		  AND portal_user.status = 'ACTIVE'
		  AND (
			mailbox.owner_user_id = portal_user.id
			OR EXISTS (
				SELECT 1
				FROM mailbox_memberships AS membership
				WHERE membership.mailbox_id = mailbox.id
				  AND membership.user_id = portal_user.id
			)
		  )
	)
	AND mailbox.status = 'ACTIVE'
	AND domain_row.status = 'ACTIVE'
	AND domain_row.can_receive = TRUE`

func (s *PostgresStore) ListMailboxPortalSentMessages(
	ctx context.Context,
	mailboxUserID, mailboxID int64,
	page, pageSize int,
) (map[string]any, error) {
	if err := s.requireMailboxPortalMailboxAccess(ctx, mailboxUserID, mailboxID); err != nil {
		return nil, err
	}
	where := ` WHERE message.mailbox_id = $2 AND ` + mailboxPortalOutboundAccess
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM outbound_messages AS message
		JOIN domains AS domain_row ON domain_row.id = message.domain_id
		JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
	`+where, mailboxUserID, mailboxID).Scan(&total); err != nil {
		return nil, fmt.Errorf("count mailbox portal sent messages: %w", err)
	}
	rows, err := s.pool.Query(ctx, outboundMessageSelect+where+`
		ORDER BY message.created_at DESC, message.id DESC
		LIMIT $3 OFFSET $4
	`, mailboxUserID, mailboxID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list mailbox portal sent messages: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		row, err := scanOutboundMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("scan mailbox portal sent message: %w", err)
		}
		list = append(list, mailboxPortalOutboundMessage(row, false))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mailbox portal sent messages: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (s *PostgresStore) GetMailboxPortalSentMessage(
	ctx context.Context,
	id, mailboxUserID int64,
) (map[string]any, error) {
	row, err := scanOutboundMessage(s.pool.QueryRow(ctx, outboundMessageSelect+`
		WHERE message.id = $2
		  AND `+mailboxPortalOutboundAccess,
		mailboxUserID, id,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load scoped mailbox portal sent message: %w", err)
	}
	return mailboxPortalOutboundMessage(row, true), nil
}

func (s *PostgresStore) ListMailboxPortalForwardingJobs(
	ctx context.Context,
	mailboxUserID int64,
	mailboxID *int64,
	page, pageSize int,
) (map[string]any, error) {
	var mailboxFilter any
	if mailboxID != nil {
		if err := s.requireMailboxPortalMailboxAccess(ctx, mailboxUserID, *mailboxID); err != nil {
			return nil, err
		}
		mailboxFilter = *mailboxID
	}
	const relations = `
		FROM mailbox_forward_jobs AS job
		JOIN inbound_messages AS message ON message.id = job.inbound_message_id
		JOIN domain_mailboxes AS mailbox ON mailbox.id = job.mailbox_id
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE EXISTS (
			SELECT 1
			FROM mailbox_users AS portal_user
			WHERE portal_user.id = $1
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
		)
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND ($2::bigint IS NULL OR job.mailbox_id = $2)`
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*)::bigint`+relations, mailboxUserID, mailboxFilter).Scan(&total); err != nil {
		return nil, fmt.Errorf("count mailbox portal forwarding jobs: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT job.id, job.status::text, job.mode::text, job.forward_to,
		       job.attempt_count, job.last_error, job.processed_at,
		       job.created_at, job.next_attempt_at,
		       message.id, message.subject, message.from_address, message.final_address
	`+relations+`
		ORDER BY job.created_at DESC, job.id DESC
		LIMIT $3 OFFSET $4
	`, mailboxUserID, mailboxFilter, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list mailbox portal forwarding jobs: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		var id, inboundMessageID int64
		var status, mode, forwardTo, fromAddress, finalAddress string
		var attemptCount int
		var lastError, subject sql.NullString
		var processedAt, nextAttemptAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(
			&id, &status, &mode, &forwardTo,
			&attemptCount, &lastError, &processedAt,
			&createdAt, &nextAttemptAt,
			&inboundMessageID, &subject, &fromAddress, &finalAddress,
		); err != nil {
			return nil, fmt.Errorf("scan mailbox portal forwarding job: %w", err)
		}
		list = append(list, map[string]any{
			"id":            fmt.Sprint(id),
			"status":        status,
			"mode":          mode,
			"forwardTo":     forwardTo,
			"attemptCount":  attemptCount,
			"lastError":     nullablePortalString(lastError),
			"processedAt":   nullableTimeValue(processedAt),
			"createdAt":     formatAPITime(createdAt),
			"nextAttemptAt": nullableTimeValue(nextAttemptAt),
			"inboundMessage": map[string]any{
				"id": fmt.Sprint(inboundMessageID), "subject": nullablePortalString(subject),
				"fromAddress": fromAddress, "finalAddress": finalAddress,
			},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mailbox portal forwarding jobs: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (s *PostgresStore) UpdateMailboxPortalForwarding(
	ctx context.Context,
	mailboxUserID, mailboxID int64,
	mode string,
	forwardTo *string,
) (map[string]any, error) {
	var target any
	if mode != "DISABLED" && forwardTo != nil {
		target = strings.TrimSpace(*forwardTo)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin mailbox portal forwarding update: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var id, domainID int64
	var address, provisioningMode, forwardMode, domainName string
	var updatedTarget sql.NullString
	var updatedAt time.Time
	var domainCanSend, domainCanReceive, sendReady bool
	err = tx.QueryRow(ctx, `
		WITH updated AS (
			UPDATE domain_mailboxes AS mailbox
			SET forward_mode = $3::"ForwardMode",
			    forward_to = $4,
			    updated_at = CURRENT_TIMESTAMP
			FROM domains AS scope_domain, mailbox_users AS portal_user
			WHERE mailbox.id = $2
			  AND scope_domain.id = mailbox.domain_id
			  AND portal_user.id = $1
			  AND portal_user.status = 'ACTIVE'
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
			  AND mailbox.status = 'ACTIVE'
			  AND scope_domain.status = 'ACTIVE'
			  AND scope_domain.can_receive = TRUE
			RETURNING mailbox.id, mailbox.address, mailbox.provisioning_mode::text,
			          mailbox.forward_mode::text, mailbox.forward_to, mailbox.updated_at,
			          mailbox.domain_id
		)
		SELECT updated.id, updated.address, updated.provisioning_mode,
		       updated.forward_mode, updated.forward_to, updated.updated_at,
		       domain.id, domain.name, domain.can_send, domain.can_receive,
		       EXISTS (
				SELECT 1
				FROM domain_sending_configs AS sending
				WHERE sending.domain_id = domain.id
				  AND sending.provider = 'RESEND'
				  AND sending.status = 'ACTIVE'
		       )
		FROM updated
		JOIN domains AS domain ON domain.id = updated.domain_id
	`, mailboxUserID, mailboxID, mode, target).Scan(
		&id, &address, &provisioningMode,
		&forwardMode, &updatedTarget, &updatedAt,
		&domainID, &domainName, &domainCanSend, &domainCanReceive, &sendReady,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"}
	}
	if err != nil {
		return nil, fmt.Errorf("update scoped mailbox portal forwarding: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit mailbox portal forwarding update: %w", err)
	}
	result := map[string]any{
		"id":               id,
		"address":          address,
		"provisioningMode": provisioningMode,
		"forwardMode":      forwardMode,
		"forwardTo":        nullablePortalString(updatedTarget),
		"updatedAt":        formatAPITime(updatedAt),
		"domain": map[string]any{
			"id": domainID, "name": domainName,
			"canSend": domainCanSend, "canReceive": domainCanReceive,
		},
		"sendReady": domainCanSend && sendReady,
	}
	for key, value := range hostedInternalProtocolSummary(provisioningMode, domainCanSend, domainCanReceive) {
		result[key] = value
	}
	return result, nil
}

func (s *PostgresStore) loadMailboxPortalSendConfig(
	ctx context.Context,
	mailboxUserID, mailboxID int64,
	encryptionKey string,
) (resendSendConfig, error) {
	var result resendSendConfig
	var encryptedKey, fromName, replyTo sql.NullString
	var domainCanSend bool
	err := s.pool.QueryRow(ctx, `
		SELECT domain.id, domain.name, domain.can_send,
		       config.api_key_encrypted, config.from_name_default, config.reply_to_default,
		       mailbox.address
		FROM domain_mailboxes AS mailbox
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		JOIN mailbox_users AS portal_user ON portal_user.id = $1 AND portal_user.status = 'ACTIVE'
		LEFT JOIN domain_sending_configs AS config
		  ON config.domain_id = domain.id
		 AND config.provider = 'RESEND'
		 AND config.status = 'ACTIVE'
		WHERE mailbox.id = $2
		  AND (
			mailbox.owner_user_id = portal_user.id
			OR EXISTS (
				SELECT 1
				FROM mailbox_memberships AS membership
				WHERE membership.mailbox_id = mailbox.id
				  AND membership.user_id = portal_user.id
			)
		  )
		  AND mailbox.status = 'ACTIVE'
		  AND domain.status = 'ACTIVE'
		  AND domain.can_receive = TRUE
	`, mailboxUserID, mailboxID).Scan(
		&result.DomainID, &result.DomainName, &domainCanSend,
		&encryptedKey, &fromName, &replyTo, &result.MailboxAddress,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return resendSendConfig{}, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"}
	}
	if err != nil {
		return resendSendConfig{}, fmt.Errorf("load scoped mailbox portal sending configuration: %w", err)
	}
	if !domainCanSend {
		return resendSendConfig{}, &requestError{Status: http.StatusBadRequest, Code: "DOMAIN_SEND_DISABLED"}
	}
	if !encryptedKey.Valid || strings.TrimSpace(encryptedKey.String) == "" {
		return resendSendConfig{}, managementNotFound("SEND_CONFIG_NOT_FOUND")
	}
	result, err = withDecryptedResendSendConfig(result, encryptedKey, fromName, replyTo, encryptionKey)
	if err != nil {
		return resendSendConfig{}, err
	}
	result.MailboxID = &mailboxID
	return result, nil
}

func (s *PostgresStore) requireMailboxPortalMailboxAccess(ctx context.Context, mailboxUserID, mailboxID int64) error {
	var allowed bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM domain_mailboxes AS mailbox
			JOIN domains AS domain ON domain.id = mailbox.domain_id
			JOIN mailbox_users AS portal_user ON portal_user.id = $1 AND portal_user.status = 'ACTIVE'
			WHERE mailbox.id = $2
			  AND (
				mailbox.owner_user_id = portal_user.id
				OR EXISTS (
					SELECT 1
					FROM mailbox_memberships AS membership
					WHERE membership.mailbox_id = mailbox.id
					  AND membership.user_id = portal_user.id
				)
			  )
			  AND mailbox.status = 'ACTIVE'
			  AND domain.status = 'ACTIVE'
			  AND domain.can_receive = TRUE
		)
	`, mailboxUserID, mailboxID).Scan(&allowed); err != nil {
		return fmt.Errorf("authorize mailbox portal mailbox: %w", err)
	}
	if !allowed {
		return &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"}
	}
	return nil
}

func mailboxPortalOutboundMessage(row outboundMessageRow, includeBody bool) map[string]any {
	result := safeOutboundMessage(row, includeBody)
	mailbox, ok := result["mailbox"].(map[string]any)
	if !ok {
		return result
	}
	for key, value := range hostedInternalProtocolSummary(row.ProvisioningMode.String, row.DomainCanSend, row.DomainCanReceive) {
		mailbox[key] = value
	}
	return result
}

type mailboxPortalMessageListRow struct {
	ID               int64
	MatchedAddress   string
	FinalAddress     string
	FromAddress      string
	ToAddress        string
	Subject          sql.NullString
	TextPreview      sql.NullString
	HTMLPreview      sql.NullString
	VerificationCode sql.NullString
	RouteKind        sql.NullString
	ReceivedAt       time.Time
	StorageStatus    string
	IsRead           bool
	DomainID         int64
	DomainName       string
	DomainCanSend    bool
	DomainCanReceive bool
	MailboxID        int64
	MailboxAddress   string
	ProvisioningMode string
}

func scanMailboxPortalMessageListRow(scanner mailboxPortalRowScanner) (mailboxPortalMessageListRow, error) {
	var row mailboxPortalMessageListRow
	err := scanner.Scan(
		&row.ID, &row.MatchedAddress, &row.FinalAddress,
		&row.FromAddress, &row.ToAddress, &row.Subject,
		&row.TextPreview, &row.HTMLPreview, &row.VerificationCode,
		&row.RouteKind, &row.ReceivedAt, &row.StorageStatus,
		&row.IsRead,
		&row.DomainID, &row.DomainName, &row.DomainCanSend, &row.DomainCanReceive,
		&row.MailboxID, &row.MailboxAddress, &row.ProvisioningMode,
	)
	return row, err
}

func (row mailboxPortalMessageListRow) response() map[string]any {
	return map[string]any{
		"id":               fmt.Sprint(row.ID),
		"matchedAddress":   row.MatchedAddress,
		"finalAddress":     row.FinalAddress,
		"fromAddress":      row.FromAddress,
		"toAddress":        row.ToAddress,
		"subject":          nullablePortalString(row.Subject),
		"textPreview":      nullablePortalString(row.TextPreview),
		"htmlPreview":      nullablePortalString(row.HTMLPreview),
		"verificationCode": nullablePortalString(row.VerificationCode),
		"routeKind":        nullablePortalString(row.RouteKind),
		"receivedAt":       formatAPITime(row.ReceivedAt),
		"storageStatus":    row.StorageStatus,
		"isRead":           row.IsRead,
		"domain": map[string]any{
			"id": row.DomainID, "name": row.DomainName,
			"canSend": row.DomainCanSend, "canReceive": row.DomainCanReceive,
		},
		"mailbox": mailboxPortalMessageMailbox(row.MailboxID, row.MailboxAddress, row.ProvisioningMode, row.DomainCanSend, row.DomainCanReceive),
	}
}

type mailboxPortalMessageDetailRow struct {
	mailboxPortalMessageListRow
	DomainIDValue   int64
	MailboxIDValue  int64
	MessageIDHeader sql.NullString
	RawObjectKey    sql.NullString
	AttachmentsMeta sql.NullString
	HeadersJSON     sql.NullString
	IsDeleted       bool
	PortalState     string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func scanMailboxPortalMessageDetailRow(scanner mailboxPortalRowScanner) (mailboxPortalMessageDetailRow, error) {
	var row mailboxPortalMessageDetailRow
	err := scanner.Scan(
		&row.ID, &row.DomainIDValue, &row.MailboxIDValue,
		&row.MatchedAddress, &row.FinalAddress, &row.MessageIDHeader,
		&row.FromAddress, &row.ToAddress, &row.Subject,
		&row.TextPreview, &row.HTMLPreview, &row.VerificationCode,
		&row.RouteKind, &row.ReceivedAt, &row.StorageStatus,
		&row.RawObjectKey, &row.AttachmentsMeta, &row.HeadersJSON,
		&row.IsRead, &row.IsDeleted, &row.PortalState,
		&row.CreatedAt, &row.UpdatedAt,
		&row.DomainID, &row.DomainName, &row.DomainCanSend, &row.DomainCanReceive,
		&row.MailboxID, &row.MailboxAddress, &row.ProvisioningMode,
	)
	return row, err
}

func (row mailboxPortalMessageDetailRow) response() map[string]any {
	result := row.mailboxPortalMessageListRow.response()
	result["domainId"] = row.DomainIDValue
	result["mailboxId"] = row.MailboxIDValue
	result["messageIdHeader"] = nullablePortalString(row.MessageIDHeader)
	result["rawObjectKey"] = nullablePortalString(row.RawObjectKey)
	result["attachmentsMeta"] = nullablePortalJSON(row.AttachmentsMeta)
	result["headersJson"] = nullablePortalJSON(row.HeadersJSON)
	result["isDeleted"] = row.IsDeleted
	result["portalState"] = row.PortalState
	result["createdAt"] = formatAPITime(row.CreatedAt)
	result["updatedAt"] = formatAPITime(row.UpdatedAt)
	return result
}

func mailboxPortalMessageMailbox(id int64, address, mode string, canSend, canReceive bool) map[string]any {
	mailbox := map[string]any{"id": id, "address": address, "provisioningMode": mode}
	for key, value := range hostedInternalProtocolSummary(mode, canSend, canReceive) {
		mailbox[key] = value
	}
	return mailbox
}

func nullablePortalJSON(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return json.RawMessage(value.String)
}

func nullablePortalString(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}
