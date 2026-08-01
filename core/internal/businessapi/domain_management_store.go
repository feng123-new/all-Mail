package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type managedDomainCreateInput struct {
	Name              string
	DisplayName       *string
	CanReceive        bool
	CanSend           bool
	IsCatchAllEnabled bool
	VerificationToken string
	CreatedByAdminID  int64
}

type managedDomainUpdateInput struct {
	DisplayName        *string
	DisplayNamePresent bool
	Status             *string
	CanReceive         *bool
	CanSend            *bool
	IsCatchAllEnabled  *bool
	CanApproveSend     bool
}

type managedDomainSendingConfigInput struct {
	Provider        string
	EncryptedAPIKey *string
	FromNameDefault *string
	FromNamePresent bool
	ReplyToDefault  *string
	ReplyToPresent  bool
}

type managedDomainSummaryRow struct {
	ID                  int64
	Name                string
	DisplayName         sql.NullString
	Status              string
	CanReceive          bool
	CanSend             bool
	IsCatchAllEnabled   bool
	VerificationToken   sql.NullString
	ResendDomainID      sql.NullString
	CreatedAt           time.Time
	UpdatedAt           time.Time
	CreatorID           int64
	CreatorUsername     string
	MailboxCount        int64
	InboundMessageCount int64
	SendingConfigCount  int64
}

const managedDomainSummarySelect = `
	SELECT domain_row.id, domain_row.name, domain_row.display_name, domain_row.status::text,
	       domain_row.can_receive, domain_row.can_send, domain_row.is_catch_all_enabled,
	       domain_row.verification_token, domain_row.resend_domain_id,
	       domain_row.created_at, domain_row.updated_at,
	       creator.id, creator.username,
	       (SELECT COUNT(*)::bigint FROM domain_mailboxes WHERE domain_id = domain_row.id),
	       (SELECT COUNT(*)::bigint FROM inbound_messages WHERE domain_id = domain_row.id),
	       (SELECT COUNT(*)::bigint FROM domain_sending_configs WHERE domain_id = domain_row.id)
	FROM domains AS domain_row
	JOIN admins AS creator ON creator.id = domain_row.created_by_admin_id
`

func scanManagedDomainSummary(scanner managementRowScanner) (managedDomainSummaryRow, error) {
	var row managedDomainSummaryRow
	err := scanner.Scan(
		&row.ID, &row.Name, &row.DisplayName, &row.Status,
		&row.CanReceive, &row.CanSend, &row.IsCatchAllEnabled,
		&row.VerificationToken, &row.ResendDomainID,
		&row.CreatedAt, &row.UpdatedAt,
		&row.CreatorID, &row.CreatorUsername,
		&row.MailboxCount, &row.InboundMessageCount, &row.SendingConfigCount,
	)
	return row, err
}

func managedDomainSummaryMap(row managedDomainSummaryRow) map[string]any {
	return map[string]any{
		"id": row.ID, "name": row.Name, "displayName": nullableStringValue(row.DisplayName),
		"status": row.Status, "canReceive": row.CanReceive, "canSend": row.CanSend,
		"isCatchAllEnabled": row.IsCatchAllEnabled,
		"verificationToken": nullableStringValue(row.VerificationToken),
		"resendDomainId":    nullableStringValue(row.ResendDomainID),
		"mailboxCount":      row.MailboxCount, "inboundMessageCount": row.InboundMessageCount,
		"sendingConfigCount": row.SendingConfigCount,
		"createdBy":          map[string]any{"id": row.CreatorID, "username": row.CreatorUsername},
		"createdAt":          formatAPITime(row.CreatedAt), "updatedAt": formatAPITime(row.UpdatedAt),
	}
}

