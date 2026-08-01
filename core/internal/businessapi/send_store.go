package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

type outboundSendStore interface {
	loadResendSendConfig(context.Context, int64, *int64, string, string) (resendSendConfig, error)
	createPendingOutboundMessage(context.Context, int64, *int64, string, []string, string, string, string) (int64, error)
	completeOutboundMessage(context.Context, int64, string, string, string) (map[string]any, error)
}

var _ outboundSendStore = (*PostgresStore)(nil)

type resendSendConfig struct {
	DomainID       int64
	DomainName     string
	APIKey         string
	FromName       string
	ReplyTo        string
	MailboxID      *int64
	MailboxAddress string
}

type outboundMessageRow struct {
	ID                int64
	DomainID          int64
	MailboxID         sql.NullInt64
	ProviderMessageID sql.NullString
	FromAddress       string
	ToAddresses       []byte
	Subject           sql.NullString
	HTMLBody          sql.NullString
	TextBody          sql.NullString
	Status            string
	LastError         sql.NullString
	CreatedAt         time.Time
	UpdatedAt         time.Time
	DomainName        string
	DomainCanSend     bool
	DomainCanReceive  bool
	MailboxAddress    sql.NullString
	ProvisioningMode  sql.NullString
}

func (s *PostgresStore) listSendConfigs(ctx context.Context, domainID *int64) (map[string]any, error) {
	var filter any
	if domainID != nil {
		filter = *domainID
	}
	rows, err := s.pool.Query(ctx, `
		SELECT config.id, config.domain_id, config.provider::text, config.from_name_default,
		       config.reply_to_default, config.status::text, config.created_at, config.updated_at,
		       domain_row.id, domain_row.name, domain_row.can_send
		FROM domain_sending_configs AS config
		JOIN domains AS domain_row ON domain_row.id = config.domain_id
		WHERE ($1::bigint IS NULL OR config.domain_id = $1)
		ORDER BY config.id ASC
	`, filter)
	if err != nil {
		return nil, fmt.Errorf("list sending configurations: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, configDomainID, joinedDomainID int64
		var providerName, status, domainName string
		var fromName, replyTo sql.NullString
		var createdAt, updatedAt time.Time
		var canSend bool
		if err := rows.Scan(&id, &configDomainID, &providerName, &fromName, &replyTo, &status, &createdAt, &updatedAt, &joinedDomainID, &domainName, &canSend); err != nil {
			return nil, fmt.Errorf("scan sending configuration: %w", err)
		}
		list = append(list, map[string]any{
			"id": id, "domainId": configDomainID, "provider": providerName,
			"fromNameDefault": nullableStringValue(fromName), "replyToDefault": nullableStringValue(replyTo),
			"status": status, "createdAt": formatAPITime(createdAt), "updatedAt": formatAPITime(updatedAt),
			"domain": map[string]any{"id": joinedDomainID, "name": domainName, "canSend": canSend},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sending configurations: %w", err)
	}
	return map[string]any{"list": list, "filters": map[string]any{"domainId": domainID}}, nil
}

func (s *PostgresStore) deleteSendConfig(ctx context.Context, id int64) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM domain_sending_configs WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete sending configuration: %w", err)
	}
	if command.RowsAffected() == 0 {
		return managementNotFound("SEND_CONFIG_NOT_FOUND")
	}
	return nil
}

const outboundMessageSelect = `
	SELECT message.id, message.domain_id, message.mailbox_id, message.provider_message_id,
	       message.from_address, message.to_addresses, message.subject, message.html_body,
	       message.text_body, message.status::text, message.last_error,
	       message.created_at, message.updated_at,
	       domain_row.name, domain_row.can_send, domain_row.can_receive,
	       mailbox.address, mailbox.provisioning_mode::text
	FROM outbound_messages AS message
	JOIN domains AS domain_row ON domain_row.id = message.domain_id
	LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = message.mailbox_id
`

func scanOutboundMessage(scanner managementRowScanner) (outboundMessageRow, error) {
	var row outboundMessageRow
	err := scanner.Scan(
		&row.ID, &row.DomainID, &row.MailboxID, &row.ProviderMessageID,
		&row.FromAddress, &row.ToAddresses, &row.Subject, &row.HTMLBody,
		&row.TextBody, &row.Status, &row.LastError, &row.CreatedAt, &row.UpdatedAt,
		&row.DomainName, &row.DomainCanSend, &row.DomainCanReceive,
		&row.MailboxAddress, &row.ProvisioningMode,
	)
	return row, err
}

func safeOutboundMessage(row outboundMessageRow, includeBody bool) map[string]any {
	var recipients []string
	_ = json.Unmarshal(row.ToAddresses, &recipients)
	result := map[string]any{
		"id": fmt.Sprintf("%d", row.ID), "domainId": row.DomainID, "mailboxId": nullableInt64Value(row.MailboxID),
		"providerMessageId": nullableStringValue(row.ProviderMessageID), "fromAddress": row.FromAddress,
		"toAddresses": recipients, "subject": nullableStringValue(row.Subject), "status": row.Status,
		"lastError": nullableStringValue(row.LastError), "createdAt": formatAPITime(row.CreatedAt), "updatedAt": formatAPITime(row.UpdatedAt),
		"domain": map[string]any{"id": row.DomainID, "name": row.DomainName, "canSend": row.DomainCanSend, "canReceive": row.DomainCanReceive},
	}
	if row.MailboxID.Valid {
		mailbox := map[string]any{
			"id": row.MailboxID.Int64, "address": row.MailboxAddress.String, "provisioningMode": row.ProvisioningMode.String,
		}
		for key, value := range hostedInternalProtocolSummary(row.ProvisioningMode.String, row.DomainCanSend, row.DomainCanReceive) {
			mailbox[key] = value
		}
		result["mailbox"] = mailbox
	} else {
		result["mailbox"] = nil
	}
	if includeBody {
		result["htmlBody"] = nullableStringValue(row.HTMLBody)
		result["textBody"] = nullableStringValue(row.TextBody)
	}
	return result
}

func (s *PostgresStore) listOutboundMessages(ctx context.Context, page, pageSize int, domainID, mailboxID *int64) (map[string]any, error) {
	var domainFilter, mailboxFilter any
	if domainID != nil {
		domainFilter = *domainID
	}
	if mailboxID != nil {
		mailboxFilter = *mailboxID
	}
	where := ` WHERE ($1::bigint IS NULL OR message.domain_id = $1) AND ($2::bigint IS NULL OR message.mailbox_id = $2)`
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM outbound_messages AS message`+where, domainFilter, mailboxFilter).Scan(&total); err != nil {
		return nil, fmt.Errorf("count outbound messages: %w", err)
	}
	rows, err := s.pool.Query(ctx, outboundMessageSelect+where+` ORDER BY message.created_at DESC, message.id DESC LIMIT $3 OFFSET $4`, domainFilter, mailboxFilter, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list outbound messages: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		row, err := scanOutboundMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("scan outbound message: %w", err)
		}
		list = append(list, safeOutboundMessage(row, false))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate outbound messages: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (s *PostgresStore) deleteOutboundMessages(ctx context.Context, ids []int64) (int64, error) {
	command, err := s.pool.Exec(ctx, `DELETE FROM outbound_messages WHERE id = ANY($1::bigint[])`, normalizeManagementIDs(ids))
	if err != nil {
		return 0, fmt.Errorf("delete outbound messages: %w", err)
	}
	return command.RowsAffected(), nil
}

func (s *PostgresStore) loadResendSendConfig(ctx context.Context, domainID int64, mailboxID *int64, from, encryptionKey string) (resendSendConfig, error) {
	var result resendSendConfig
	var encryptedKey sql.NullString
	var fromName, replyTo sql.NullString
	var domainStatus string
	var canSend bool
	err := s.pool.QueryRow(ctx, `
		SELECT domain_row.id, domain_row.name, domain_row.status::text, domain_row.can_send,
		       config.api_key_encrypted, config.from_name_default, config.reply_to_default
		FROM domains AS domain_row
		LEFT JOIN domain_sending_configs AS config
		  ON config.domain_id = domain_row.id AND config.provider = 'RESEND' AND config.status = 'ACTIVE'
		WHERE domain_row.id = $1
	`, domainID).Scan(&result.DomainID, &result.DomainName, &domainStatus, &canSend, &encryptedKey, &fromName, &replyTo)
	if errorsIsNoRows(err) {
		return resendSendConfig{}, managementNotFound("DOMAIN_NOT_FOUND")
	}
	if err != nil {
		return resendSendConfig{}, fmt.Errorf("load active Resend configuration: %w", err)
	}
	if !encryptedKey.Valid || strings.TrimSpace(encryptedKey.String) == "" {
		return resendSendConfig{}, managementNotFound("SEND_CONFIG_NOT_FOUND")
	}
	if domainStatus != "ACTIVE" {
		return resendSendConfig{}, &requestError{Status: http.StatusForbidden, Code: "DOMAIN_DISABLED"}
	}
	if !canSend {
		return resendSendConfig{}, &requestError{Status: http.StatusBadRequest, Code: "DOMAIN_SEND_DISABLED"}
	}
	fromParts := strings.SplitN(from, "@", 2)
	if len(fromParts) != 2 || strings.ToLower(strings.TrimSpace(fromParts[1])) != strings.ToLower(result.DomainName) {
		return resendSendConfig{}, validationError("from address does not belong to selected domain")
	}
	apiKey, err := legacycrypto.Decrypt(encryptionKey, encryptedKey.String)
	if err != nil {
		return resendSendConfig{}, &requestError{Status: http.StatusInternalServerError, Code: "SEND_CONFIG_INVALID", Cause: err}
	}
	result.APIKey = apiKey
	result.FromName = fromName.String
	result.ReplyTo = replyTo.String
	result.MailboxID = mailboxID
	if mailboxID != nil {
		var mailboxDomainID int64
		var status string
		if err := s.pool.QueryRow(ctx, `SELECT domain_id, address, status::text FROM domain_mailboxes WHERE id = $1`, *mailboxID).Scan(&mailboxDomainID, &result.MailboxAddress, &status); errorsIsNoRows(err) {
			return resendSendConfig{}, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
		} else if err != nil {
			return resendSendConfig{}, fmt.Errorf("load outbound mailbox: %w", err)
		}
		if mailboxDomainID != domainID {
			return resendSendConfig{}, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
		}
		if status != "ACTIVE" {
			return resendSendConfig{}, &requestError{Status: http.StatusForbidden, Code: "DOMAIN_MAILBOX_DISABLED"}
		}
	}
	return result, nil
}

func (s *PostgresStore) createPendingOutboundMessage(ctx context.Context, domainID int64, mailboxID *int64, from string, to []string, subject, html, text string) (int64, error) {
	recipients, err := json.Marshal(to)
	if err != nil {
		return 0, validationError("to must be a JSON array")
	}
	var id int64
	err = s.pool.QueryRow(ctx, `
		INSERT INTO outbound_messages (
			domain_id, mailbox_id, from_address, to_addresses, subject, html_body, text_body,
			status, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4::jsonb, $5, NULLIF($6, ''), NULLIF($7, ''), 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID, mailboxID, from, string(recipients), subject, html, text).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("create pending outbound message: %w", err)
	}
	return id, nil
}

