package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type managementRowScanner interface {
	Scan(...any) error
}

type managedDomainMailboxRow struct {
	ID                   int64
	DomainID             int64
	LocalPart            string
	Address              string
	DisplayName          sql.NullString
	Status               string
	ProvisioningMode     string
	BatchTag             sql.NullString
	QuotaMB              sql.NullInt64
	CanLogin             bool
	IsCatchAllTarget     bool
	OwnerUserID          sql.NullInt64
	ForwardMode          string
	ForwardTo            sql.NullString
	Metadata             []byte
	CreatedAt            time.Time
	UpdatedAt            time.Time
	DomainName           string
	DomainStatus         string
	DomainCanSend        bool
	DomainCanReceive     bool
	OwnerUsername        sql.NullString
	OwnerEmail           sql.NullString
	InboundMessageCount  int64
	OutboundMessageCount int64
	APIUsageCount        int64
}

func scanManagedDomainMailbox(scanner managementRowScanner) (managedDomainMailboxRow, error) {
	var row managedDomainMailboxRow
	err := scanner.Scan(
		&row.ID,
		&row.DomainID,
		&row.LocalPart,
		&row.Address,
		&row.DisplayName,
		&row.Status,
		&row.ProvisioningMode,
		&row.BatchTag,
		&row.QuotaMB,
		&row.CanLogin,
		&row.IsCatchAllTarget,
		&row.OwnerUserID,
		&row.ForwardMode,
		&row.ForwardTo,
		&row.Metadata,
		&row.CreatedAt,
		&row.UpdatedAt,
		&row.DomainName,
		&row.DomainStatus,
		&row.DomainCanSend,
		&row.DomainCanReceive,
		&row.OwnerUsername,
		&row.OwnerEmail,
		&row.InboundMessageCount,
		&row.OutboundMessageCount,
		&row.APIUsageCount,
	)
	return row, err
}

const managedDomainMailboxSelect = `
	SELECT mailbox.id,
	       mailbox.domain_id,
	       mailbox.local_part,
	       mailbox.address,
	       mailbox.display_name,
	       mailbox.status::text,
	       mailbox.provisioning_mode::text,
	       mailbox.batch_tag,
	       mailbox.quota_mb,
	       mailbox.can_login,
	       mailbox.is_catch_all_target,
	       mailbox.owner_user_id,
	       mailbox.forward_mode::text,
	       mailbox.forward_to,
	       COALESCE(mailbox.metadata, '{}'::jsonb),
	       mailbox.created_at,
	       mailbox.updated_at,
	       domain_row.name,
	       domain_row.status::text,
	       domain_row.can_send,
	       domain_row.can_receive,
	       owner_user.username,
	       owner_user.email,
	       (SELECT COUNT(*)::bigint FROM inbound_messages WHERE mailbox_id = mailbox.id),
	       (SELECT COUNT(*)::bigint FROM outbound_messages WHERE mailbox_id = mailbox.id),
	       (SELECT COUNT(*)::bigint FROM domain_mailbox_usage WHERE domain_mailbox_id = mailbox.id)
	FROM domain_mailboxes AS mailbox
	JOIN domains AS domain_row ON domain_row.id = mailbox.domain_id
	LEFT JOIN mailbox_users AS owner_user ON owner_user.id = mailbox.owner_user_id
`