func (s *PostgresStore) listManagedDomains(ctx context.Context, page, pageSize int, keyword, status string) (map[string]any, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM domains AS domain_row
		WHERE ($1 = '' OR domain_row.status::text = $1)
		  AND ($2 = '' OR domain_row.name ILIKE '%' || $2 || '%' OR COALESCE(domain_row.display_name, '') ILIKE '%' || $2 || '%')
	`, status, keyword).Scan(&total); err != nil {
		return nil, fmt.Errorf("count domains: %w", err)
	}
	rows, err := s.pool.Query(ctx, managedDomainSummarySelect+`
		WHERE ($1 = '' OR domain_row.status::text = $1)
		  AND ($2 = '' OR domain_row.name ILIKE '%' || $2 || '%' OR COALESCE(domain_row.display_name, '') ILIKE '%' || $2 || '%')
		ORDER BY domain_row.id DESC
		LIMIT $3 OFFSET $4
	`, status, keyword, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list domains: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		row, err := scanManagedDomainSummary(rows)
		if err != nil {
			return nil, fmt.Errorf("scan domain: %w", err)
		}
		list = append(list, managedDomainSummaryMap(row))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate domains: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (s *PostgresStore) getManagedDomain(ctx context.Context, id int64) (map[string]any, error) {
	var (
		name, status, provider, creatorUsername        string
		displayName, verificationToken, resendDomainID sql.NullString
		catchAllTargetID                               sql.NullInt64
		canReceive, canSend, catchAll                  bool
		dnsStatus                                      []byte
		createdAt, updatedAt                           time.Time
		creatorID, inboundCount, outboundCount         int64
	)
	err := s.pool.QueryRow(ctx, `
		SELECT domain_row.name, domain_row.display_name, domain_row.status::text, domain_row.provider,
		       domain_row.can_receive, domain_row.can_send, domain_row.is_catch_all_enabled,
		       domain_row.catch_all_target_mailbox_id, domain_row.verification_token,
		       COALESCE(domain_row.dns_status, 'null'::jsonb), domain_row.resend_domain_id,
		       domain_row.created_at, domain_row.updated_at,
		       creator.id, creator.username,
		       (SELECT COUNT(*)::bigint FROM inbound_messages WHERE domain_id = domain_row.id),
		       (SELECT COUNT(*)::bigint FROM outbound_messages WHERE domain_id = domain_row.id)
		FROM domains AS domain_row
		JOIN admins AS creator ON creator.id = domain_row.created_by_admin_id
		WHERE domain_row.id = $1
	`, id).Scan(
		&name, &displayName, &status, &provider, &canReceive, &canSend, &catchAll,
		&catchAllTargetID, &verificationToken, &dnsStatus, &resendDomainID,
		&createdAt, &updatedAt, &creatorID, &creatorUsername, &inboundCount, &outboundCount,
	)
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return nil, fmt.Errorf("get domain: %w", err)
	}
	mailboxes, err := s.listManagedDomainDetailMailboxes(ctx, id)
	if err != nil {
		return nil, err
	}
	sendingConfigs, err := s.listManagedDomainSendingConfigs(ctx, id)
	if err != nil {
		return nil, err
	}
	dnsView := parseManagedDomainDNSStatus(dnsStatus)
	return map[string]any{
		"id": id, "name": name, "displayName": nullableStringValue(displayName),
		"status": status, "provider": provider, "canReceive": canReceive, "canSend": canSend,
		"isCatchAllEnabled": catchAll, "catchAllTargetMailboxId": nullableInt64Value(catchAllTargetID),
		"verificationToken": nullableStringValue(verificationToken), "dnsStatus": safeManagedDomainDNSStatus(dnsView),
		"cloudflareValidation": managedDomainCloudflareView(dnsView),
		"resendDomainId":       nullableStringValue(resendDomainID),
		"createdAt":            formatAPITime(createdAt), "updatedAt": formatAPITime(updatedAt),
		"creator":   map[string]any{"id": creatorID, "username": creatorUsername},
		"mailboxes": mailboxes, "sendingConfigs": sendingConfigs,
		"inboundMessageCount": inboundCount, "outboundMessageCount": outboundCount,
	}, nil
}

func (s *PostgresStore) listManagedDomainDetailMailboxes(ctx context.Context, domainID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, address, local_part, status::text, can_login, is_catch_all_target
		FROM domain_mailboxes WHERE domain_id = $1 ORDER BY id ASC
	`, domainID)
	if err != nil {
		return nil, fmt.Errorf("list domain detail mailboxes: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var address, localPart, status string
		var canLogin, catchAll bool
		if err := rows.Scan(&id, &address, &localPart, &status, &canLogin, &catchAll); err != nil {
			return nil, fmt.Errorf("scan domain detail mailbox: %w", err)
		}
		result = append(result, map[string]any{"id": id, "address": address, "localPart": localPart, "status": status, "canLogin": canLogin, "isCatchAllTarget": catchAll})
	}
	return result, rows.Err()
}

