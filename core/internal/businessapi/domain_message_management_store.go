package businessapi

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type managedDomainMessageRow struct {
	ID               int64
	DomainIDValue    int64
	MailboxIDValue   sql.NullInt64
	MatchedAddress   string
	FinalAddress     string
	MessageIDHeader  sql.NullString
	FromAddress      string
	ToAddress        string
	Subject          sql.NullString
	TextPreview      sql.NullString
	HTMLPreview      sql.NullString
	VerificationCode sql.NullString
	RouteKind        sql.NullString
	ReceivedAt       time.Time
	StorageStatus    string
	RawObjectKey     sql.NullString
	AttachmentsMeta  sql.NullString
	HeadersJSON      sql.NullString
	IsRead           bool
	IsDeleted        bool
	PortalState      string
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DomainID         int64
	DomainName       string
	DomainCanSend    bool
	DomainCanReceive bool
	MailboxID        sql.NullInt64
	MailboxAddress   sql.NullString
	ProvisioningMode sql.NullString
}

type managedDomainMessageScanner interface {
	Scan(...any) error
}

const managedDomainMessageDetailSelect = `
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
`

func (s *PostgresStore) listManagedDomainMessages(ctx context.Context, input managedDomainMessageListInput) (map[string]any, error) {
	var domainID, mailboxID any
	if input.DomainID != nil {
		domainID = *input.DomainID
	}
	if input.MailboxID != nil {
		mailboxID = *input.MailboxID
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM inbound_messages AS message
		WHERE message.is_deleted = FALSE
		  AND ($1::bigint IS NULL OR message.domain_id = $1)
		  AND ($2::bigint IS NULL OR message.mailbox_id = $2)
		  AND ($3::boolean = FALSE OR message.is_read = FALSE)
	`, domainID, mailboxID, input.UnreadOnly).Scan(&total); err != nil {
		return nil, fmt.Errorf("count inbound domain messages: %w", err)
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
		LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
		WHERE message.is_deleted = FALSE
		  AND ($1::bigint IS NULL OR message.domain_id = $1)
		  AND ($2::bigint IS NULL OR message.mailbox_id = $2)
		  AND ($3::boolean = FALSE OR message.is_read = FALSE)
		ORDER BY message.received_at DESC, message.id DESC
		LIMIT $4 OFFSET $5
	`, domainID, mailboxID, input.UnreadOnly, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return nil, fmt.Errorf("list inbound domain messages: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, input.PageSize)
	for rows.Next() {
		var row managedDomainMessageRow
		if err := rows.Scan(
			&row.ID, &row.MatchedAddress, &row.FinalAddress,
			&row.FromAddress, &row.ToAddress, &row.Subject,
			&row.TextPreview, &row.HTMLPreview, &row.VerificationCode,
			&row.RouteKind, &row.ReceivedAt, &row.StorageStatus,
			&row.IsRead,
			&row.DomainID, &row.DomainName, &row.DomainCanSend, &row.DomainCanReceive,
			&row.MailboxID, &row.MailboxAddress, &row.ProvisioningMode,
		); err != nil {
			return nil, fmt.Errorf("scan inbound domain message: %w", err)
		}
		list = append(list, row.listResponse())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate inbound domain messages: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": input.Page, "pageSize": input.PageSize}, nil
}

func (s *PostgresStore) getManagedDomainMessage(ctx context.Context, id int64) (map[string]any, error) {
	row, err := scanManagedDomainMessage(s.pool.QueryRow(ctx, `
		SELECT `+managedDomainMessageDetailSelect+`
		FROM inbound_messages AS message
		JOIN domains AS domain ON domain.id = message.domain_id
		LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
		WHERE message.id = $1
	`, id))
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("INBOUND_MESSAGE_NOT_FOUND")
		}
		return nil, fmt.Errorf("get inbound domain message: %w", err)
	}
	return row.detailResponse(), nil
}

func (s *PostgresStore) deleteManagedDomainMessages(ctx context.Context, ids []int64) (map[string]any, error) {
	command, err := s.pool.Exec(ctx, `
		UPDATE inbound_messages
		SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
		WHERE id = ANY($1::bigint[]) AND is_deleted = FALSE
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("soft delete inbound domain messages: %w", err)
	}
	stringIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		stringIDs = append(stringIDs, fmt.Sprint(id))
	}
	return map[string]any{"deleted": command.RowsAffected(), "ids": stringIDs}, nil
}

func scanManagedDomainMessage(scanner managedDomainMessageScanner) (managedDomainMessageRow, error) {
	var row managedDomainMessageRow
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

func (row managedDomainMessageRow) listResponse() map[string]any {
	result := map[string]any{
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
		"mailbox": nil,
	}
	if row.MailboxID.Valid && row.MailboxAddress.Valid && row.ProvisioningMode.Valid {
		result["mailbox"] = mailboxPortalMessageMailbox(
			row.MailboxID.Int64, row.MailboxAddress.String, row.ProvisioningMode.String,
			row.DomainCanSend, row.DomainCanReceive,
		)
	}
	return result
}

func (row managedDomainMessageRow) detailResponse() map[string]any {
	result := row.listResponse()
	result["domainId"] = row.DomainIDValue
	result["mailboxId"] = nullableInt64Value(row.MailboxIDValue)
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