func managedDomainMailboxMap(row managedDomainMailboxRow) map[string]any {
	result := map[string]any{
		"id":                   row.ID,
		"domainId":             row.DomainID,
		"localPart":            row.LocalPart,
		"address":              row.Address,
		"displayName":          nullableStringValue(row.DisplayName),
		"status":               row.Status,
		"provisioningMode":     row.ProvisioningMode,
		"batchTag":             nullableStringValue(row.BatchTag),
		"quotaMb":              nullableInt64Value(row.QuotaMB),
		"canLogin":             row.CanLogin,
		"isCatchAllTarget":     row.IsCatchAllTarget,
		"ownerUserId":          nullableInt64Value(row.OwnerUserID),
		"forwardMode":          row.ForwardMode,
		"forwardTo":            nullableStringValue(row.ForwardTo),
		"metadata":             json.RawMessage(row.Metadata),
		"createdAt":            formatAPITime(row.CreatedAt),
		"updatedAt":            formatAPITime(row.UpdatedAt),
		"inboundMessageCount":  row.InboundMessageCount,
		"outboundMessageCount": row.OutboundMessageCount,
		"apiUsageCount":        row.APIUsageCount,
		"domain": map[string]any{
			"id": row.DomainID, "name": row.DomainName, "status": row.DomainStatus,
			"canSend": row.DomainCanSend, "canReceive": row.DomainCanReceive,
		},
	}
	if row.OwnerUserID.Valid {
		result["ownerUser"] = map[string]any{
			"id":       row.OwnerUserID.Int64,
			"username": row.OwnerUsername.String,
			"email":    nullableStringValue(row.OwnerEmail),
		}
	} else {
		result["ownerUser"] = nil
	}
	for key, value := range hostedInternalProtocolSummary(row.ProvisioningMode, row.DomainCanSend, row.DomainCanReceive) {
		result[key] = value
	}
	return result
}

func hostedInternalProtocolSummary(mode string, canSend, canReceive bool) map[string]any {
	profile := "hosted-internal-manual"
	hint := "Hosted Internal · MANUAL：适合人工维护或门户运营的站内邮箱，由内部域名收件链路统一承载。"
	if mode == "API_POOL" {
		profile = "hosted-internal-api-pool"
		hint = "Hosted Internal · API_POOL：适合 API 池自动分配的站内邮箱，由内部域名收件链路统一承载。"
	}
	return map[string]any{
		"providerProfile":        profile,
		"representativeProtocol": "hosted_internal",
		"secondaryProtocols":     []string{},
		"profileSummaryHint":     hint,
		"capabilitySummary": map[string]any{
			"readInbox":    canReceive,
			"readJunk":     false,
			"readSent":     false,
			"clearMailbox": true,
			"sendMail":     canSend,
			"usesOAuth":    false,
			"receiveMail":  canReceive,
			"apiAccess":    mode == "API_POOL",
			"forwarding":   true,
			"search":       false,
			"refreshToken": false,
			"webhook":      false,
			"aliasSupport": false,
			"modes":        []string{},
		},
	}
}