func (s *PostgresStore) listManagedDomainSendingConfigs(ctx context.Context, domainID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, provider::text, from_name_default, reply_to_default, status::text, created_at, updated_at
		FROM domain_sending_configs WHERE domain_id = $1 ORDER BY id ASC
	`, domainID)
	if err != nil {
		return nil, fmt.Errorf("list domain sending configs: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var provider, status string
		var fromName, replyTo sql.NullString
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &provider, &fromName, &replyTo, &status, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan domain sending config: %w", err)
		}
		result = append(result, map[string]any{
			"id": id, "provider": provider, "fromNameDefault": nullableStringValue(fromName),
			"replyToDefault": nullableStringValue(replyTo), "status": status,
			"createdAt": formatAPITime(createdAt), "updatedAt": formatAPITime(updatedAt),
		})
	}
	return result, rows.Err()
}

func (s *PostgresStore) createManagedDomain(ctx context.Context, input managedDomainCreateInput) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin domain creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id int64
	err = tx.QueryRow(ctx, `
		INSERT INTO domains (
			name, display_name, can_receive, can_send, is_catch_all_enabled,
			verification_token, dns_status, created_by_admin_id, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, '{"provider":"CLOUDFLARE","expectedMxConfigured":false,"expectedIngressConfigured":false}'::jsonb, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, input.Name, input.DisplayName, input.CanReceive, input.CanSend, input.IsCatchAllEnabled, input.VerificationToken, input.CreatedByAdminID).Scan(&id)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return nil, managementConflict("DOMAIN_EXISTS", err)
		}
		return nil, fmt.Errorf("create domain: %w", err)
	}
	if input.CanSend {
		if _, err := tx.Exec(ctx, `
			UPDATE domains
			SET send_approved = TRUE, send_approved_at = CURRENT_TIMESTAMP,
			    send_approval_source = 'super-admin-create', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, id); err != nil {
			return nil, fmt.Errorf("approve domain sending: %w", err)
		}
	}
	row, err := scanManagedDomainSummary(tx.QueryRow(ctx, managedDomainSummarySelect+` WHERE domain_row.id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("load created domain: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain creation: %w", err)
	}
	return managedDomainSummaryMap(row), nil
}

