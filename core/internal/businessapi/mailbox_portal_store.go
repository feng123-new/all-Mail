package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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
			"sendReady": sendReady,
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