func (s *PostgresStore) listManagedDomainMailboxes(
	ctx context.Context,
	page, pageSize int,
	domainID *int64,
	keyword, status, batchTag, mode string,
) (map[string]any, error) {
	var domainFilter any
	if domainID != nil {
		domainFilter = *domainID
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM domain_mailboxes AS mailbox
		WHERE ($1::bigint IS NULL OR mailbox.domain_id = $1)
		  AND ($2 = '' OR mailbox.status::text = $2)
		  AND ($3 = '' OR mailbox.batch_tag = $3)
		  AND ($4 = '' OR mailbox.provisioning_mode::text = $4)
		  AND ($5 = '' OR mailbox.address ILIKE '%' || $5 || '%' OR COALESCE(mailbox.display_name, '') ILIKE '%' || $5 || '%' OR mailbox.local_part ILIKE '%' || $5 || '%' OR COALESCE(mailbox.batch_tag, '') ILIKE '%' || $5 || '%')
	`, domainFilter, status, batchTag, mode, keyword).Scan(&total); err != nil {
		return nil, fmt.Errorf("count domain mailboxes: %w", err)
	}
	query := managedDomainMailboxSelect + `
		WHERE ($1::bigint IS NULL OR mailbox.domain_id = $1)
		  AND ($2 = '' OR mailbox.status::text = $2)
		  AND ($3 = '' OR mailbox.batch_tag = $3)
		  AND ($4 = '' OR mailbox.provisioning_mode::text = $4)
		  AND ($5 = '' OR mailbox.address ILIKE '%' || $5 || '%' OR COALESCE(mailbox.display_name, '') ILIKE '%' || $5 || '%' OR mailbox.local_part ILIKE '%' || $5 || '%' OR COALESCE(mailbox.batch_tag, '') ILIKE '%' || $5 || '%')
		ORDER BY mailbox.domain_id ASC, mailbox.id DESC
		LIMIT $6 OFFSET $7
	`
	rows, err := s.pool.Query(ctx, query, domainFilter, status, batchTag, mode, keyword, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list domain mailboxes: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		row, err := scanManagedDomainMailbox(rows)
		if err != nil {
			return nil, fmt.Errorf("scan domain mailbox: %w", err)
		}
		list = append(list, managedDomainMailboxMap(row))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate domain mailboxes: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (s *PostgresStore) getManagedDomainMailbox(ctx context.Context, id int64) (map[string]any, error) {
	row, err := scanManagedDomainMailbox(s.pool.QueryRow(ctx, managedDomainMailboxSelect+` WHERE mailbox.id = $1`, id))
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
		}
		return nil, fmt.Errorf("get domain mailbox: %w", err)
	}
	result := managedDomainMailboxMap(row)
	memberships, err := s.listManagedMailboxMemberships(ctx, id)
	if err != nil {
		return nil, err
	}
	aliases, err := s.listManagedMailboxAliases(ctx, id)
	if err != nil {
		return nil, err
	}
	result["memberships"] = memberships
	result["aliases"] = aliases
	return result, nil
}

func (s *PostgresStore) listManagedMailboxMemberships(ctx context.Context, mailboxID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT membership.id, membership.role::text, user_row.id, user_row.username, user_row.email, user_row.status::text
		FROM mailbox_memberships AS membership
		JOIN mailbox_users AS user_row ON user_row.id = membership.user_id
		WHERE membership.mailbox_id = $1
		ORDER BY membership.id ASC
	`, mailboxID)
	if err != nil {
		return nil, fmt.Errorf("list mailbox memberships: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var membershipID, userID int64
		var role, username, status string
		var email sql.NullString
		if err := rows.Scan(&membershipID, &role, &userID, &username, &email, &status); err != nil {
			return nil, fmt.Errorf("scan mailbox membership: %w", err)
		}
		result = append(result, map[string]any{
			"id":   membershipID,
			"role": role,
			"user": map[string]any{"id": userID, "username": username, "email": nullableStringValue(email), "status": status},
		})
	}
	return result, rows.Err()
}

func (s *PostgresStore) listManagedMailboxAliases(ctx context.Context, mailboxID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, alias_local_part, alias_address, status::text
		FROM mailbox_aliases WHERE mailbox_id = $1 ORDER BY id ASC
	`, mailboxID)
	if err != nil {
		return nil, fmt.Errorf("list mailbox aliases: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var localPart, address, status string
		if err := rows.Scan(&id, &localPart, &address, &status); err != nil {
			return nil, fmt.Errorf("scan mailbox alias: %w", err)
		}
		result = append(result, map[string]any{"id": id, "aliasLocalPart": localPart, "aliasAddress": address, "status": status})
	}
	return result, rows.Err()
}

func (s *PostgresStore) createManagedDomainMailbox(ctx context.Context, input managedDomainMailboxCreateInput) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin domain mailbox creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	domainName, _, _, err := loadManagedDomainForMailbox(ctx, tx, input.DomainID)
	if err != nil {
		return nil, err
	}
	if err := ensureManagedMailboxUsers(ctx, tx, appendOwnerID(input.MemberUserIDs, input.OwnerUserID)); err != nil {
		return nil, err
	}
	address := input.LocalPart + "@" + strings.ToLower(domainName)
	metadata, err := managedMailboxMetadata(input.ProvisioningMode, input.BatchTag)
	if err != nil {
		return nil, err
	}
	var id int64
	err = tx.QueryRow(ctx, `
		INSERT INTO domain_mailboxes (
			domain_id, local_part, address, display_name, status, provisioning_mode, batch_tag,
			quota_mb, password_hash, can_login, owner_user_id, forward_mode, forward_to, metadata,
			created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, 'ACTIVE', $5::"DomainMailboxProvisioningMode", $6,
		        $7, $8, $9, $10, $11::"ForwardMode", $12, $13::jsonb,
		        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, input.DomainID, input.LocalPart, address, input.DisplayName, input.ProvisioningMode, input.BatchTag,
		input.QuotaMB, input.PasswordHash, input.CanLogin, input.OwnerUserID, input.ForwardMode, input.ForwardTo, string(metadata)).Scan(&id)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return nil, managementConflict("DOMAIN_MAILBOX_EXISTS", err)
		}
		return nil, fmt.Errorf("create domain mailbox: %w", err)
	}
	if err := replaceManagedMailboxMemberships(ctx, tx, id, input.MemberUserIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain mailbox creation: %w", err)
	}
	return s.getManagedDomainMailbox(ctx, id)
}