func (s *PostgresStore) updateManagedDomain(ctx context.Context, id int64, input managedDomainUpdateInput) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin domain update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var sendApproved bool
	if err := tx.QueryRow(ctx, `SELECT send_approved FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&sendApproved); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return nil, fmt.Errorf("lock domain: %w", err)
	}
	if input.CanSend != nil && *input.CanSend && !sendApproved && !input.CanApproveSend {
		return nil, &requestError{Status: http.StatusForbidden, Code: "DOMAIN_SEND_APPROVAL_REQUIRED"}
	}
	_, err = tx.Exec(ctx, `
		UPDATE domains
		SET display_name = CASE WHEN $2 THEN $3::varchar ELSE display_name END,
		    status = CASE WHEN $4 THEN $5::"DomainStatus" ELSE status END,
		    can_receive = CASE WHEN $6 THEN $7::boolean ELSE can_receive END,
		    can_send = CASE WHEN $8 THEN $9::boolean ELSE can_send END,
		    is_catch_all_enabled = CASE WHEN $10 THEN $11::boolean ELSE is_catch_all_enabled END,
		    send_approved = CASE WHEN $8 AND $9 AND NOT send_approved THEN TRUE ELSE send_approved END,
		    send_approved_at = CASE WHEN $8 AND $9 AND NOT send_approved THEN CURRENT_TIMESTAMP ELSE send_approved_at END,
		    send_approval_source = CASE WHEN $8 AND $9 AND NOT send_approved THEN 'super-admin-update' ELSE send_approval_source END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id,
		input.DisplayNamePresent, input.DisplayName,
		input.Status != nil, input.Status,
		input.CanReceive != nil, input.CanReceive,
		input.CanSend != nil, input.CanSend,
		input.IsCatchAllEnabled != nil, input.IsCatchAllEnabled,
	)
	if err != nil {
		return nil, fmt.Errorf("update domain: %w", err)
	}
	row, err := scanManagedDomainSummary(tx.QueryRow(ctx, managedDomainSummarySelect+` WHERE domain_row.id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("load updated domain: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain update: %w", err)
	}
	return managedDomainSummaryMap(row), nil
}

func (s *PostgresStore) configureManagedDomainVerification(ctx context.Context, id int64, token string) (map[string]any, error) {
	var name string
	var updatedAt time.Time
	if err := s.pool.QueryRow(ctx, `
		UPDATE domains SET verification_token = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 RETURNING name, updated_at
	`, id, token).Scan(&name, &updatedAt); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return nil, fmt.Errorf("configure domain verification: %w", err)
	}
	return map[string]any{"id": id, "name": name, "verificationToken": token, "updatedAt": formatAPITime(updatedAt)}, nil
}

func (s *PostgresStore) configureManagedDomainCatchAll(ctx context.Context, id int64, enabled bool, targetID *int64) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin catch-all update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var name string
	if err := tx.QueryRow(ctx, `SELECT name FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&name); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return nil, fmt.Errorf("lock catch-all domain: %w", err)
	}
	if enabled {
		if targetID == nil {
			return nil, managementBadRequest("CATCH_ALL_TARGET_REQUIRED", nil)
		}
		var mailboxStatus string
		if err := tx.QueryRow(ctx, `SELECT status::text FROM domain_mailboxes WHERE id = $1 AND domain_id = $2`, *targetID, id).Scan(&mailboxStatus); err != nil {
			if errorsIsNoRows(err) {
				return nil, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
			}
			return nil, fmt.Errorf("load catch-all mailbox: %w", err)
		}
		if mailboxStatus != "ACTIVE" {
			return nil, managementBadRequest("DOMAIN_MAILBOX_DISABLED", nil)
		}
	}
	var storedTarget sql.NullInt64
	var updatedAt time.Time
	if err := tx.QueryRow(ctx, `
		UPDATE domains
		SET is_catch_all_enabled = $2,
		    catch_all_target_mailbox_id = CASE WHEN $2 THEN $3::bigint ELSE NULL END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING catch_all_target_mailbox_id, updated_at
	`, id, enabled, targetID).Scan(&storedTarget, &updatedAt); err != nil {
		return nil, fmt.Errorf("update domain catch-all: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain catch-all: %w", err)
	}
	return map[string]any{
		"id": id, "name": name, "isCatchAllEnabled": enabled,
		"catchAllTargetMailboxId": nullableInt64Value(storedTarget), "updatedAt": formatAPITime(updatedAt),
	}, nil
}

