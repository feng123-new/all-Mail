package businessapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type APIKeyStore interface {
	ListAPIKeys(context.Context, APIKeyListInput) (APIKeyList, error)
	CreateAPIKey(context.Context, APIKeyCreateInput, int64) (APIKeyCreated, error)
	GetAPIKey(context.Context, int64) (APIKeyDetails, error)
	UpdateAPIKey(context.Context, int64, APIKeyUpdateInput) (APIKeyUpdated, error)
	DeleteAPIKey(context.Context, int64) error
	FindAPIKeyByHash(context.Context, string) (APIKeyPrincipal, error)
	TouchAPIKey(context.Context, int64, time.Time) error
	EmailAllocationStats(context.Context, int64, string) (AllocationStats, error)
	ResetEmailAllocations(context.Context, int64, string) error
	AssignedEmails(context.Context, int64, *int64) ([]AssignedEmail, error)
	UpdateAssignedEmails(context.Context, int64, []int64, *int64) (map[string]int, error)
	AllocateEmail(context.Context, int64, string) (EmailAllocation, error)
	ListExternalMailboxes(context.Context, int64, string) (ExternalMailboxList, error)
	LogAPICall(context.Context, string, *int64, *int64, string, int, int64, string) error
}

type apiKeyDatabaseRow struct {
	ID               int64
	Name             string
	KeyPrefix        string
	RateLimit        int
	Status           string
	ExpiresAt        *time.Time
	LastUsedAt       *time.Time
	UsageCount       int64
	Permissions      map[string]bool
	AllowedGroupIDs  []int64
	AllowedEmailIDs  []int64
	AllowedDomainIDs []int64
	CreatedAt        time.Time
	UpdatedAt        time.Time
	CreatedByName    *string
}

type rowScanner interface {
	Scan(...any) error
}