func (s *PostgresStore) batchCreateManagedDomainMailboxes(ctx context.Context, input managedDomainMailboxBatchCreateInput) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin domain mailbox batch creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	domainName, canSend, canReceive, err := loadManagedDomainForMailbox(ctx, tx, input.DomainID)
	if err != nil {
		return nil, err
	}
	if input.BatchTag == nil {
		value := defaultBatchTag(domainName, time.Now())
		input.BatchTag = &value
	}
	if err := ensureManagedMailboxUsers(ctx, tx, appendOwnerID(input.MemberUserIDs, input.OwnerUserID)); err != nil {
		return nil, err
	}
	if err := ensureManagedAPIKeys(ctx, tx, input.BindAPIKeyIDs); err != nil {
		return nil, err
	}
	addresses := make([]string, len(input.LocalParts))
	for index, localPart := range input.LocalParts {
		addresses[index] = localPart + "@" + strings.ToLower(domainName)
	}
	var existing []string
	rows, err := tx.Query(ctx, `SELECT address FROM domain_mailboxes WHERE domain_id = $1 AND address = ANY($2::text[]) ORDER BY address`, input.DomainID, addresses)
	if err != nil {
		return nil, fmt.Errorf("check existing domain mailboxes: %w", err)
	}
	for rows.Next() {
		var address string
		if err := rows.Scan(&address); err != nil {
			rows.Close()
			return nil, err
		}
		existing = append(existing, address)
	}
	rows.Close()
	if len(existing) > 0 {
		return nil, managementConflict("DOMAIN_MAILBOX_EXISTS", fmt.Errorf("mailboxes already exist: %s", strings.Join(existing, ", ")))
	}
	metadata, err := managedMailboxMetadata(input.ProvisioningMode, input.BatchTag)
	if err != nil {
		return nil, err
	}
	createdIDs := make([]int64, 0, len(input.LocalParts))
	created := make([]map[string]any, 0, len(input.LocalParts))
	for index, localPart := range input.LocalParts {
		var id int64
		err := tx.QueryRow(ctx, `
			INSERT INTO domain_mailboxes (
				domain_id, local_part, address, display_name, status, provisioning_mode, batch_tag,
				quota_mb, password_hash, can_login, owner_user_id, forward_mode, forward_to, metadata,
				created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, 'ACTIVE', $5::"DomainMailboxProvisioningMode", $6,
			        $7, $8, $9, $10, $11::"ForwardMode", $12, $13::jsonb,
			        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id
		`, input.DomainID, localPart, addresses[index], input.DisplayName, input.ProvisioningMode, input.BatchTag,
			input.QuotaMB, input.PasswordHash, input.CanLogin, input.OwnerUserID, input.ForwardMode, input.ForwardTo, string(metadata)).Scan(&id)
		if err != nil {
			if managementPGCode(err) == "23505" {
				return nil, managementConflict("DOMAIN_MAILBOX_EXISTS", err)
			}
			return nil, fmt.Errorf("create batch domain mailbox: %w", err)
		}
		if err := replaceManagedMailboxMemberships(ctx, tx, id, input.MemberUserIDs); err != nil {
			return nil, err
		}
		createdIDs = append(createdIDs, id)
		item := map[string]any{
			"id": id, "domainId": input.DomainID, "localPart": localPart, "address": addresses[index],
			"displayName": input.DisplayName, "status": "ACTIVE", "provisioningMode": input.ProvisioningMode,
			"batchTag": input.BatchTag, "canLogin": input.CanLogin, "createdAt": formatAPITime(time.Now()),
			"domain": map[string]any{"id": input.DomainID, "name": domainName, "canSend": canSend, "canReceive": canReceive},
		}
		for key, value := range hostedInternalProtocolSummary(input.ProvisioningMode, canSend, canReceive) {
			item[key] = value
		}
		created = append(created, item)
	}
	if err := appendManagedAllowedDomainIDs(ctx, tx, input.BindAPIKeyIDs, input.DomainID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain mailbox batch creation: %w", err)
	}
	_ = createdIDs
	return map[string]any{
		"success":          true,
		"createdCount":     len(created),
		"batchTag":         input.BatchTag,
		"provisioningMode": input.ProvisioningMode,
		"domainId":         input.DomainID,
		"boundApiKeyIds":   input.BindAPIKeyIDs,
		"mailboxes":        created,
	}, nil
}

