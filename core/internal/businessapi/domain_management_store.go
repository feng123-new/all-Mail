package businessapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"github.com/jackc/pgx/v5"
)

var _ domainManagementStore = (*PostgresStore)(nil)

const domainSummarySelect = `
	SELECT domain_row.id,
	       domain_row.name,
	       domain_row.display_name,
	       domain_row.status::text,
	       domain_row.can_receive,
	       domain_row.can_send,
	       domain_row.is_catch_all_enabled,
	       domain_row.verification_token,
	       domain_row.resend_domain_id,
	       (SELECT COUNT(*)::bigint FROM domain_mailboxes WHERE domain_id = domain_row.id),
	       (SELECT COUNT(*)::bigint FROM inbound_messages WHERE domain_id = domain_row.id),
	       (SELECT COUNT(*)::bigint FROM domain_sending_configs WHERE domain_id = domain_row.id),
	       creator.id,
	       creator.username,
	       domain_row.created_at,
	       domain_row.updated_at
	FROM domains AS domain_row
	JOIN admins AS creator ON creator.id = domain_row.created_by_admin_id
`

func scanDomainSummary(scanner managementRowScanner) (domainSummary, error) {
	var result domainSummary
	var displayName, verificationToken, resendDomainID sql.NullString
	var createdAt, updatedAt time.Time
	err := scanner.Scan(
		&result.ID,
		&result.Name,
		&displayName,
		&result.Status,
		&result.CanReceive,
		&result.CanSend,
		&result.IsCatchAllEnabled,
		&verificationToken,
		&resendDomainID,
		&result.MailboxCount,
		&result.InboundMessageCount,
		&result.SendingConfigCount,
		&result.CreatedBy.ID,
		&result.CreatedBy.Username,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return domainSummary{}, err
	}
	result.DisplayName = nullableStringValue(displayName)
	result.VerificationToken = nullableStringValue(verificationToken)
	result.ResendDomainID = nullableStringValue(resendDomainID)
	result.CreatedAt = formatAPITime(createdAt)
	result.UpdatedAt = formatAPITime(updatedAt)
	return result, nil
}

