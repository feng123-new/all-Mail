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

type mailAccountRow struct {
	ID                   int64
	Email                string
	Provider             string
	AuthType             string
	ClientID             sql.NullString
	ClientSecret         sql.NullString
	RefreshToken         sql.NullString
	Password             sql.NullString
	AccountLoginPassword sql.NullString
	ProviderConfig       []byte
	Capabilities         []byte
	Status               string
	GroupID              sql.NullInt64
	GroupName            sql.NullString
	FetchStrategy        sql.NullString
	LastCheckAt          sql.NullTime
	MailboxStatus        []byte
	ErrorMessage         sql.NullString
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type mailAccountCreateInput struct {
	Email                string
	Provider             string
	AuthType             string
	ClientID             *string
	ClientSecret         *string
	RefreshToken         *string
	Password             *string
	AccountLoginPassword *string
	GroupID              *int64
	ProviderConfig       mailProviderConfig
	Capabilities         map[string]any
	Status               string
	ErrorMessage         *string
}

type mailAccountUpdateInput struct {
	EmailPresent                bool
	Email                       string
	ProviderPresent             bool
	Provider                    string
	AuthTypePresent             bool
	AuthType                    string
	ClientIDPresent             bool
	ClientID                    *string
	ClientSecretPresent         bool
	ClientSecret                *string
	RefreshTokenPresent         bool
	RefreshToken                *string
	PasswordPresent             bool
	Password                    *string
	AccountLoginPasswordPresent bool
	AccountLoginPassword        *string
	StatusPresent               bool
	Status                      string
	ErrorMessagePresent         bool
	ErrorMessage                *string
	GroupIDPresent              bool
	GroupID                     *int64
	ProviderConfigPresent       bool
	ProviderConfig              mailProviderConfig
	ProviderConfigRaw           json.RawMessage
	CapabilitiesPresent         bool
	Capabilities                map[string]any
}

const mailAccountSelect = `
	SELECT account.id,
	       account.email,
	       account.provider::text,
	       account.auth_type::text,
	       account.client_id,
	       account.client_secret,
	       account.refresh_token,
	       account.password,
	       account.account_login_password,
	       COALESCE(account.provider_config, '{}'::jsonb),
	       COALESCE(account.capabilities, '{}'::jsonb),
	       account.status::text,
	       account.group_id,
	       group_row.name,
	       group_row.fetch_strategy::text,
	       account.last_check_at,
	       COALESCE(account.mailbox_status, '{}'::jsonb),
	       account.error_message,
	       account.created_at,
	       account.updated_at
	FROM email_accounts AS account
	LEFT JOIN email_groups AS group_row ON group_row.id = account.group_id
`

func scanMailAccount(scanner managementRowScanner) (mailAccountRow, error) {
	var row mailAccountRow
	err := scanner.Scan(
		&row.ID,
		&row.Email,
		&row.Provider,
		&row.AuthType,
		&row.ClientID,
		&row.ClientSecret,
		&row.RefreshToken,
		&row.Password,
		&row.AccountLoginPassword,
		&row.ProviderConfig,
		&row.Capabilities,
		&row.Status,
		&row.GroupID,
		&row.GroupName,
		&row.FetchStrategy,
		&row.LastCheckAt,
		&row.MailboxStatus,
		&row.ErrorMessage,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	return row, err
}

func safeMailAccount(row mailAccountRow) map[string]any {
	var providerConfig, capabilities, mailboxStatus map[string]any
	_ = json.Unmarshal(row.ProviderConfig, &providerConfig)
	_ = json.Unmarshal(row.Capabilities, &capabilities)
	_ = json.Unmarshal(row.MailboxStatus, &mailboxStatus)
	if providerConfig == nil {
		providerConfig = map[string]any{}
	}
	if capabilities == nil {
		capabilities = map[string]any{}
	}
	if mailboxStatus == nil {
		mailboxStatus = emptyMailboxStatus()
	}
	result := map[string]any{
		"id":                            row.ID,
		"email":                         row.Email,
		"provider":                      row.Provider,
		"authType":                      row.AuthType,
		"clientId":                      nullableStringValue(row.ClientID),
		"providerConfig":                providerConfig,
		"capabilities":                  capabilities,
		"status":                        row.Status,
		"groupId":                       nullableInt64Value(row.GroupID),
		"lastCheckAt":                   nullableTimeValue(row.LastCheckAt),
		"mailboxStatus":                 normalizeMailboxStatus(mailboxStatus),
		"errorMessage":                  nullableStringValue(row.ErrorMessage),
		"hasStoredPassword":             row.Password.Valid && strings.TrimSpace(row.Password.String) != "",
		"hasStoredAccountLoginPassword": row.AccountLoginPassword.Valid && strings.TrimSpace(row.AccountLoginPassword.String) != "",
		"createdAt":                     formatAPITime(row.CreatedAt),
		"updatedAt":                     formatAPITime(row.UpdatedAt),
	}
	if row.GroupID.Valid {
		result["group"] = map[string]any{
			"id":            row.GroupID.Int64,
			"name":          row.GroupName.String,
			"fetchStrategy": defaultFetchStrategy(row.FetchStrategy.String),
		}
	} else {
		result["group"] = nil
	}
	mergedProviderConfig, _ := mergeProviderConfig(row.Provider, row.ProviderConfig)
	for key, value := range providerProfileSummary(row.Provider, row.AuthType, mergedProviderConfig, row.FetchStrategy.String) {
		result[key] = value
	}
	return result
}

func (s *PostgresStore) listMailAccounts(
	ctx context.Context,
	page, pageSize int,
	status, keyword string,
	groupID *int64,
	groupName, provider, representative string,
) (map[string]any, error) {
	var groupFilter any
	if groupID != nil {
		groupFilter = *groupID
	}
	protocolExpression := `CASE WHEN account.auth_type IN ('MICROSOFT_OAUTH'::"MailAuthType", 'GOOGLE_OAUTH'::"MailAuthType") THEN 'oauth_api' ELSE 'imap_smtp' END`
	where := `
		WHERE ($1 = '' OR account.status::text = $1)
		  AND ($2 = '' OR account.email ILIKE '%' || $2 || '%')
		  AND ($3::bigint IS NULL OR account.group_id = $3)
		  AND ($4 = '' OR group_row.name = $4)
		  AND ($5 = '' OR account.provider::text = $5)
		  AND ($6 = '' OR ` + protocolExpression + ` = $6)
	`
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM email_accounts AS account
		LEFT JOIN email_groups AS group_row ON group_row.id = account.group_id
	`+where, status, keyword, groupFilter, groupName, provider, representative).Scan(&total); err != nil {
		return nil, fmt.Errorf("count mail accounts: %w", err)
	}
	rows, err := s.pool.Query(ctx, mailAccountSelect+where+`
		ORDER BY account.id DESC
		LIMIT $7 OFFSET $8
	`, status, keyword, groupFilter, groupName, provider, representative, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list mail accounts: %w", err)
	}
	defer rows.Close()
	list := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		row, err := scanMailAccount(rows)
		if err != nil {
			return nil, fmt.Errorf("scan mail account: %w", err)
		}
		list = append(list, safeMailAccount(row))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mail accounts: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (s *PostgresStore) mailAccountStats(ctx context.Context) (map[string]any, error) {
	var total, active, failed, disabled int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint,
		       COUNT(*) FILTER (WHERE status = 'ACTIVE')::bigint,
		       COUNT(*) FILTER (WHERE status = 'ERROR')::bigint,
		       COUNT(*) FILTER (WHERE status = 'DISABLED')::bigint
		FROM email_accounts
	`).Scan(&total, &active, &failed, &disabled); err != nil {
		return nil, fmt.Errorf("query mail account statistics: %w", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT provider::text, COUNT(*)::bigint FROM email_accounts GROUP BY provider ORDER BY provider`)
	if err != nil {
		return nil, fmt.Errorf("query mail provider statistics: %w", err)
	}
	defer rows.Close()
	byProvider := make(map[string]int64)
	for rows.Next() {
		var provider string
		var count int64
		if err := rows.Scan(&provider, &count); err != nil {
			return nil, err
		}
		byProvider[provider] = count
	}
	return map[string]any{"total": total, "active": active, "error": failed, "disabled": disabled, "providers": byProvider}, rows.Err()
}

func (s *PostgresStore) getMailAccount(ctx context.Context, id int64) (map[string]any, error) {
	row, err := scanMailAccount(s.pool.QueryRow(ctx, mailAccountSelect+` WHERE account.id = $1`, id))
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("NOT_FOUND")
		}
		return nil, fmt.Errorf("get mail account: %w", err)
	}
	return safeMailAccount(row), nil
}

func (s *PostgresStore) loadMailAccountCredentials(ctx context.Context, id int64, encryptionKey string) (mailAccountCredentials, error) {
	row, err := scanMailAccount(s.pool.QueryRow(ctx, mailAccountSelect+` WHERE account.id = $1`, id))
	if err != nil {
		if errorsIsNoRows(err) {
			return mailAccountCredentials{}, managementNotFound("NOT_FOUND")
		}
		return mailAccountCredentials{}, fmt.Errorf("load mail account credentials: %w", err)
	}
	decrypt := func(value sql.NullString, field string) (string, error) {
		if !value.Valid || strings.TrimSpace(value.String) == "" {
			return "", nil
		}
		plaintext, err := legacycrypto.Decrypt(encryptionKey, value.String)
		if err != nil {
			return "", &requestError{Status: http.StatusInternalServerError, Code: "EMAIL_CREDENTIAL_INVALID", Cause: fmt.Errorf("decrypt %s: %w", field, err)}
		}
		return plaintext, nil
	}
	clientSecret, err := decrypt(row.ClientSecret, "client secret")
	if err != nil {
		return mailAccountCredentials{}, err
	}
	refreshToken, err := decrypt(row.RefreshToken, "refresh token")
	if err != nil {
		return mailAccountCredentials{}, err
	}
	password, err := decrypt(row.Password, "password")
	if err != nil {
		return mailAccountCredentials{}, err
	}
	loginPassword, err := decrypt(row.AccountLoginPassword, "account login password")
	if err != nil {
		return mailAccountCredentials{}, err
	}
	config, err := mergeProviderConfig(row.Provider, row.ProviderConfig)
	if err != nil {
		return mailAccountCredentials{}, err
	}
	var capabilities, mailboxStatus map[string]any
	_ = json.Unmarshal(row.Capabilities, &capabilities)
	_ = json.Unmarshal(row.MailboxStatus, &mailboxStatus)
	return mailAccountCredentials{
		ID:                   row.ID,
		Email:                row.Email,
		Provider:             row.Provider,
		AuthType:             row.AuthType,
		ClientID:             row.ClientID.String,
		ClientSecret:         clientSecret,
		RefreshToken:         refreshToken,
		Password:             password,
		AccountLoginPassword: loginPassword,
		FetchStrategy:        defaultFetchStrategy(row.FetchStrategy.String),
		ProviderConfig:       config,
		Capabilities:         capabilities,
		Status:               row.Status,
		GroupID:              nullableInt64Value(row.GroupID),
		MailboxStatus:        normalizeMailboxStatus(mailboxStatus),
	}, nil
}

func (s *PostgresStore) loadExternalMailAccountCredentials(ctx context.Context, apiKeyID int64, email, encryptionKey string) (mailAccountCredentials, error) {
	var accountID int64
	var groupID sql.NullInt64
	if err := s.pool.QueryRow(ctx, `
		SELECT id, group_id
		FROM email_accounts
		WHERE LOWER(email) = LOWER($1)
	`, strings.TrimSpace(email)).Scan(&accountID, &groupID); err != nil {
		if errorsIsNoRows(err) {
			return mailAccountCredentials{}, managementNotFound("EMAIL_NOT_FOUND")
		}
		return mailAccountCredentials{}, fmt.Errorf("find external mail account: %w", err)
	}
	scope, err := s.loadAPIKeyScope(ctx, s.pool, apiKeyID)
	if err != nil {
		return mailAccountCredentials{}, err
	}
	if len(scope.AllowedEmailIDs) > 0 && !containsManagementID(scope.AllowedEmailIDs, accountID) {
		return mailAccountCredentials{}, &requestError{Status: http.StatusForbidden, Code: "EMAIL_ACCESS_DENIED"}
	}
	if len(scope.AllowedGroupIDs) > 0 && (!groupID.Valid || !containsManagementID(scope.AllowedGroupIDs, groupID.Int64)) {
		return mailAccountCredentials{}, &requestError{Status: http.StatusForbidden, Code: "EMAIL_ACCESS_DENIED"}
	}
	return s.loadMailAccountCredentials(ctx, accountID, encryptionKey)
}

func containsManagementID(values []int64, expected int64) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func (s *PostgresStore) createMailAccount(ctx context.Context, input mailAccountCreateInput, encryptionKey string) (map[string]any, error) {
	var err error
	input.ProviderConfig, err = s.completeOAuthAccountProviderConfig(ctx, input.Provider, input.ClientID, input.ProviderConfig)
	if err != nil {
		return nil, err
	}
	if err := validateMailAccountInput(input.Provider, input.AuthType, input.ClientID, input.RefreshToken, input.Password, input.ProviderConfig); err != nil {
		return nil, err
	}
	if err := s.ensureEmailGroup(ctx, input.GroupID); err != nil {
		return nil, err
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = "ACTIVE"
	}
	if err := validateManagementEnum("status", status, "ACTIVE", "ERROR", "DISABLED"); err != nil {
		return nil, err
	}
	providerConfig, err := marshalProviderConfig(input.ProviderConfig)
	if err != nil {
		return nil, err
	}
	capabilities, err := json.Marshal(input.Capabilities)
	if err != nil {
		return nil, validationError("capabilities must be a JSON object")
	}
	encrypt := func(value *string) (any, error) {
		if value == nil || strings.TrimSpace(*value) == "" {
			return nil, nil
		}
		return legacycrypto.Encrypt(encryptionKey, strings.TrimSpace(*value))
	}
	clientSecret, err := encrypt(input.ClientSecret)
	if err != nil {
		return nil, err
	}
	refreshToken, err := encrypt(input.RefreshToken)
	if err != nil {
		return nil, err
	}
	password, err := encrypt(input.Password)
	if err != nil {
		return nil, err
	}
	loginPassword, err := encrypt(input.AccountLoginPassword)
	if err != nil {
		return nil, err
	}
	var id int64
	err = s.pool.QueryRow(ctx, `
		INSERT INTO email_accounts (
			email, provider, auth_type, client_id, client_secret, refresh_token, password,
			account_login_password, provider_config, capabilities, status, group_id,
			mailbox_status, error_message, created_at, updated_at
		)
		VALUES ($1, $2::"MailProvider", $3::"MailAuthType", $4, $5, $6, $7, $8,
		        $9::jsonb, $10::jsonb, $11::"EmailStatus", $12, '{}'::jsonb, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, strings.ToLower(strings.TrimSpace(input.Email)), input.Provider, input.AuthType, input.ClientID,
		clientSecret, refreshToken, password, loginPassword, string(providerConfig), string(capabilities), status, input.GroupID, input.ErrorMessage).Scan(&id)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return nil, managementConflict("EMAIL_EXISTS", err)
		}
		return nil, fmt.Errorf("create mail account: %w", err)
	}
	return s.getMailAccount(ctx, id)
}

func (s *PostgresStore) completeOAuthAccountProviderConfig(
	ctx context.Context,
	provider string,
	clientID *string,
	config mailProviderConfig,
) (mailProviderConfig, error) {
	if clientID == nil || (config.OAuthTenant != "" && config.OAuthScopes != "") {
		return config, nil
	}
	row, found, err := s.loadOAuthProviderConfigRow(ctx, provider)
	if err != nil || !found || !row.ClientID.Valid || strings.TrimSpace(row.ClientID.String) != strings.TrimSpace(*clientID) {
		return config, err
	}
	if config.OAuthTenant == "" {
		config.OAuthTenant = strings.TrimSpace(row.Tenant.String)
	}
	if config.OAuthScopes == "" {
		config.OAuthScopes = strings.TrimSpace(row.Scopes.String)
	}
	return config, nil
}

func (s *PostgresStore) deleteMailAccount(ctx context.Context, id int64) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM email_accounts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete mail account: %w", err)
	}
	if command.RowsAffected() == 0 {
		return managementNotFound("NOT_FOUND")
	}
	return nil
}