func (s *PostgresStore) ListAPIKeys(ctx context.Context, input APIKeyListInput) (APIKeyList, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM api_keys
		WHERE ($1 = '' OR status::text = $1)
		  AND ($2 = '' OR name LIKE '%' || $2 || '%' OR key_prefix LIKE '%' || $2 || '%')
	`, input.Status, input.Keyword).Scan(&total); err != nil {
		return APIKeyList{}, fmt.Errorf("count API keys: %w", err)
	}

	offset := (input.Page - 1) * input.PageSize
	rows, err := s.pool.Query(ctx, `
		SELECT
			api_key.id,
			api_key.name,
			api_key.key_prefix,
			api_key.rate_limit,
			api_key.status::text,
			api_key.expires_at,
			api_key.last_used_at,
			api_key.usage_count,
			api_key.created_at,
			admin.username
		FROM api_keys AS api_key
		LEFT JOIN admins AS admin ON admin.id = api_key.created_by
		WHERE ($1 = '' OR api_key.status::text = $1)
		  AND ($2 = '' OR api_key.name LIKE '%' || $2 || '%' OR api_key.key_prefix LIKE '%' || $2 || '%')
		ORDER BY api_key.id DESC
		LIMIT $3 OFFSET $4
	`, input.Status, input.Keyword, input.PageSize, offset)
	if err != nil {
		return APIKeyList{}, fmt.Errorf("query API keys: %w", err)
	}
	defer rows.Close()

	list := make([]APIKeyListItem, 0, input.PageSize)
	for rows.Next() {
		var item APIKeyListItem
		var expiresAt, lastUsedAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.KeyPrefix,
			&item.RateLimit,
			&item.Status,
			&expiresAt,
			&lastUsedAt,
			&item.UsageCount,
			&createdAt,
			&item.CreatedByName,
		); err != nil {
			return APIKeyList{}, fmt.Errorf("scan API key list item: %w", err)
		}
		item.ExpiresAt = formatOptionalAPITime(expiresAt)
		item.LastUsedAt = formatOptionalAPITime(lastUsedAt)
		item.CreatedAt = formatAPITime(createdAt)
		if item.CreatedByName != nil {
			item.Creator = &APIKeyCreator{Username: *item.CreatedByName}
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return APIKeyList{}, fmt.Errorf("iterate API keys: %w", err)
	}
	return APIKeyList{List: list, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *PostgresStore) CreateAPIKey(ctx context.Context, input APIKeyCreateInput, createdBy int64) (APIKeyCreated, error) {
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return APIKeyCreated{}, fmt.Errorf("begin API key create transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	if err := validateAPIKeyScopeIDs(ctx, transaction, input.AllowedGroupIDs, input.AllowedEmailIDs, input.AllowedDomainIDs); err != nil {
		return APIKeyCreated{}, err
	}
	key, prefix, hash, err := generateAPIKey()
	if err != nil {
		return APIKeyCreated{}, fmt.Errorf("generate API key: %w", err)
	}
	permissionsJSON, err := encodeJSONOrNull(input.Permissions)
	if err != nil {
		return APIKeyCreated{}, err
	}
	groupsJSON, err := encodeJSONOrNull(input.AllowedGroupIDs)
	if err != nil {
		return APIKeyCreated{}, err
	}
	emailsJSON, err := encodeJSONOrNull(input.AllowedEmailIDs)
	if err != nil {
		return APIKeyCreated{}, err
	}
	domainsJSON, err := encodeJSONOrNull(input.AllowedDomainIDs)
	if err != nil {
		return APIKeyCreated{}, err
	}

	var result APIKeyCreated
	var createdAt time.Time
	var expiresAt *time.Time
	var permissionsRaw, groupsRaw, emailsRaw, domainsRaw []byte
	err = transaction.QueryRow(ctx, `
		INSERT INTO api_keys (
			name, key_hash, key_prefix, permissions,
			allowed_group_ids, allowed_email_ids, allowed_domain_ids,
			rate_limit, expires_at, created_by, updated_at
		)
		VALUES (
			$1, $2, $3, NULLIF($4, '')::jsonb,
			NULLIF($5, '')::jsonb, NULLIF($6, '')::jsonb, NULLIF($7, '')::jsonb,
			$8, $9, $10, CURRENT_TIMESTAMP
		)
		RETURNING
			id, name, key_prefix, rate_limit, status::text, expires_at,
			permissions, allowed_group_ids, allowed_email_ids, allowed_domain_ids, created_at
	`,
		input.Name,
		hash,
		prefix,
		permissionsJSON,
		groupsJSON,
		emailsJSON,
		domainsJSON,
		input.RateLimit,
		input.ExpiresAt,
		createdBy,
	).Scan(
		&result.ID,
		&result.Name,
		&result.KeyPrefix,
		&result.RateLimit,
		&result.Status,
		&expiresAt,
		&permissionsRaw,
		&groupsRaw,
		&emailsRaw,
		&domainsRaw,
		&createdAt,
	)
	if err != nil {
		return APIKeyCreated{}, fmt.Errorf("insert API key: %w", err)
	}
	result.ExpiresAt = formatOptionalAPITime(expiresAt)
	result.AllowedGroupIDs = decodeJSONIDs(groupsRaw)
	result.AllowedEmailIDs = decodeJSONIDs(emailsRaw)
	result.AllowedDomainIDs = decodeJSONIDs(domainsRaw)
	result.CreatedAt = formatAPITime(createdAt)
	result.Key = key

	if err := transaction.Commit(ctx); err != nil {
		return APIKeyCreated{}, fmt.Errorf("commit API key create transaction: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) GetAPIKey(ctx context.Context, id int64) (APIKeyDetails, error) {
	row, err := scanAPIKeyDatabaseRow(s.pool.QueryRow(ctx, apiKeyDetailsSQL, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return APIKeyDetails{}, &requestError{Status: 404, Code: "NOT_FOUND"}
	}
	if err != nil {
		return APIKeyDetails{}, fmt.Errorf("load API key: %w", err)
	}
	return row.details(), nil
}

func (s *PostgresStore) UpdateAPIKey(ctx context.Context, id int64, input APIKeyUpdateInput) (APIKeyUpdated, error) {
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return APIKeyUpdated{}, fmt.Errorf("begin API key update transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	current, err := scanAPIKeyDatabaseRow(transaction.QueryRow(ctx, apiKeyDetailsSQL+" FOR UPDATE OF api_key", id))
	if errors.Is(err, pgx.ErrNoRows) {
		return APIKeyUpdated{}, &requestError{Status: 404, Code: "NOT_FOUND"}
	}
	if err != nil {
		return APIKeyUpdated{}, fmt.Errorf("lock API key for update: %w", err)
	}

	name := current.Name
	if input.NameSet {
		name = input.Name
	}
	rateLimit := current.RateLimit
	if input.RateLimitSet {
		rateLimit = input.RateLimit
	}
	status := current.Status
	if input.StatusSet {
		status = input.Status
	}
	expiresAt := current.ExpiresAt
	if input.ExpiresAtSet {
		expiresAt = input.ExpiresAt
	}
	permissions := current.Permissions
	if input.PermissionsSet && len(input.Permissions) > 0 {
		permissions = input.Permissions
	}
	groupIDs := current.AllowedGroupIDs
	if input.AllowedGroupIDsSet {
		groupIDs = input.AllowedGroupIDs
	}
	emailIDs := current.AllowedEmailIDs
	if input.AllowedEmailIDsSet {
		emailIDs = input.AllowedEmailIDs
	}
	domainIDs := current.AllowedDomainIDs
	if input.AllowedDomainIDsSet {
		domainIDs = input.AllowedDomainIDs
	}
	if err := validateAPIKeyScopeIDs(ctx, transaction, groupIDs, emailIDs, domainIDs); err != nil {
		return APIKeyUpdated{}, err
	}
	permissionsJSON, err := encodeJSONOrNull(permissions)
	if err != nil {
		return APIKeyUpdated{}, err
	}
	groupsJSON, err := encodeJSONOrNull(groupIDs)
	if err != nil {
		return APIKeyUpdated{}, err
	}
	emailsJSON, err := encodeJSONOrNull(emailIDs)
	if err != nil {
		return APIKeyUpdated{}, err
	}
	domainsJSON, err := encodeJSONOrNull(domainIDs)
	if err != nil {
		return APIKeyUpdated{}, err
	}

	var result APIKeyUpdated
	var updatedAt time.Time
	var resultExpiresAt *time.Time
	var permissionsRaw, groupsRaw, emailsRaw, domainsRaw []byte
	err = transaction.QueryRow(ctx, `
		UPDATE api_keys
		SET
			name = $2,
			rate_limit = $3,
			status = $4::"Status",
			expires_at = $5,
			permissions = NULLIF($6, '')::jsonb,
			allowed_group_ids = NULLIF($7, '')::jsonb,
			allowed_email_ids = NULLIF($8, '')::jsonb,
			allowed_domain_ids = NULLIF($9, '')::jsonb,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING
			id, name, key_prefix, rate_limit, status::text, expires_at,
			permissions, allowed_group_ids, allowed_email_ids, allowed_domain_ids, updated_at
	`, id, name, rateLimit, status, expiresAt, permissionsJSON, groupsJSON, emailsJSON, domainsJSON).Scan(
		&result.ID,
		&result.Name,
		&result.KeyPrefix,
		&result.RateLimit,
		&result.Status,
		&resultExpiresAt,
		&permissionsRaw,
		&groupsRaw,
		&emailsRaw,
		&domainsRaw,
		&updatedAt,
	)
	if err != nil {
		return APIKeyUpdated{}, fmt.Errorf("update API key: %w", err)
	}
	result.ExpiresAt = formatOptionalAPITime(resultExpiresAt)
	result.AllowedGroupIDs = decodeJSONIDs(groupsRaw)
	result.AllowedEmailIDs = decodeJSONIDs(emailsRaw)
	result.AllowedDomainIDs = decodeJSONIDs(domainsRaw)
	result.UpdatedAt = formatAPITime(updatedAt)

	if err := transaction.Commit(ctx); err != nil {
		return APIKeyUpdated{}, fmt.Errorf("commit API key update transaction: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) DeleteAPIKey(ctx context.Context, id int64) error {
	var deleted int64
	if err := s.pool.QueryRow(ctx, `DELETE FROM api_keys WHERE id = $1 RETURNING id`, id).Scan(&deleted); errors.Is(err, pgx.ErrNoRows) {
		return &requestError{Status: 404, Code: "NOT_FOUND"}
	} else if err != nil {
		return fmt.Errorf("delete API key: %w", err)
	}
	return nil
}

func (s *PostgresStore) FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyPrincipal, error) {
	var result APIKeyPrincipal
	var permissionsRaw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, rate_limit, status::text, expires_at, permissions
		FROM api_keys
		WHERE key_hash = $1
	`, hash).Scan(
		&result.ID,
		&result.Name,
		&result.RateLimit,
		&result.Status,
		&result.ExpiresAt,
		&permissionsRaw,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return APIKeyPrincipal{}, errNotFound
	}
	if err != nil {
		return APIKeyPrincipal{}, fmt.Errorf("load API key by hash: %w", err)
	}
	result.Permissions = decodeJSONPermissions(permissionsRaw)
	return result, nil
}