func (s *PostgresStore) updateManagedDomainMailbox(ctx context.Context, id int64, input managedDomainMailboxUpdateInput) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin domain mailbox update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var displayName, batchTag, passwordHash, forwardTo sql.NullString
	var quotaMB, ownerUserID sql.NullInt64
	var status, provisioningMode, forwardMode string
	var canLogin bool
	var metadata []byte
	err = tx.QueryRow(ctx, `
		SELECT display_name, status::text, can_login, provisioning_mode::text, batch_tag, quota_mb,
		       password_hash, owner_user_id, forward_mode::text, forward_to, COALESCE(metadata, '{}'::jsonb)
		FROM domain_mailboxes WHERE id = $1 FOR UPDATE
	`, id).Scan(&displayName, &status, &canLogin, &provisioningMode, &batchTag, &quotaMB, &passwordHash, &ownerUserID, &forwardMode, &forwardTo, &metadata)
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
		}
		return nil, fmt.Errorf("load domain mailbox: %w", err)
	}
	if input.DisplayNamePresent {
		displayName = nullableSQLString(input.DisplayName)
	}
	if input.Status != nil {
		status = *input.Status
	}
	if input.CanLogin != nil {
		canLogin = *input.CanLogin
	}
	metadataChanged := false
	if input.ProvisioningMode != nil {
		provisioningMode = *input.ProvisioningMode
		metadataChanged = true
	}
	if input.BatchTagPresent {
		batchTag = nullableSQLString(input.BatchTag)
		metadataChanged = true
	}
	if input.QuotaMBPresent {
		quotaMB = nullableSQLInt64(input.QuotaMB)
	}
	if input.PasswordPresent {
		passwordHash = nullableSQLString(input.PasswordHash)
	}
	if input.OwnerUserIDPresent {
		ownerUserID = nullableSQLInt64(input.OwnerUserID)
	}
	if input.ForwardMode != nil {
		forwardMode = *input.ForwardMode
	}
	if input.ForwardToPresent {
		forwardTo = nullableSQLString(input.ForwardTo)
	}
	if forwardMode == "DISABLED" {
		forwardTo = sql.NullString{}
	} else if !forwardTo.Valid {
		return nil, managementBadRequest("FORWARD_TARGET_REQUIRED", fmt.Errorf("forward target is required"))
	}
	if ownerUserID.Valid {
		value := ownerUserID.Int64
		if err := ensureManagedMailboxUsers(ctx, tx, []int64{value}); err != nil {
			return nil, err
		}
	}
	if input.MemberUserIDsPresent {
		if err := ensureManagedMailboxUsers(ctx, tx, input.MemberUserIDs); err != nil {
			return nil, err
		}
	}
	if metadataChanged {
		metadata, err = mergeManagedMailboxMetadata(metadata, provisioningMode, nullableStringValue(batchTag))
		if err != nil {
			return nil, err
		}
	}
	_, err = tx.Exec(ctx, `
		UPDATE domain_mailboxes
		SET display_name = $2,
		    status = $3::"DomainMailboxStatus",
		    can_login = $4,
		    provisioning_mode = $5::"DomainMailboxProvisioningMode",
		    batch_tag = $6,
		    quota_mb = $7,
		    password_hash = $8,
		    owner_user_id = $9,
		    forward_mode = $10::"ForwardMode",
		    forward_to = $11,
		    metadata = $12::jsonb,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, nullableAnyString(displayName), status, canLogin, provisioningMode, nullableAnyString(batchTag),
		nullableAnyInt64(quotaMB), nullableAnyString(passwordHash), nullableAnyInt64(ownerUserID), forwardMode,
		nullableAnyString(forwardTo), string(metadata))
	if err != nil {
		return nil, fmt.Errorf("update domain mailbox: %w", err)
	}
	if input.MemberUserIDsPresent {
		if err := replaceManagedMailboxMemberships(ctx, tx, id, input.MemberUserIDs); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain mailbox update: %w", err)
	}
	return s.getManagedDomainMailbox(ctx, id)
}

func (s *PostgresStore) batchDeleteManagedDomainMailboxes(ctx context.Context, input managedDomainMailboxBatchDeleteInput) (map[string]any, error) {
	var domainFilter any
	if input.DomainID != nil {
		domainFilter = *input.DomainID
	}
	var tagFilter any
	if input.BatchTag != nil {
		tagFilter = *input.BatchTag
	}
	var modeFilter any
	if input.ProvisioningMode != nil {
		modeFilter = *input.ProvisioningMode
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, address
		FROM domain_mailboxes
		WHERE (COALESCE(cardinality($1::bigint[]), 0) = 0 OR id = ANY($1::bigint[]))
		  AND ($2::bigint IS NULL OR domain_id = $2)
		  AND ($3::text IS NULL OR batch_tag = $3)
		  AND ($4::text IS NULL OR provisioning_mode::text = $4)
		ORDER BY domain_id ASC, id ASC
	`, input.IDs, domainFilter, tagFilter, modeFilter)
	if err != nil {
		return nil, fmt.Errorf("find batch domain mailboxes: %w", err)
	}
	ids := make([]int64, 0)
	addresses := make([]string, 0)
	for rows.Next() {
		var id int64
		var address string
		if err := rows.Scan(&id, &address); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
		addresses = append(addresses, address)
	}
	rows.Close()
	if len(ids) == 0 {
		return nil, managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin domain mailbox batch deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE domains
		SET catch_all_target_mailbox_id = NULL, is_catch_all_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
		WHERE catch_all_target_mailbox_id = ANY($1::bigint[])
	`, ids); err != nil {
		return nil, fmt.Errorf("clear domain catch-all targets: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM domain_mailboxes WHERE id = ANY($1::bigint[])`, ids); err != nil {
		return nil, fmt.Errorf("delete domain mailboxes: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain mailbox batch deletion: %w", err)
	}
	return map[string]any{"success": true, "deletedCount": len(ids), "deletedIds": ids, "deletedAddresses": addresses}, nil
}