func (s *PostgresStore) saveManagedDomainSendingConfig(ctx context.Context, id int64, input managedDomainSendingConfigInput) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin sending config update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var canSend, sendApproved bool
	if err := tx.QueryRow(ctx, `SELECT can_send, send_approved FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&canSend, &sendApproved); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return nil, fmt.Errorf("load domain sending state: %w", err)
	}
	if !canSend {
		return nil, managementBadRequest("DOMAIN_SEND_DISABLED", nil)
	}
	if !sendApproved {
		return nil, managementBadRequest("DOMAIN_SEND_NOT_APPROVED", nil)
	}
	var existingID int64
	existingErr := tx.QueryRow(ctx, `SELECT id FROM domain_sending_configs WHERE domain_id = $1 AND provider::text = $2 FOR UPDATE`, id, input.Provider).Scan(&existingID)
	if existingErr != nil && !errorsIsNoRows(existingErr) {
		return nil, fmt.Errorf("load domain sending config: %w", existingErr)
	}
	if errorsIsNoRows(existingErr) && input.EncryptedAPIKey == nil {
		return nil, managementBadRequest("SEND_API_KEY_REQUIRED", nil)
	}
	var (
		configID             int64
		provider, status     string
		fromName, replyTo    sql.NullString
		createdAt, updatedAt time.Time
	)
	if existingErr == nil {
		err = tx.QueryRow(ctx, `
			UPDATE domain_sending_configs
			SET api_key_encrypted = CASE WHEN $2 THEN $3 ELSE api_key_encrypted END,
			    from_name_default = CASE WHEN $4 THEN $5::varchar ELSE from_name_default END,
			    reply_to_default = CASE WHEN $6 THEN $7::varchar ELSE reply_to_default END,
			    status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
			RETURNING id, provider::text, from_name_default, reply_to_default, status::text, created_at, updated_at
		`, existingID, input.EncryptedAPIKey != nil, input.EncryptedAPIKey,
			input.FromNamePresent, input.FromNameDefault, input.ReplyToPresent, input.ReplyToDefault,
		).Scan(&configID, &provider, &fromName, &replyTo, &status, &createdAt, &updatedAt)
	} else {
		err = tx.QueryRow(ctx, `
			INSERT INTO domain_sending_configs (
				domain_id, provider, api_key_encrypted, from_name_default, reply_to_default, status, created_at, updated_at
			) VALUES ($1, $2::"SendProvider", $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id, provider::text, from_name_default, reply_to_default, status::text, created_at, updated_at
		`, id, input.Provider, input.EncryptedAPIKey, input.FromNameDefault, input.ReplyToDefault).Scan(
			&configID, &provider, &fromName, &replyTo, &status, &createdAt, &updatedAt,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("save domain sending config: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain sending config: %w", err)
	}
	return map[string]any{
		"id": configID, "provider": provider, "fromNameDefault": nullableStringValue(fromName),
		"replyToDefault": nullableStringValue(replyTo), "status": status,
		"createdAt": formatAPITime(createdAt), "updatedAt": formatAPITime(updatedAt),
	}, nil
}

func (s *PostgresStore) listManagedDomainAliases(ctx context.Context, domainID int64, mailboxID *int64) ([]map[string]any, error) {
	if err := ensureManagedDomainExists(ctx, s.pool, domainID); err != nil {
		return nil, err
	}
	var mailboxFilter any
	if mailboxID != nil {
		mailboxFilter = *mailboxID
	}
	rows, err := s.pool.Query(ctx, `
		SELECT alias.id, alias.mailbox_id, alias.alias_local_part, alias.alias_address,
		       alias.status::text, alias.created_at, alias.updated_at,
		       mailbox.id, mailbox.address, mailbox.status::text
		FROM mailbox_aliases AS alias
		JOIN domain_mailboxes AS mailbox ON mailbox.id = alias.mailbox_id
		WHERE alias.domain_id = $1 AND ($2::bigint IS NULL OR alias.mailbox_id = $2)
		ORDER BY alias.id ASC
	`, domainID, mailboxFilter)
	if err != nil {
		return nil, fmt.Errorf("list domain aliases: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var aliasID, storedMailboxID, joinedMailboxID int64
		var localPart, address, status, mailboxAddress, mailboxStatus string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&aliasID, &storedMailboxID, &localPart, &address, &status, &createdAt, &updatedAt, &joinedMailboxID, &mailboxAddress, &mailboxStatus); err != nil {
			return nil, fmt.Errorf("scan domain alias: %w", err)
		}
		result = append(result, map[string]any{
			"id": aliasID, "mailboxId": storedMailboxID, "aliasLocalPart": localPart,
			"aliasAddress": address, "status": status,
			"createdAt": formatAPITime(createdAt), "updatedAt": formatAPITime(updatedAt),
			"mailbox": map[string]any{"id": joinedMailboxID, "address": mailboxAddress, "status": mailboxStatus},
		})
	}
	return result, rows.Err()
}

func (s *PostgresStore) createManagedDomainAlias(ctx context.Context, domainID, mailboxID int64, localPart string) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin alias creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var domainName string
	if err := tx.QueryRow(ctx, `SELECT name FROM domains WHERE id = $1`, domainID).Scan(&domainName); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return nil, fmt.Errorf("load alias domain: %w", err)
	}
	var foundMailboxID int64
	if err := tx.QueryRow(ctx, `SELECT id FROM domain_mailboxes WHERE id = $1 AND domain_id = $2`, mailboxID, domainID).Scan(&foundMailboxID); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
		}
		return nil, fmt.Errorf("load alias mailbox: %w", err)
	}
	address := localPart + "@" + domainName
	var aliasID int64
	var status string
	var createdAt, updatedAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO mailbox_aliases (mailbox_id, domain_id, alias_local_part, alias_address, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id, status::text, created_at, updated_at
	`, mailboxID, domainID, localPart, address).Scan(&aliasID, &status, &createdAt, &updatedAt); err != nil {
		if managementPGCode(err) == "23505" {
			return nil, managementConflict("MAILBOX_ALIAS_EXISTS", err)
		}
		return nil, fmt.Errorf("create domain alias: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit alias creation: %w", err)
	}
	return map[string]any{
		"id": aliasID, "mailboxId": mailboxID, "aliasLocalPart": localPart,
		"aliasAddress": address, "status": status,
		"createdAt": formatAPITime(createdAt), "updatedAt": formatAPITime(updatedAt),
	}, nil
}

