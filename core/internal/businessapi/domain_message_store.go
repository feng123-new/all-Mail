package businessapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	_ adminDomainMessageStore = (*PostgresStore)(nil)
	_ domainMessageTextStore  = (*PostgresStore)(nil)
)

type adminDomainMessageListRow struct {
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
	MailboxID        sql.NullInt64
	MailboxAddress   sql.NullString
	ProvisioningMode sql.NullString
}

type adminDomainMessageDetailRow struct {
	adminDomainMessageListRow
	DomainIDValue   int64
	MailboxIDValue  sql.NullInt64
	MessageIDHeader sql.NullString
	RawObjectKey    sql.NullString
	AttachmentsMeta sql.NullString
	HeadersJSON     sql.NullString
	IsDeleted       bool
	PortalState     string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (s *PostgresStore) ListAdminDomainMessages(
	ctx context.Context,
	input adminDomainMessageListInput,
) (adminDomainMessageListResult, error) {
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
		WHERE ($1::bigint IS NULL OR message.domain_id = $1)
		  AND ($2::bigint IS NULL OR message.mailbox_id = $2)
		  AND ($3::boolean = FALSE OR message.is_read = FALSE)
		  AND message.is_deleted = FALSE
	`, domainID, mailboxID, input.UnreadOnly).Scan(&total); err != nil {
		return adminDomainMessageListResult{}, fmt.Errorf("count admin domain messages: %w", err)
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
		WHERE ($1::bigint IS NULL OR message.domain_id = $1)
		  AND ($2::bigint IS NULL OR message.mailbox_id = $2)
		  AND ($3::boolean = FALSE OR message.is_read = FALSE)
		  AND message.is_deleted = FALSE
		ORDER BY message.received_at DESC, message.id DESC
		LIMIT $4 OFFSET $5
	`, domainID, mailboxID, input.UnreadOnly, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return adminDomainMessageListResult{}, fmt.Errorf("list admin domain messages: %w", err)
	}
	defer rows.Close()

	list := make([]map[string]any, 0, input.PageSize)
	for rows.Next() {
		row, err := scanAdminDomainMessageListRow(rows)
		if err != nil {
			return adminDomainMessageListResult{}, fmt.Errorf("scan admin domain message: %w", err)
		}
		list = append(list, row.response())
	}
	if err := rows.Err(); err != nil {
		return adminDomainMessageListResult{}, fmt.Errorf("iterate admin domain messages: %w", err)
	}
	return adminDomainMessageListResult{
		List: list, Total: total, Page: input.Page, PageSize: input.PageSize,
	}, nil
}

func (s *PostgresStore) GetAdminDomainMessage(ctx context.Context, id int64) (map[string]any, error) {
	row, err := scanAdminDomainMessageDetailRow(s.pool.QueryRow(ctx, `
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
		LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
		WHERE message.id = $1
	`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &requestError{Status: http.StatusNotFound, Code: "INBOUND_MESSAGE_NOT_FOUND"}
	}
	if err != nil {
		return nil, fmt.Errorf("load admin domain message: %w", err)
	}
	return row.response(), nil
}

func (s *PostgresStore) DeleteAdminDomainMessages(
	ctx context.Context,
	ids []int64,
) (adminDomainMessageDeleteResult, error) {
	formattedIDs := make([]string, len(ids))
	for index, id := range ids {
		formattedIDs[index] = strconv.FormatInt(id, 10)
	}
	if len(ids) == 0 {
		return adminDomainMessageDeleteResult{IDs: formattedIDs}, nil
	}
	command, err := s.pool.Exec(ctx, `
		UPDATE inbound_messages
		SET is_deleted = TRUE,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ANY($1::bigint[])
		  AND is_deleted = FALSE
	`, ids)
	if err != nil {
		return adminDomainMessageDeleteResult{}, fmt.Errorf("soft delete admin domain messages: %w", err)
	}
	return adminDomainMessageDeleteResult{Deleted: command.RowsAffected(), IDs: formattedIDs}, nil
}

func (s *PostgresStore) GetLatestDomainMessageText(
	ctx context.Context,
	apiKeyID int64,
	email string,
	maxCharacters int,
) (string, bool, error) {
	mailbox, err := s.resolveAccessibleDomainMailbox(ctx, apiKeyID, email)
	if err != nil {
		return "", false, err
	}
	if maxCharacters < 1 {
		maxCharacters = 1
	}
	var content string
	err = s.pool.QueryRow(ctx, `
		SELECT LEFT(COALESCE(NULLIF(text_preview, ''), html_preview, ''), $2)
		FROM inbound_messages
		WHERE mailbox_id = $1
		  AND is_deleted = FALSE
		ORDER BY received_at DESC, id DESC
		LIMIT 1
	`, mailbox.ID, maxCharacters).Scan(&content)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("load latest domain message text: %w", err)
	}
	return content, true, nil
}

func scanAdminDomainMessageListRow(scanner mailboxPortalRowScanner) (adminDomainMessageListRow, error) {
	var row adminDomainMessageListRow
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

func scanAdminDomainMessageDetailRow(scanner mailboxPortalRowScanner) (adminDomainMessageDetailRow, error) {
	var row adminDomainMessageDetailRow
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

func (row adminDomainMessageListRow) response() map[string]any {
	return map[string]any{
		"id":               strconv.FormatInt(row.ID, 10),
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
		"mailbox": row.mailboxResponse(),
	}
}

func (row adminDomainMessageListRow) mailboxResponse() any {
	if !row.MailboxID.Valid {
		return nil
	}
	mailbox := map[string]any{
		"id":               row.MailboxID.Int64,
		"address":          row.MailboxAddress.String,
		"provisioningMode": row.ProvisioningMode.String,
	}
	for key, value := range hostedInternalProtocolSummary(
		row.ProvisioningMode.String,
		row.DomainCanSend,
		row.DomainCanReceive,
	) {
		mailbox[key] = value
	}
	return mailbox
}

func (row adminDomainMessageDetailRow) response() map[string]any {
	result := row.adminDomainMessageListRow.response()
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