func (s *PostgresStore) ListDomains(ctx context.Context, input domainListInput) (domainListResult, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM domains AS domain_row
		WHERE ($1 = '' OR domain_row.status::text = $1)
		  AND ($2 = '' OR domain_row.name ILIKE '%' || $2 || '%' OR COALESCE(domain_row.display_name, '') ILIKE '%' || $2 || '%')
	`, input.Status, input.Keyword).Scan(&total); err != nil {
		return domainListResult{}, fmt.Errorf("count domains: %w", err)
	}
	rows, err := s.pool.Query(ctx, domainSummarySelect+`
		WHERE ($1 = '' OR domain_row.status::text = $1)
		  AND ($2 = '' OR domain_row.name ILIKE '%' || $2 || '%' OR COALESCE(domain_row.display_name, '') ILIKE '%' || $2 || '%')
		ORDER BY domain_row.id DESC
		LIMIT $3 OFFSET $4
	`, input.Status, input.Keyword, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return domainListResult{}, fmt.Errorf("list domains: %w", err)
	}
	defer rows.Close()
	list := make([]domainSummary, 0, input.PageSize)
	for rows.Next() {
		item, err := scanDomainSummary(rows)
		if err != nil {
			return domainListResult{}, fmt.Errorf("scan domain: %w", err)
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return domainListResult{}, fmt.Errorf("iterate domains: %w", err)
	}
	return domainListResult{List: list, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *PostgresStore) GetDomain(ctx context.Context, id int64) (domainDetail, error) {
	var result domainDetail
	var displayName, verificationToken, resendDomainID sql.NullString
	var catchAllTarget sql.NullInt64
	var dnsStatus []byte
	var createdAt, updatedAt time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT domain_row.id,
		       domain_row.name,
		       domain_row.display_name,
		       domain_row.status::text,
		       domain_row.provider,
		       domain_row.can_receive,
		       domain_row.can_send,
		       domain_row.is_catch_all_enabled,
		       domain_row.catch_all_target_mailbox_id,
		       domain_row.verification_token,
		       COALESCE(domain_row.dns_status, 'null'::jsonb),
		       domain_row.resend_domain_id,
		       domain_row.created_at,
		       domain_row.updated_at,
		       creator.id,
		       creator.username,
		       (SELECT COUNT(*)::bigint FROM inbound_messages WHERE domain_id = domain_row.id),
		       (SELECT COUNT(*)::bigint FROM outbound_messages WHERE domain_id = domain_row.id)
		FROM domains AS domain_row
		JOIN admins AS creator ON creator.id = domain_row.created_by_admin_id
		WHERE domain_row.id = $1
	`, id).Scan(
		&result.ID,
		&result.Name,
		&displayName,
		&result.Status,
		&result.Provider,
		&result.CanReceive,
		&result.CanSend,
		&result.IsCatchAllEnabled,
		&catchAllTarget,
		&verificationToken,
		&dnsStatus,
		&resendDomainID,
		&createdAt,
		&updatedAt,
		&result.Creator.ID,
		&result.Creator.Username,
		&result.InboundMessageCount,
		&result.OutboundMessageCount,
	)
	if errorsIsNoRows(err) {
		return domainDetail{}, managementNotFound("DOMAIN_NOT_FOUND")
	}
	if err != nil {
		return domainDetail{}, fmt.Errorf("get domain: %w", err)
	}
	status := parseDomainDNSStatus(dnsStatus)
	result.DisplayName = nullableStringValue(displayName)
	result.CatchAllTargetMailboxID = nullableInt64Value(catchAllTarget)
	result.VerificationToken = nullableStringValue(verificationToken)
	result.DNSStatus = safeDomainDNSStatus(status)
	result.CloudflareValidation = cloudflareValidationViewForDNS(status)
	result.ResendDomainID = nullableStringValue(resendDomainID)
	result.CreatedAt = formatAPITime(createdAt)
	result.UpdatedAt = formatAPITime(updatedAt)

	mailboxes, err := s.listDomainDetailMailboxes(ctx, id)
	if err != nil {
		return domainDetail{}, err
	}
	configs, err := s.listDomainSendingConfigs(ctx, id)
	if err != nil {
		return domainDetail{}, err
	}
	result.Mailboxes = mailboxes
	result.SendingConfigs = configs
	return result, nil
}