func (s *PostgresStore) batchDeleteMailAccounts(ctx context.Context, ids []int64) (int64, error) {
	command, err := s.pool.Exec(ctx, `DELETE FROM email_accounts WHERE id = ANY($1::int[])`, normalizeManagementIDs(ids))
	if err != nil {
		return 0, fmt.Errorf("batch delete mail accounts: %w", err)
	}
	return command.RowsAffected(), nil
}

func (s *PostgresStore) ensureEmailGroup(ctx context.Context, groupID *int64) error {
	if groupID == nil {
		return nil
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM email_groups WHERE id = $1)`, *groupID).Scan(&exists); err != nil {
		return fmt.Errorf("check email group: %w", err)
	}
	if !exists {
		return managementNotFound("GROUP_NOT_FOUND")
	}
	return nil
}

func validateMailAccountInput(provider, authType string, clientID, refreshToken, password *string, config mailProviderConfig) error {
	if err := validateMailProvider(provider); err != nil {
		return err
	}
	if err := validateMailAuthType(authType); err != nil {
		return err
	}
	if err := validateMailAccountProfile(provider, authType, config); err != nil {
		return err
	}
	oauth := authType == "MICROSOFT_OAUTH" || authType == "GOOGLE_OAUTH"
	if oauth {
		if clientID == nil || strings.TrimSpace(*clientID) == "" {
			return validationError("clientId is required for OAuth mail accounts")
		}
		if refreshToken == nil || strings.TrimSpace(*refreshToken) == "" {
			return validationError("refreshToken is required for OAuth mail accounts")
		}
	} else if password == nil || strings.TrimSpace(*password) == "" {
		return validationError("password is required for app-password mail accounts")
	}
	return nil
}

func validateMailAccountProfile(provider, authType string, config mailProviderConfig) error {
	switch provider {
	case "OUTLOOK":
		if authType != "MICROSOFT_OAUTH" {
			return validationError("OUTLOOK requires MICROSOFT_OAUTH")
		}
	case "GMAIL":
		if authType != "GOOGLE_OAUTH" && authType != "APP_PASSWORD" {
			return validationError("GMAIL requires GOOGLE_OAUTH or APP_PASSWORD")
		}
	default:
		if authType != "APP_PASSWORD" {
			return validationError(provider + " requires APP_PASSWORD")
		}
	}
	if authType == "APP_PASSWORD" && (strings.TrimSpace(config.IMAPHost) == "" || strings.TrimSpace(config.SMTPHost) == "") {
		return validationError(provider + " requires imapHost and smtpHost")
	}
	return nil
}

func defaultFetchStrategy(value string) string {
	switch value {
	case "IMAP_FIRST", "GRAPH_ONLY", "IMAP_ONLY":
		return value
	default:
		return "GRAPH_FIRST"
	}
}