func (s *PostgresStore) TouchAPIKey(ctx context.Context, id int64, usedAt time.Time) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE api_keys
		SET usage_count = usage_count + 1,
			last_used_at = $2,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, usedAt)
	if err != nil {
		return fmt.Errorf("update API key usage: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errNotFound
	}
	return nil
}

func (s *PostgresStore) EmailAllocationStats(ctx context.Context, apiKeyID int64, groupName string) (AllocationStats, error) {
	scope, err := s.loadAPIKeyScope(ctx, s.pool, apiKeyID)
	if err != nil {
		return AllocationStats{}, err
	}
	groupID, err := s.resolveEmailGroupID(ctx, s.pool, groupName)
	if err != nil {
		return AllocationStats{}, err
	}
	if groupID != nil && len(scope.AllowedGroupIDs) > 0 && !containsInt64(scope.AllowedGroupIDs, *groupID) {
		return AllocationStats{}, &requestError{Status: 403, Code: "GROUP_FORBIDDEN"}
	}
	return s.emailAllocationStatsWithQuerier(ctx, s.pool, apiKeyID, groupID, scope)
}

func (s *PostgresStore) ResetEmailAllocations(ctx context.Context, apiKeyID int64, groupName string) error {
	scope, err := s.loadAPIKeyScope(ctx, s.pool, apiKeyID)
	if err != nil {
		return err
	}
	groupID, err := s.resolveEmailGroupID(ctx, s.pool, groupName)
	if err != nil {
		return err
	}
	if groupID != nil && len(scope.AllowedGroupIDs) > 0 && !containsInt64(scope.AllowedGroupIDs, *groupID) {
		return &requestError{Status: 403, Code: "GROUP_FORBIDDEN"}
	}
	_, err = s.pool.Exec(ctx, `
		DELETE FROM email_usage AS usage
		USING email_accounts AS email
		WHERE usage.api_key_id = $1
		  AND usage.email_account_id = email.id
		  AND email.status::text = 'ACTIVE'
		  AND ($2::bigint IS NULL OR email.group_id = $2)
		  AND (cardinality($3::bigint[]) = 0 OR email.group_id = ANY($3::bigint[]))
		  AND (cardinality($4::bigint[]) = 0 OR email.id = ANY($4::bigint[]))
	`, apiKeyID, nullableInt64(groupID), nonNilIDs(scope.AllowedGroupIDs), nonNilIDs(scope.AllowedEmailIDs))
	if err != nil {
		return fmt.Errorf("reset email allocations: %w", err)
	}
	return nil
}