func (s *PostgresStore) deleteManagedDomainMailbox(ctx context.Context, id int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin domain mailbox deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM domain_mailboxes WHERE id = $1)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("check domain mailbox: %w", err)
	}
	if !exists {
		return managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE domains
		SET catch_all_target_mailbox_id = NULL, is_catch_all_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
		WHERE catch_all_target_mailbox_id = $1
	`, id); err != nil {
		return fmt.Errorf("clear domain catch-all target: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM domain_mailboxes WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete domain mailbox: %w", err)
	}
	return tx.Commit(ctx)
}

func loadManagedDomainForMailbox(ctx context.Context, tx pgx.Tx, domainID int64) (string, bool, bool, error) {
	var name string
	var canSend, canReceive bool
	if err := tx.QueryRow(ctx, `SELECT name, can_send, can_receive FROM domains WHERE id = $1`, domainID).Scan(&name, &canSend, &canReceive); err != nil {
		if errorsIsNoRows(err) {
			return "", false, false, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return "", false, false, fmt.Errorf("load domain: %w", err)
	}
	return name, canSend, canReceive, nil
}

func ensureManagedMailboxUsers(ctx context.Context, tx pgx.Tx, ids []int64) error {
	ids = normalizeManagementIDs(ids)
	if len(ids) == 0 {
		return nil
	}
	var count int64
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM mailbox_users WHERE id = ANY($1::bigint[])`, ids).Scan(&count); err != nil {
		return fmt.Errorf("check mailbox users: %w", err)
	}
	if count != int64(len(ids)) {
		return managementNotFound("MAILBOX_USER_NOT_FOUND")
	}
	return nil
}