func (s *PostgresStore) updateManagedDomainAlias(ctx context.Context, domainID, aliasID int64, status *string) (map[string]any, error) {
	var mailboxID int64
	var localPart, address, storedStatus string
	var updatedAt time.Time
	if err := s.pool.QueryRow(ctx, `
		UPDATE mailbox_aliases
		SET status = CASE WHEN $3 THEN $4::"Status" ELSE status END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND domain_id = $2
		RETURNING mailbox_id, alias_local_part, alias_address, status::text, updated_at
	`, aliasID, domainID, status != nil, status).Scan(&mailboxID, &localPart, &address, &storedStatus, &updatedAt); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("MAILBOX_ALIAS_NOT_FOUND")
		}
		return nil, fmt.Errorf("update domain alias: %w", err)
	}
	return map[string]any{
		"id": aliasID, "mailboxId": mailboxID, "aliasLocalPart": localPart,
		"aliasAddress": address, "status": storedStatus, "updatedAt": formatAPITime(updatedAt),
	}, nil
}

func (s *PostgresStore) deleteManagedDomainAlias(ctx context.Context, domainID, aliasID int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mailbox_aliases WHERE id = $1 AND domain_id = $2`, aliasID, domainID)
	if err != nil {
		return fmt.Errorf("delete domain alias: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return managementNotFound("MAILBOX_ALIAS_NOT_FOUND")
	}
	return nil
}

func (s *PostgresStore) deleteManagedDomain(ctx context.Context, id int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin domain deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT TRUE FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&exists); err != nil {
		if errorsIsNoRows(err) {
			return managementNotFound("DOMAIN_NOT_FOUND")
		}
		return fmt.Errorf("lock domain for deletion: %w", err)
	}
	var mailboxCount, inboundCount, outboundCount int64
	if err := tx.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)::bigint FROM domain_mailboxes WHERE domain_id = $1),
			(SELECT COUNT(*)::bigint FROM inbound_messages WHERE domain_id = $1 AND is_deleted = FALSE),
			(SELECT COUNT(*)::bigint FROM outbound_messages WHERE domain_id = $1)
	`, id).Scan(&mailboxCount, &inboundCount, &outboundCount); err != nil {
		return fmt.Errorf("count domain dependencies: %w", err)
	}
	if mailboxCount > 0 || inboundCount > 0 || outboundCount > 0 {
		return managementBadRequest("DOMAIN_NOT_EMPTY", nil)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM domains WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete domain: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit domain deletion: %w", err)
	}
	return nil
}

func ensureManagedDomainExists(ctx context.Context, querier basicQuerier, id int64) error {
	var exists bool
	if err := querier.QueryRow(ctx, `SELECT TRUE FROM domains WHERE id = $1`, id).Scan(&exists); err != nil {
		if errorsIsNoRows(err) {
			return managementNotFound("DOMAIN_NOT_FOUND")
		}
		return fmt.Errorf("load domain: %w", err)
	}
	return nil
}

func encodeManagedDomainDNSStatus(value managedDomainDNSStatus) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode domain DNS status: %w", err)
	}
	return encoded, nil
}