func (s *PostgresStore) completeOutboundMessage(ctx context.Context, id int64, providerMessageID, status, lastError string) (map[string]any, error) {
	var providerValue, errorValue any
	if providerMessageID != "" {
		providerValue = providerMessageID
	}
	if lastError != "" {
		errorValue = lastError
	}
	row, err := scanOutboundMessage(s.pool.QueryRow(ctx, `
		WITH updated AS (
			UPDATE outbound_messages
			SET provider_message_id = $2, status = $3::"SendStatus", last_error = $4, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
			RETURNING *
		)
		SELECT updated.id, updated.domain_id, updated.mailbox_id, updated.provider_message_id,
		       updated.from_address, updated.to_addresses, updated.subject, updated.html_body,
		       updated.text_body, updated.status::text, updated.last_error,
		       updated.created_at, updated.updated_at,
		       domain_row.name, domain_row.can_send, domain_row.can_receive,
		       mailbox.address, mailbox.provisioning_mode::text
		FROM updated
		JOIN domains AS domain_row ON domain_row.id = updated.domain_id
		LEFT JOIN domain_mailboxes AS mailbox ON mailbox.id = updated.mailbox_id
	`, id, providerValue, status, errorValue))
	if err != nil {
		return nil, fmt.Errorf("complete outbound message: %w", err)
	}
	return safeOutboundMessage(row, true), nil
}