func ensureManagedAPIKeys(ctx context.Context, tx pgx.Tx, ids []int64) error {
	ids = normalizeManagementIDs(ids)
	if len(ids) == 0 {
		return nil
	}
	var count int64
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM api_keys WHERE id = ANY($1::bigint[])`, ids).Scan(&count); err != nil {
		return fmt.Errorf("check API keys: %w", err)
	}
	if count != int64(len(ids)) {
		return managementNotFound("API_KEY_NOT_FOUND")
	}
	return nil
}

func replaceManagedMailboxMemberships(ctx context.Context, tx pgx.Tx, mailboxID int64, userIDs []int64) error {
	if _, err := tx.Exec(ctx, `DELETE FROM mailbox_memberships WHERE mailbox_id = $1`, mailboxID); err != nil {
		return fmt.Errorf("clear mailbox memberships: %w", err)
	}
	for _, userID := range normalizeManagementIDs(userIDs) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO mailbox_memberships (mailbox_id, user_id, role, created_at, updated_at)
			VALUES ($1, $2, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT (mailbox_id, user_id) DO NOTHING
		`, mailboxID, userID); err != nil {
			return fmt.Errorf("create mailbox membership: %w", err)
		}
	}
	return nil
}

func appendManagedAllowedDomainIDs(ctx context.Context, tx pgx.Tx, apiKeyIDs []int64, domainID int64) error {
	for _, apiKeyID := range normalizeManagementIDs(apiKeyIDs) {
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT COALESCE(allowed_domain_ids, '[]'::jsonb) FROM api_keys WHERE id = $1 FOR UPDATE`, apiKeyID).Scan(&raw); err != nil {
			if errorsIsNoRows(err) {
				return managementNotFound("API_KEY_NOT_FOUND")
			}
			return fmt.Errorf("load API key domain scope: %w", err)
		}
		var ids []int64
		_ = json.Unmarshal(raw, &ids)
		ids = normalizeManagementIDs(append(ids, domainID))
		encoded, err := json.Marshal(ids)
		if err != nil {
			return fmt.Errorf("encode API key domain scope: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE api_keys SET allowed_domain_ids = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, apiKeyID, string(encoded)); err != nil {
			return fmt.Errorf("update API key domain scope: %w", err)
		}
	}
	return nil
}

func managedMailboxMetadata(mode string, batchTag *string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"provisioningMode": mode,
		"batchTag":         batchTag,
		"updatedAt":        time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func mergeManagedMailboxMetadata(raw []byte, mode string, batchTag *string) ([]byte, error) {
	metadata := make(map[string]any)
	_ = json.Unmarshal(raw, &metadata)
	metadata["provisioningMode"] = mode
	metadata["batchTag"] = batchTag
	metadata["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	return json.Marshal(metadata)
}

func appendOwnerID(ids []int64, ownerID *int64) []int64 {
	if ownerID == nil {
		return ids
	}
	return append(ids, *ownerID)
}

func nullableSQLString(value *string) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *value, Valid: true}
}

func nullableSQLInt64(value *int64) sql.NullInt64 {
	if value == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *value, Valid: true}
}

func nullableAnyString(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func nullableAnyInt64(value sql.NullInt64) any {
	if !value.Valid {
		return nil
	}
	return value.Int64
}