func (s *PostgresStore) listDomainDetailMailboxes(ctx context.Context, domainID int64) ([]domainMailboxSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, address, local_part, status::text, can_login, is_catch_all_target
		FROM domain_mailboxes
		WHERE domain_id = $1
		ORDER BY id ASC
	`, domainID)
	if err != nil {
		return nil, fmt.Errorf("list domain detail mailboxes: %w", err)
	}
	defer rows.Close()
	result := make([]domainMailboxSummary, 0)
	for rows.Next() {
		var mailbox domainMailboxSummary
		if err := rows.Scan(&mailbox.ID, &mailbox.Address, &mailbox.LocalPart, &mailbox.Status, &mailbox.CanLogin, &mailbox.IsCatchAllTarget); err != nil {
			return nil, fmt.Errorf("scan domain detail mailbox: %w", err)
		}
		result = append(result, mailbox)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate domain detail mailboxes: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) listDomainSendingConfigs(ctx context.Context, domainID int64) ([]domainSendingConfig, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, provider::text, from_name_default, reply_to_default, status::text, created_at, updated_at
		FROM domain_sending_configs
		WHERE domain_id = $1
		ORDER BY id ASC
	`, domainID)
	if err != nil {
		return nil, fmt.Errorf("list domain sending configs: %w", err)
	}
	defer rows.Close()
	result := make([]domainSendingConfig, 0)
	for rows.Next() {
		config, err := scanDomainSendingConfig(rows)
		if err != nil {
			return nil, fmt.Errorf("scan domain sending config: %w", err)
		}
		result = append(result, config)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate domain sending configs: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) CreateDomain(ctx context.Context, input domainCreateInput, adminID int64, canApprove bool) (domainSummary, error) {
	if input.CanSend && !canApprove {
		return domainSummary{}, &requestError{Status: 403, Code: "DOMAIN_SEND_APPROVAL_REQUIRED"}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainSummary{}, fmt.Errorf("begin domain creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM domains WHERE name = $1)`, input.Name).Scan(&exists); err != nil {
		return domainSummary{}, fmt.Errorf("check domain name: %w", err)
	}
	if exists {
		return domainSummary{}, managementConflict("DOMAIN_EXISTS", fmt.Errorf("domain already exists"))
	}
	token, err := randomDomainVerificationToken()
	if err != nil {
		return domainSummary{}, &requestError{Status: 500, Code: "INTERNAL_ERROR", Cause: err}
	}
	provider := "CLOUDFLARE"
	configured := false
	dnsStatus, err := json.Marshal(domainDNSStatus{
		Provider: &provider, ExpectedMXConfigured: &configured, ExpectedIngressConfigured: &configured,
	})
	if err != nil {
		return domainSummary{}, fmt.Errorf("encode initial domain DNS status: %w", err)
	}
	var id int64
	err = tx.QueryRow(ctx, `
		INSERT INTO domains (
			name, display_name, can_receive, can_send, is_catch_all_enabled,
			verification_token, dns_status, created_by_admin_id, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, input.Name, input.DisplayName, input.CanReceive, input.CanSend, input.IsCatchAllEnabled,
		token, string(dnsStatus), adminID).Scan(&id)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return domainSummary{}, managementConflict("DOMAIN_EXISTS", err)
		}
		return domainSummary{}, fmt.Errorf("create domain: %w", err)
	}
	if input.CanSend {
		if err := approveDomainSending(ctx, tx, id, "super-admin-create"); err != nil {
			return domainSummary{}, err
		}
	}
	result, err := getDomainSummary(ctx, tx, id)
	if err != nil {
		return domainSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domainSummary{}, fmt.Errorf("commit domain creation: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) UpdateDomain(ctx context.Context, id int64, input domainUpdateInput, canApprove bool) (domainSummary, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainSummary{}, fmt.Errorf("begin domain update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var sendApproved bool
	if err := tx.QueryRow(ctx, `SELECT send_approved FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&sendApproved); err != nil {
		if errorsIsNoRows(err) {
			return domainSummary{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return domainSummary{}, fmt.Errorf("load domain for update: %w", err)
	}
	if input.CanSend != nil && *input.CanSend && !canApprove && !sendApproved {
		return domainSummary{}, &requestError{Status: 403, Code: "DOMAIN_SEND_APPROVAL_REQUIRED"}
	}
	_, err = tx.Exec(ctx, `
		UPDATE domains
		SET display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
		    status = COALESCE($4::"DomainStatus", status),
		    can_receive = COALESCE($5::boolean, can_receive),
		    can_send = COALESCE($6::boolean, can_send),
		    is_catch_all_enabled = COALESCE($7::boolean, is_catch_all_enabled),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, input.DisplayNamePresent, input.DisplayName, input.Status, input.CanReceive, input.CanSend, input.IsCatchAllEnabled)
	if err != nil {
		return domainSummary{}, fmt.Errorf("update domain: %w", err)
	}
	if input.CanSend != nil && *input.CanSend && !sendApproved {
		if err := approveDomainSending(ctx, tx, id, "super-admin-update"); err != nil {
			return domainSummary{}, err
		}
	}
	result, err := getDomainSummary(ctx, tx, id)
	if err != nil {
		return domainSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domainSummary{}, fmt.Errorf("commit domain update: %w", err)
	}
	return result, nil
}

type domainQueryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getDomainSummary(ctx context.Context, queryer domainQueryRower, id int64) (domainSummary, error) {
	result, err := scanDomainSummary(queryer.QueryRow(ctx, domainSummarySelect+` WHERE domain_row.id = $1`, id))
	if errorsIsNoRows(err) {
		return domainSummary{}, managementNotFound("DOMAIN_NOT_FOUND")
	}
	if err != nil {
		return domainSummary{}, fmt.Errorf("load domain summary: %w", err)
	}
	return result, nil
}

func approveDomainSending(ctx context.Context, tx pgx.Tx, id int64, source string) error {
	_, err := tx.Exec(ctx, `
		UPDATE domains
		SET send_approved = true,
		    send_approved_at = COALESCE(send_approved_at, CURRENT_TIMESTAMP),
		    send_approval_source = COALESCE(send_approval_source, $2),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, source)
	if err != nil {
		return fmt.Errorf("approve domain sending: %w", err)
	}
	return nil
}

func randomDomainVerificationToken() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate domain verification token: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

func (s *PostgresStore) ConfigureDomainVerification(ctx context.Context, id int64, requested *string) (domainVerificationResult, error) {
	token, err := resolveDomainVerificationToken(requested)
	if err != nil {
		return domainVerificationResult{}, err
	}
	var result domainVerificationResult
	var updatedAt time.Time
	err = s.pool.QueryRow(ctx, `
		UPDATE domains
		SET verification_token = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING id, name, verification_token, updated_at
	`, id, token).Scan(&result.ID, &result.Name, &result.VerificationToken, &updatedAt)
	if errorsIsNoRows(err) {
		return domainVerificationResult{}, managementNotFound("DOMAIN_NOT_FOUND")
	}
	if err != nil {
		return domainVerificationResult{}, fmt.Errorf("configure domain verification: %w", err)
	}
	result.UpdatedAt = formatAPITime(updatedAt)
	return result, nil
}

func resolveDomainVerificationToken(requested *string) (string, error) {
	if requested != nil {
		if token := strings.TrimSpace(*requested); token != "" {
			return token, nil
		}
	}
	return randomDomainVerificationToken()
}

func (s *PostgresStore) SaveDomainCloudflareConfig(ctx context.Context, id int64, input domainCloudflareConfigInput, encryptionKey string) (domainCloudflareConfigResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("begin Cloudflare config update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT COALESCE(dns_status, 'null'::jsonb) FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&raw); err != nil {
		if errorsIsNoRows(err) {
			return domainCloudflareConfigResult{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return domainCloudflareConfigResult{}, fmt.Errorf("load domain DNS status: %w", err)
	}
	status, err := saveCloudflareConfigToDomainDNS(parseDomainDNSStatus(raw), input, encryptionKey)
	if err != nil {
		return domainCloudflareConfigResult{}, err
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("encode domain DNS status: %w", err)
	}
	var updatedAt time.Time
	if err := tx.QueryRow(ctx, `
		UPDATE domains SET dns_status = $2::jsonb, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 RETURNING updated_at
	`, id, string(encoded)).Scan(&updatedAt); err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("save domain Cloudflare config: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("commit Cloudflare config update: %w", err)
	}
	return domainCloudflareConfigResult{
		ID: id, UpdatedAt: formatAPITime(updatedAt), DNSStatus: safeDomainDNSStatus(status),
		CloudflareValidation: cloudflareValidationViewForDNS(status),
	}, nil
}

func (s *PostgresStore) LoadDomainCloudflareValidation(ctx context.Context, id int64, encryptionKey string) (domainCloudflareValidationTarget, error) {
	var target domainCloudflareValidationTarget
	var raw []byte
	if err := s.pool.QueryRow(ctx, `
		SELECT name, can_receive, is_catch_all_enabled, COALESCE(dns_status, 'null'::jsonb)
		FROM domains WHERE id = $1
	`, id).Scan(&target.DomainName, &target.CanReceive, &target.IsCatchAllEnabled, &raw); err != nil {
		if errorsIsNoRows(err) {
			return domainCloudflareValidationTarget{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return domainCloudflareValidationTarget{}, fmt.Errorf("load domain Cloudflare validation target: %w", err)
	}
	status := parseDomainDNSStatus(raw)
	token, err := savedCloudflareToken(status, encryptionKey)
	if err != nil {
		return domainCloudflareValidationTarget{}, err
	}
	if token == "" {
		return domainCloudflareValidationTarget{}, managementBadRequest("CLOUDFLARE_TOKEN_REQUIRED", fmt.Errorf("Cloudflare API token is not configured"))
	}
	target.APIToken = token
	target.ConfigFingerprint = domainCloudflareConfigFingerprint(status)
	if status.Cloudflare != nil && status.Cloudflare.ZoneID != nil {
		target.ZoneID = *status.Cloudflare.ZoneID
	}
	return target, nil
}

func (s *PostgresStore) SaveDomainCloudflareValidation(ctx context.Context, id int64, expectedFingerprint string, validation domainCloudflareValidationResult) (domainCloudflareConfigResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("begin Cloudflare validation update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT COALESCE(dns_status, 'null'::jsonb) FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&raw); err != nil {
		if errorsIsNoRows(err) {
			return domainCloudflareConfigResult{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return domainCloudflareConfigResult{}, fmt.Errorf("load domain DNS status for validation: %w", err)
	}
	current := parseDomainDNSStatus(raw)
	if domainCloudflareConfigFingerprint(current) != expectedFingerprint {
		return domainCloudflareConfigResult{}, managementConflict("CLOUDFLARE_CONFIG_CHANGED", fmt.Errorf("Cloudflare credentials or zone changed during validation"))
	}
	status := mergeCloudflareValidationIntoDomainDNS(current, validation)
	encoded, err := json.Marshal(status)
	if err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("encode Cloudflare validation: %w", err)
	}
	var updatedAt time.Time
	if err := tx.QueryRow(ctx, `
		UPDATE domains SET dns_status = $2::jsonb, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 RETURNING updated_at
	`, id, string(encoded)).Scan(&updatedAt); err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("save Cloudflare validation: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domainCloudflareConfigResult{}, fmt.Errorf("commit Cloudflare validation: %w", err)
	}
	return domainCloudflareConfigResult{
		ID: id, UpdatedAt: formatAPITime(updatedAt), DNSStatus: safeDomainDNSStatus(status),
		CloudflareValidation: cloudflareValidationViewForDNS(status),
	}, nil
}

func (s *PostgresStore) ConfigureDomainCatchAll(ctx context.Context, id int64, input domainCatchAllInput) (domainCatchAllResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainCatchAllResult{}, fmt.Errorf("begin catch-all update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var domainName string
	if err := tx.QueryRow(ctx, `SELECT name FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&domainName); err != nil {
		if errorsIsNoRows(err) {
			return domainCatchAllResult{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return domainCatchAllResult{}, fmt.Errorf("load domain for catch-all: %w", err)
	}
	if input.IsCatchAllEnabled {
		if input.CatchAllTargetMailboxID == nil {
			return domainCatchAllResult{}, managementBadRequest("CATCH_ALL_TARGET_REQUIRED", fmt.Errorf("catch-all target is required"))
		}
		var mailboxDomainID int64
		var mailboxStatus string
		if err := tx.QueryRow(ctx, `SELECT domain_id, status::text FROM domain_mailboxes WHERE id = $1 FOR UPDATE`, *input.CatchAllTargetMailboxID).Scan(&mailboxDomainID, &mailboxStatus); err != nil {
			if errorsIsNoRows(err) {
				return domainCatchAllResult{}, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
			}
			return domainCatchAllResult{}, fmt.Errorf("load catch-all mailbox: %w", err)
		}
		if mailboxDomainID != id {
			return domainCatchAllResult{}, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
		}
		if mailboxStatus != "ACTIVE" {
			return domainCatchAllResult{}, managementBadRequest("DOMAIN_MAILBOX_DISABLED", fmt.Errorf("catch-all mailbox is disabled"))
		}
	}
	var result domainCatchAllResult
	var target sql.NullInt64
	var updatedAt time.Time
	err = tx.QueryRow(ctx, `
		UPDATE domains
		SET is_catch_all_enabled = $2,
		    catch_all_target_mailbox_id = CASE WHEN $2 THEN $3::integer ELSE NULL END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING id, name, is_catch_all_enabled, catch_all_target_mailbox_id, updated_at
	`, id, input.IsCatchAllEnabled, input.CatchAllTargetMailboxID).Scan(
		&result.ID, &result.Name, &result.IsCatchAllEnabled, &target, &updatedAt,
	)
	if err != nil {
		return domainCatchAllResult{}, fmt.Errorf("configure domain catch-all: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domainCatchAllResult{}, fmt.Errorf("commit catch-all update: %w", err)
	}
	result.CatchAllTargetMailboxID = nullableInt64Value(target)
	result.UpdatedAt = formatAPITime(updatedAt)
	return result, nil
}

func (s *PostgresStore) SaveDomainSendingConfig(ctx context.Context, id int64, input domainSendingConfigInput, encryptionKey string) (domainSendingConfig, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainSendingConfig{}, fmt.Errorf("begin domain sending config update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var canSend, sendApproved bool
	if err := tx.QueryRow(ctx, `SELECT can_send, send_approved FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&canSend, &sendApproved); err != nil {
		if errorsIsNoRows(err) {
			return domainSendingConfig{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return domainSendingConfig{}, fmt.Errorf("load domain sending state: %w", err)
	}
	if !canSend {
		return domainSendingConfig{}, managementBadRequest("DOMAIN_SEND_DISABLED", fmt.Errorf("domain sending is disabled"))
	}
	if !sendApproved {
		return domainSendingConfig{}, managementBadRequest("DOMAIN_SEND_NOT_APPROVED", fmt.Errorf("domain sending is not approved"))
	}
	var existingID int64
	err = tx.QueryRow(ctx, `SELECT id FROM domain_sending_configs WHERE domain_id = $1 AND provider::text = $2 LIMIT 1 FOR UPDATE`, id, input.Provider).Scan(&existingID)
	hasExisting := err == nil
	if err != nil && !errorsIsNoRows(err) {
		return domainSendingConfig{}, fmt.Errorf("load domain sending config: %w", err)
	}
	var normalizedAPIKey *string
	if input.APIKey != nil {
		if value := strings.TrimSpace(*input.APIKey); value != "" {
			normalizedAPIKey = &value
		}
	}
	hasNewAPIKey := input.APIKeyPresent && normalizedAPIKey != nil
	if !hasExisting && !hasNewAPIKey {
		return domainSendingConfig{}, managementBadRequest("SEND_API_KEY_REQUIRED", fmt.Errorf("API key is required"))
	}
	var encryptedKey *string
	if hasNewAPIKey {
		value, err := legacycrypto.Encrypt(encryptionKey, *normalizedAPIKey)
		if err != nil {
			return domainSendingConfig{}, fmt.Errorf("encrypt domain sending API key: %w", err)
		}
		encryptedKey = &value
	}
	var result domainSendingConfig
	if hasExisting {
		result, err = scanDomainSendingConfig(tx.QueryRow(ctx, `
			UPDATE domain_sending_configs
			SET api_key_encrypted = CASE WHEN $2::boolean THEN $3 ELSE api_key_encrypted END,
			    from_name_default = CASE WHEN $4::boolean THEN $5 ELSE from_name_default END,
			    reply_to_default = CASE WHEN $6::boolean THEN $7 ELSE reply_to_default END,
			    status = 'ACTIVE',
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
			RETURNING id, provider::text, from_name_default, reply_to_default, status::text, created_at, updated_at
		`, existingID, hasNewAPIKey, encryptedKey, input.FromNamePresent, input.FromNameDefault, input.ReplyToPresent, input.ReplyToDefault))
	} else {
		result, err = scanDomainSendingConfig(tx.QueryRow(ctx, `
			INSERT INTO domain_sending_configs (
				domain_id, provider, api_key_encrypted, from_name_default, reply_to_default, status, created_at, updated_at
			)
			VALUES ($1, $2::"SendProvider", $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id, provider::text, from_name_default, reply_to_default, status::text, created_at, updated_at
		`, id, input.Provider, encryptedKey, input.FromNameDefault, input.ReplyToDefault))
	}
	if err != nil {
		return domainSendingConfig{}, fmt.Errorf("save domain sending config: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domainSendingConfig{}, fmt.Errorf("commit domain sending config: %w", err)
	}
	return result, nil
}

func scanDomainSendingConfig(scanner managementRowScanner) (domainSendingConfig, error) {
	var result domainSendingConfig
	var fromName, replyTo sql.NullString
	var createdAt, updatedAt time.Time
	if err := scanner.Scan(&result.ID, &result.Provider, &fromName, &replyTo, &result.Status, &createdAt, &updatedAt); err != nil {
		return domainSendingConfig{}, err
	}
	result.FromNameDefault = nullableStringValue(fromName)
	result.ReplyToDefault = nullableStringValue(replyTo)
	result.CreatedAt = formatAPITime(createdAt)
	result.UpdatedAt = formatAPITime(updatedAt)
	return result, nil
}

func (s *PostgresStore) ListDomainAliases(ctx context.Context, id int64, mailboxID *int64) ([]domainAlias, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM domains WHERE id = $1)`, id).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check domain for aliases: %w", err)
	}
	if !exists {
		return nil, managementNotFound("DOMAIN_NOT_FOUND")
	}
	var mailboxFilter any
	if mailboxID != nil {
		mailboxFilter = *mailboxID
	}
	rows, err := s.pool.Query(ctx, `
		SELECT alias_row.id,
		       alias_row.mailbox_id,
		       alias_row.alias_local_part,
		       alias_row.alias_address,
		       alias_row.status::text,
		       alias_row.created_at,
		       alias_row.updated_at,
		       mailbox.id,
		       mailbox.address,
		       mailbox.status::text
		FROM mailbox_aliases AS alias_row
		JOIN domain_mailboxes AS mailbox ON mailbox.id = alias_row.mailbox_id
		WHERE alias_row.domain_id = $1
		  AND ($2::bigint IS NULL OR alias_row.mailbox_id = $2)
		ORDER BY alias_row.id ASC
	`, id, mailboxFilter)
	if err != nil {
		return nil, fmt.Errorf("list domain aliases: %w", err)
	}
	defer rows.Close()
	result := make([]domainAlias, 0)
	for rows.Next() {
		var alias domainAlias
		var createdAt, updatedAt time.Time
		mailbox := &domainAliasMailbox{}
		if err := rows.Scan(
			&alias.ID, &alias.MailboxID, &alias.AliasLocalPart, &alias.AliasAddress, &alias.Status,
			&createdAt, &updatedAt, &mailbox.ID, &mailbox.Address, &mailbox.Status,
		); err != nil {
			return nil, fmt.Errorf("scan domain alias: %w", err)
		}
		alias.CreatedAt = formatAPITime(createdAt)
		alias.UpdatedAt = formatAPITime(updatedAt)
		alias.Mailbox = mailbox
		result = append(result, alias)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate domain aliases: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) CreateDomainAlias(ctx context.Context, id int64, input domainAliasCreateInput) (domainAlias, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainAlias{}, fmt.Errorf("begin domain alias creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var domainName string
	if err := tx.QueryRow(ctx, `SELECT name FROM domains WHERE id = $1`, id).Scan(&domainName); err != nil {
		if errorsIsNoRows(err) {
			return domainAlias{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return domainAlias{}, fmt.Errorf("load domain for alias: %w", err)
	}
	var mailboxDomainID int64
	if err := tx.QueryRow(ctx, `SELECT domain_id FROM domain_mailboxes WHERE id = $1`, input.MailboxID).Scan(&mailboxDomainID); err != nil {
		if errorsIsNoRows(err) {
			return domainAlias{}, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
		}
		return domainAlias{}, fmt.Errorf("load alias mailbox: %w", err)
	}
	if mailboxDomainID != id {
		return domainAlias{}, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
	}
	localPart := strings.ToLower(strings.TrimSpace(input.AliasLocalPart))
	address := localPart + "@" + domainName
	var result domainAlias
	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO mailbox_aliases (
			mailbox_id, domain_id, alias_local_part, alias_address, status, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id, mailbox_id, alias_local_part, alias_address, status::text, created_at, updated_at
	`, input.MailboxID, id, localPart, address).Scan(
		&result.ID, &result.MailboxID, &result.AliasLocalPart, &result.AliasAddress, &result.Status, &createdAt, &updatedAt,
	)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return domainAlias{}, managementConflict("MAILBOX_ALIAS_EXISTS", err)
		}
		return domainAlias{}, fmt.Errorf("create domain alias: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domainAlias{}, fmt.Errorf("commit domain alias creation: %w", err)
	}
	result.CreatedAt = formatAPITime(createdAt)
	result.UpdatedAt = formatAPITime(updatedAt)
	return result, nil
}

func (s *PostgresStore) UpdateDomainAlias(ctx context.Context, id, aliasID int64, status *string) (domainAlias, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainAlias{}, fmt.Errorf("begin domain alias update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var aliasDomainID int64
	if err := tx.QueryRow(ctx, `SELECT domain_id FROM mailbox_aliases WHERE id = $1 FOR UPDATE`, aliasID).Scan(&aliasDomainID); err != nil {
		if errorsIsNoRows(err) {
			return domainAlias{}, managementNotFound("MAILBOX_ALIAS_NOT_FOUND")
		}
		return domainAlias{}, fmt.Errorf("load domain alias: %w", err)
	}
	if aliasDomainID != id {
		return domainAlias{}, managementNotFound("MAILBOX_ALIAS_NOT_FOUND")
	}
	var result domainAlias
	var updatedAt time.Time
	if err := tx.QueryRow(ctx, `
		UPDATE mailbox_aliases
		SET status = COALESCE($2::"Status", status), updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING id, mailbox_id, alias_local_part, alias_address, status::text, updated_at
	`, aliasID, status).Scan(
		&result.ID, &result.MailboxID, &result.AliasLocalPart, &result.AliasAddress, &result.Status, &updatedAt,
	); err != nil {
		return domainAlias{}, fmt.Errorf("update domain alias: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domainAlias{}, fmt.Errorf("commit domain alias update: %w", err)
	}
	result.UpdatedAt = formatAPITime(updatedAt)
	return result, nil
}

func (s *PostgresStore) DeleteDomainAlias(ctx context.Context, id, aliasID int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin domain alias deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var aliasDomainID int64
	if err := tx.QueryRow(ctx, `SELECT domain_id FROM mailbox_aliases WHERE id = $1 FOR UPDATE`, aliasID).Scan(&aliasDomainID); err != nil {
		if errorsIsNoRows(err) {
			return managementNotFound("MAILBOX_ALIAS_NOT_FOUND")
		}
		return fmt.Errorf("load domain alias for deletion: %w", err)
	}
	if aliasDomainID != id {
		return managementNotFound("MAILBOX_ALIAS_NOT_FOUND")
	}
	if _, err := tx.Exec(ctx, `DELETE FROM mailbox_aliases WHERE id = $1`, aliasID); err != nil {
		return fmt.Errorf("delete domain alias: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit domain alias deletion: %w", err)
	}
	return nil
}

func (s *PostgresStore) DeleteDomain(ctx context.Context, id int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin domain deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var lockedID int64
	if err := tx.QueryRow(ctx, `SELECT id FROM domains WHERE id = $1 FOR UPDATE`, id).Scan(&lockedID); err != nil {
		if errorsIsNoRows(err) {
			return managementNotFound("DOMAIN_NOT_FOUND")
		}
		return fmt.Errorf("load domain for deletion: %w", err)
	}
	var mailboxCount, inboundCount, outboundCount int64
	if err := tx.QueryRow(ctx, `
		SELECT (SELECT COUNT(*)::bigint FROM domain_mailboxes WHERE domain_id = $1),
		       (SELECT COUNT(*)::bigint FROM inbound_messages WHERE domain_id = $1 AND is_deleted = FALSE),
		       (SELECT COUNT(*)::bigint FROM outbound_messages WHERE domain_id = $1)
	`, id).Scan(&mailboxCount, &inboundCount, &outboundCount); err != nil {
		return fmt.Errorf("count domain deletion blockers: %w", err)
	}
	if mailboxCount > 0 || inboundCount > 0 || outboundCount > 0 {
		return managementBadRequest("DOMAIN_NOT_EMPTY", fmt.Errorf("domain has mailboxes or message history"))
	}
	if _, err := tx.Exec(ctx, `DELETE FROM domains WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete domain: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit domain deletion: %w", err)
	}
	return nil
}