func (s *PostgresStore) AssignedEmails(ctx context.Context, apiKeyID int64, groupID *int64) ([]AssignedEmail, error) {
	scope, err := s.loadAPIKeyScope(ctx, s.pool, apiKeyID)
	if err != nil {
		return nil, err
	}
	if groupID != nil && len(scope.AllowedGroupIDs) > 0 && !containsInt64(scope.AllowedGroupIDs, *groupID) {
		return nil, &requestError{Status: 403, Code: "GROUP_FORBIDDEN"}
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			email.id,
			email.email,
			email.provider::text,
			EXISTS (
				SELECT 1 FROM email_usage AS usage
				WHERE usage.api_key_id = $1 AND usage.email_account_id = email.id
			),
			email.group_id,
			group_record.name
		FROM email_accounts AS email
		LEFT JOIN email_groups AS group_record ON group_record.id = email.group_id
		WHERE email.status::text = 'ACTIVE'
		  AND ($2::bigint IS NULL OR email.group_id = $2)
		  AND (cardinality($3::bigint[]) = 0 OR email.group_id = ANY($3::bigint[]))
		  AND (cardinality($4::bigint[]) = 0 OR email.id = ANY($4::bigint[]))
		ORDER BY email.id ASC
	`, apiKeyID, nullableInt64(groupID), nonNilIDs(scope.AllowedGroupIDs), nonNilIDs(scope.AllowedEmailIDs))
	if err != nil {
		return nil, fmt.Errorf("query assigned emails: %w", err)
	}
	defer rows.Close()
	result := make([]AssignedEmail, 0)
	for rows.Next() {
		var item AssignedEmail
		if err := rows.Scan(&item.ID, &item.Email, &item.Provider, &item.Used, &item.GroupID, &item.GroupName); err != nil {
			return nil, fmt.Errorf("scan assigned email: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assigned emails: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) UpdateAssignedEmails(ctx context.Context, apiKeyID int64, emailIDs []int64, groupID *int64) (map[string]int, error) {
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin assigned email transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	scope, err := s.loadAPIKeyScope(ctx, transaction, apiKeyID)
	if err != nil {
		return nil, err
	}
	if groupID != nil && len(scope.AllowedGroupIDs) > 0 && !containsInt64(scope.AllowedGroupIDs, *groupID) {
		return nil, &requestError{Status: 403, Code: "GROUP_FORBIDDEN"}
	}
	rows, err := transaction.Query(ctx, `
		SELECT id
		FROM email_accounts
		WHERE status::text = 'ACTIVE'
		  AND ($1::bigint IS NULL OR group_id = $1)
		  AND (cardinality($2::bigint[]) = 0 OR group_id = ANY($2::bigint[]))
		  AND (cardinality($3::bigint[]) = 0 OR id = ANY($3::bigint[]))
	`, nullableInt64(groupID), nonNilIDs(scope.AllowedGroupIDs), nonNilIDs(scope.AllowedEmailIDs))
	if err != nil {
		return nil, fmt.Errorf("query assignable emails: %w", err)
	}
	allowed := make(map[int64]struct{})
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan assignable email: %w", err)
		}
		allowed[id] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assignable emails: %w", err)
	}

	normalized := normalizePositiveIDs(emailIDs)
	for _, id := range normalized {
		if _, ok := allowed[id]; !ok {
			return nil, &requestError{Status: 403, Code: "EMAIL_FORBIDDEN"}
		}
	}

	existingRows, err := transaction.Query(ctx, `
		SELECT usage.email_account_id
		FROM email_usage AS usage
		JOIN email_accounts AS email ON email.id = usage.email_account_id
		WHERE usage.api_key_id = $1
		  AND ($2::bigint IS NULL OR email.group_id = $2)
		  AND (cardinality($3::bigint[]) = 0 OR email.group_id = ANY($3::bigint[]))
		  AND (cardinality($4::bigint[]) = 0 OR email.id = ANY($4::bigint[]))
	`, apiKeyID, nullableInt64(groupID), nonNilIDs(scope.AllowedGroupIDs), nonNilIDs(scope.AllowedEmailIDs))
	if err != nil {
		return nil, fmt.Errorf("query current assigned emails: %w", err)
	}
	existing := make(map[int64]struct{})
	for existingRows.Next() {
		var id int64
		if err := existingRows.Scan(&id); err != nil {
			existingRows.Close()
			return nil, fmt.Errorf("scan current assigned email: %w", err)
		}
		existing[id] = struct{}{}
	}
	existingRows.Close()
	if err := existingRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate current assigned emails: %w", err)
	}

	next := make(map[int64]struct{}, len(normalized))
	for _, id := range normalized {
		next[id] = struct{}{}
	}
	toAdd := make([]int64, 0)
	toRemove := make([]int64, 0)
	for id := range next {
		if _, ok := existing[id]; !ok {
			toAdd = append(toAdd, id)
		}
	}
	for id := range existing {
		if _, ok := next[id]; !ok {
			toRemove = append(toRemove, id)
		}
	}
	if len(toRemove) > 0 {
		if _, err := transaction.Exec(ctx, `
			DELETE FROM email_usage
			WHERE api_key_id = $1 AND email_account_id = ANY($2::bigint[])
		`, apiKeyID, toRemove); err != nil {
			return nil, fmt.Errorf("remove assigned emails: %w", err)
		}
	}
	for _, emailID := range toAdd {
		if _, err := transaction.Exec(ctx, `
			INSERT INTO email_usage (api_key_id, email_account_id, used_at)
			VALUES ($1, $2, CURRENT_TIMESTAMP)
			ON CONFLICT (api_key_id, email_account_id) DO NOTHING
		`, apiKeyID, emailID); err != nil {
			return nil, fmt.Errorf("add assigned email: %w", err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit assigned email transaction: %w", err)
	}
	return map[string]int{
		"count":   len(normalized),
		"added":   len(toAdd),
		"removed": len(toRemove),
	}, nil
}

func (s *PostgresStore) AllocateEmail(ctx context.Context, apiKeyID int64, groupName string) (EmailAllocation, error) {
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return EmailAllocation{}, fmt.Errorf("begin email allocation transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	scope, err := s.loadAPIKeyScope(ctx, transaction, apiKeyID)
	if err != nil {
		return EmailAllocation{}, err
	}
	groupID, err := s.resolveEmailGroupID(ctx, transaction, groupName)
	if err != nil {
		return EmailAllocation{}, err
	}
	if groupID != nil && len(scope.AllowedGroupIDs) > 0 && !containsInt64(scope.AllowedGroupIDs, *groupID) {
		return EmailAllocation{}, &requestError{Status: 403, Code: "GROUP_FORBIDDEN"}
	}

	var result EmailAllocation
	err = transaction.QueryRow(ctx, `
		SELECT email.id, email.email
		FROM email_accounts AS email
		WHERE email.status::text = 'ACTIVE'
		  AND ($1::bigint IS NULL OR email.group_id = $1)
		  AND (cardinality($2::bigint[]) = 0 OR email.group_id = ANY($2::bigint[]))
		  AND (cardinality($3::bigint[]) = 0 OR email.id = ANY($3::bigint[]))
		  AND NOT EXISTS (
			SELECT 1
			FROM email_usage AS usage
			WHERE usage.api_key_id = $4 AND usage.email_account_id = email.id
		  )
		ORDER BY email.id ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`, nullableInt64(groupID), nonNilIDs(scope.AllowedGroupIDs), nonNilIDs(scope.AllowedEmailIDs), apiKeyID).Scan(&result.ID, &result.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		stats, statsErr := s.emailAllocationStatsWithQuerier(ctx, transaction, apiKeyID, groupID, scope)
		if statsErr != nil {
			return EmailAllocation{}, statsErr
		}
		return EmailAllocation{}, &requestError{
			Status: 400,
			Code:   "NO_UNUSED_EMAIL",
			Cause:  fmt.Errorf("used %d of %d", stats.Used, stats.Total),
		}
	}
	if err != nil {
		return EmailAllocation{}, fmt.Errorf("select unused email: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO email_usage (api_key_id, email_account_id, used_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP)
		ON CONFLICT (api_key_id, email_account_id) DO NOTHING
	`, apiKeyID, result.ID); err != nil {
		return EmailAllocation{}, fmt.Errorf("record email allocation: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return EmailAllocation{}, fmt.Errorf("commit email allocation: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) ListExternalMailboxes(ctx context.Context, apiKeyID int64, groupName string) (ExternalMailboxList, error) {
	scope, err := s.loadAPIKeyScope(ctx, s.pool, apiKeyID)
	if err != nil {
		return ExternalMailboxList{}, err
	}
	groupID, err := s.resolveEmailGroupID(ctx, s.pool, groupName)
	if err != nil {
		return ExternalMailboxList{}, err
	}
	if groupID != nil && len(scope.AllowedGroupIDs) > 0 && !containsInt64(scope.AllowedGroupIDs, *groupID) {
		return ExternalMailboxList{}, &requestError{Status: 403, Code: "GROUP_FORBIDDEN"}
	}
	rows, err := s.pool.Query(ctx, `
		SELECT email.email, email.provider::text, email.status::text, group_record.name
		FROM email_accounts AS email
		LEFT JOIN email_groups AS group_record ON group_record.id = email.group_id
		WHERE email.status::text = 'ACTIVE'
		  AND ($1::bigint IS NULL OR email.group_id = $1)
		  AND (cardinality($2::bigint[]) = 0 OR email.group_id = ANY($2::bigint[]))
		  AND (cardinality($3::bigint[]) = 0 OR email.id = ANY($3::bigint[]))
		ORDER BY email.id ASC
	`, nullableInt64(groupID), nonNilIDs(scope.AllowedGroupIDs), nonNilIDs(scope.AllowedEmailIDs))
	if err != nil {
		return ExternalMailboxList{}, fmt.Errorf("query external mailbox list: %w", err)
	}
	defer rows.Close()
	result := ExternalMailboxList{Emails: make([]ExternalMailbox, 0)}
	for rows.Next() {
		var item ExternalMailbox
		if err := rows.Scan(&item.Email, &item.Provider, &item.Status, &item.Group); err != nil {
			return ExternalMailboxList{}, fmt.Errorf("scan external mailbox: %w", err)
		}
		result.Emails = append(result.Emails, item)
	}
	if err := rows.Err(); err != nil {
		return ExternalMailboxList{}, fmt.Errorf("iterate external mailboxes: %w", err)
	}
	result.Total = len(result.Emails)
	return result, nil
}

func (s *PostgresStore) LogAPICall(
	ctx context.Context,
	action string,
	apiKeyID *int64,
	emailAccountID *int64,
	requestIP string,
	responseCode int,
	responseTimeMS int64,
	requestID string,
) error {
	metadata, err := json.Marshal(map[string]string{"requestId": requestID})
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO api_logs (
			api_key_id, email_account_id, action, request_ip,
			response_code, response_time_ms, metadata, created_at
		)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7::jsonb, CURRENT_TIMESTAMP)
	`, apiKeyID, emailAccountID, action, requestIP, responseCode, responseTimeMS, string(metadata))
	if err != nil {
		return fmt.Errorf("write API log: %w", err)
	}
	return nil
}

const apiKeyDetailsSQL = `
	SELECT
		api_key.id,
		api_key.name,
		api_key.key_prefix,
		api_key.rate_limit,
		api_key.status::text,
		api_key.expires_at,
		api_key.last_used_at,
		api_key.usage_count,
		api_key.permissions,
		api_key.allowed_group_ids,
		api_key.allowed_email_ids,
		api_key.allowed_domain_ids,
		api_key.created_at,
		api_key.updated_at,
		admin.username
	FROM api_keys AS api_key
	LEFT JOIN admins AS admin ON admin.id = api_key.created_by
	WHERE api_key.id = $1
`

func scanAPIKeyDatabaseRow(scanner rowScanner) (apiKeyDatabaseRow, error) {
	var result apiKeyDatabaseRow
	var permissionsRaw, groupIDsRaw, emailIDsRaw, domainIDsRaw []byte
	err := scanner.Scan(
		&result.ID,
		&result.Name,
		&result.KeyPrefix,
		&result.RateLimit,
		&result.Status,
		&result.ExpiresAt,
		&result.LastUsedAt,
		&result.UsageCount,
		&permissionsRaw,
		&groupIDsRaw,
		&emailIDsRaw,
		&domainIDsRaw,
		&result.CreatedAt,
		&result.UpdatedAt,
		&result.CreatedByName,
	)
	if err != nil {
		return apiKeyDatabaseRow{}, err
	}
	result.Permissions = decodeJSONPermissions(permissionsRaw)
	result.AllowedGroupIDs = decodeJSONIDs(groupIDsRaw)
	result.AllowedEmailIDs = decodeJSONIDs(emailIDsRaw)
	result.AllowedDomainIDs = decodeJSONIDs(domainIDsRaw)
	return result, nil
}

func (row apiKeyDatabaseRow) details() APIKeyDetails {
	var creator *APIKeyCreator
	if row.CreatedByName != nil {
		creator = &APIKeyCreator{Username: *row.CreatedByName}
	}
	return APIKeyDetails{
		ID:               row.ID,
		Name:             row.Name,
		KeyPrefix:        row.KeyPrefix,
		RateLimit:        row.RateLimit,
		Status:           row.Status,
		ExpiresAt:        formatOptionalAPITime(row.ExpiresAt),
		LastUsedAt:       formatOptionalAPITime(row.LastUsedAt),
		UsageCount:       row.UsageCount,
		Permissions:      row.Permissions,
		AllowedGroupIDs:  row.AllowedGroupIDs,
		AllowedEmailIDs:  row.AllowedEmailIDs,
		AllowedDomainIDs: row.AllowedDomainIDs,
		CreatedAt:        formatAPITime(row.CreatedAt),
		UpdatedAt:        formatAPITime(row.UpdatedAt),
		Creator:          creator,
		CreatedByName:    row.CreatedByName,
	}
}

func validateAPIKeyScopeIDs(
	ctx context.Context,
	querier interface {
		QueryRow(context.Context, string, ...any) pgx.Row
	},
	groupIDs, emailIDs, domainIDs []int64,
) error {
	checks := []struct {
		ids   []int64
		query string
		code  string
	}{
		{groupIDs, `SELECT COUNT(*)::bigint FROM email_groups WHERE id = ANY($1::bigint[])`, "GROUP_NOT_FOUND"},
		{emailIDs, `SELECT COUNT(*)::bigint FROM email_accounts WHERE id = ANY($1::bigint[])`, "EMAIL_NOT_FOUND"},
		{domainIDs, `SELECT COUNT(*)::bigint FROM domains WHERE id = ANY($1::bigint[])`, "DOMAIN_NOT_FOUND"},
	}
	for _, check := range checks {
		ids := normalizePositiveIDs(check.ids)
		if len(ids) == 0 {
			continue
		}
		var count int64
		if err := querier.QueryRow(ctx, check.query, ids).Scan(&count); err != nil {
			return fmt.Errorf("validate API key scope: %w", err)
		}
		if count != int64(len(ids)) {
			return &requestError{Status: 404, Code: check.code}
		}
	}
	return nil
}

type basicQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func (s *PostgresStore) loadAPIKeyScope(ctx context.Context, querier basicQuerier, apiKeyID int64) (APIKeyScope, error) {
	var groupsRaw, emailsRaw, domainsRaw []byte
	err := querier.QueryRow(ctx, `
		SELECT allowed_group_ids, allowed_email_ids, allowed_domain_ids
		FROM api_keys
		WHERE id = $1
	`, apiKeyID).Scan(&groupsRaw, &emailsRaw, &domainsRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return APIKeyScope{}, &requestError{Status: 404, Code: "API_KEY_NOT_FOUND"}
	}
	if err != nil {
		return APIKeyScope{}, fmt.Errorf("load API key scope: %w", err)
	}
	return APIKeyScope{
		AllowedGroupIDs:  decodeJSONIDs(groupsRaw),
		AllowedEmailIDs:  decodeJSONIDs(emailsRaw),
		AllowedDomainIDs: decodeJSONIDs(domainsRaw),
	}, nil
}

func (s *PostgresStore) resolveEmailGroupID(ctx context.Context, querier basicQuerier, groupName string) (*int64, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return nil, nil
	}
	var id int64
	if err := querier.QueryRow(ctx, `SELECT id FROM email_groups WHERE name = $1`, groupName).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
		return nil, &requestError{Status: 404, Code: "GROUP_NOT_FOUND"}
	} else if err != nil {
		return nil, fmt.Errorf("resolve email group: %w", err)
	}
	return &id, nil
}

func (s *PostgresStore) emailAllocationStatsWithQuerier(
	ctx context.Context,
	querier basicQuerier,
	apiKeyID int64,
	groupID *int64,
	scope APIKeyScope,
) (AllocationStats, error) {
	var result AllocationStats
	err := querier.QueryRow(ctx, `
		WITH scoped AS (
			SELECT id
			FROM email_accounts
			WHERE status::text = 'ACTIVE'
			  AND ($1::bigint IS NULL OR group_id = $1)
			  AND (cardinality($2::bigint[]) = 0 OR group_id = ANY($2::bigint[]))
			  AND (cardinality($3::bigint[]) = 0 OR id = ANY($3::bigint[]))
		)
		SELECT
			COUNT(*)::bigint,
			COUNT(usage.email_account_id)::bigint
		FROM scoped
		LEFT JOIN email_usage AS usage
		  ON usage.api_key_id = $4 AND usage.email_account_id = scoped.id
	`, nullableInt64(groupID), nonNilIDs(scope.AllowedGroupIDs), nonNilIDs(scope.AllowedEmailIDs), apiKeyID).Scan(&result.Total, &result.Used)
	if err != nil {
		return AllocationStats{}, fmt.Errorf("query email allocation statistics: %w", err)
	}
	result.Remaining = result.Total - result.Used
	if result.Remaining < 0 {
		result.Remaining = 0
	}
	return result, nil
}

func generateAPIKey() (key, prefix, hash string, err error) {
	randomPart := make([]byte, 24)
	if _, err = rand.Read(randomPart); err != nil {
		return "", "", "", err
	}
	key = "sk_" + base64.RawURLEncoding.EncodeToString(randomPart)
	prefix = key
	if len(prefix) > 7 {
		prefix = prefix[:7]
	}
	digest := sha256.Sum256([]byte(key))
	hash = hex.EncodeToString(digest[:])
	return key, prefix, hash, nil
}

func encodeJSONOrNull(value any) (string, error) {
	switch typed := value.(type) {
	case nil:
		return "", nil
	case map[string]bool:
		if len(typed) == 0 {
			return "", nil
		}
	case []int64:
		if len(typed) == 0 {
			return "", nil
		}
	}
	content, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode API key JSON: %w", err)
	}
	return string(content), nil
}

func decodeJSONPermissions(raw []byte) map[string]bool {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var value map[string]bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

func decodeJSONIDs(raw []byte) []int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return []int64{}
	}
	var values []any
	if err := json.Unmarshal(raw, &values); err != nil {
		return []int64{}
	}
	ids := make([]int64, 0, len(values))
	for _, value := range values {
		switch typed := value.(type) {
		case float64:
			if typed > 0 && typed == float64(int64(typed)) {
				ids = append(ids, int64(typed))
			}
		case string:
			var id int64
			if _, err := fmt.Sscan(typed, &id); err == nil && id > 0 {
				ids = append(ids, id)
			}
		}
	}
	return normalizePositiveIDs(ids)
}

func normalizePositiveIDs(values []int64) []int64 {
	seen := make(map[int64]struct{}, len(values))
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func containsInt64(values []int64, target int64) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func nonNilIDs(values []int64) []int64 {
	if values == nil {
		return []int64{}
	}
	return values
}

func nullableInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}
