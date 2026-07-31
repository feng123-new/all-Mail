package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

func (s *PostgresStore) updateMailAccount(ctx context.Context, id int64, input mailAccountUpdateInput, encryptionKey string) (map[string]any, error) {
	row, err := scanMailAccount(s.pool.QueryRow(ctx, mailAccountSelect+` WHERE account.id = $1`, id))
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("NOT_FOUND")
		}
		return nil, fmt.Errorf("load mail account for update: %w", err)
	}
	email := row.Email
	provider := row.Provider
	authType := row.AuthType
	clientID := row.ClientID
	clientSecret := row.ClientSecret
	refreshToken := row.RefreshToken
	password := row.Password
	loginPassword := row.AccountLoginPassword
	status := row.Status
	groupID := row.GroupID
	providerConfig := row.ProviderConfig
	capabilities := row.Capabilities

	if input.EmailPresent {
		email = strings.ToLower(strings.TrimSpace(input.Email))
	}
	if input.ProviderPresent {
		provider = input.Provider
	}
	if input.AuthTypePresent {
		authType = input.AuthType
	} else if input.ProviderPresent {
		authType = defaultMailAuthType(provider)
	}
	if input.ClientIDPresent {
		clientID = nullableSQLString(input.ClientID)
	}
	encrypt := func(value *string) (sql.NullString, error) {
		if value == nil || strings.TrimSpace(*value) == "" {
			return sql.NullString{}, nil
		}
		encrypted, err := legacycrypto.Encrypt(encryptionKey, strings.TrimSpace(*value))
		if err != nil {
			return sql.NullString{}, err
		}
		return sql.NullString{String: encrypted, Valid: true}, nil
	}
	if input.ClientSecretPresent {
		clientSecret, err = encrypt(input.ClientSecret)
		if err != nil {
			return nil, fmt.Errorf("encrypt client secret: %w", err)
		}
	}
	if input.RefreshTokenPresent {
		refreshToken, err = encrypt(input.RefreshToken)
		if err != nil {
			return nil, fmt.Errorf("encrypt refresh token: %w", err)
		}
	}
	if input.PasswordPresent {
		password, err = encrypt(input.Password)
		if err != nil {
			return nil, fmt.Errorf("encrypt password: %w", err)
		}
	}
	if input.AccountLoginPasswordPresent {
		loginPassword, err = encrypt(input.AccountLoginPassword)
		if err != nil {
			return nil, fmt.Errorf("encrypt account login password: %w", err)
		}
	}
	if input.StatusPresent {
		status = input.Status
	}
	if input.GroupIDPresent {
		groupID = nullableSQLInt64(input.GroupID)
	}
	if groupID.Valid {
		value := groupID.Int64
		if err := s.ensureEmailGroup(ctx, &value); err != nil {
			return nil, err
		}
	}
	if input.ProviderConfigPresent {
		providerConfig, err = marshalProviderConfig(input.ProviderConfig)
		if err != nil {
			return nil, err
		}
	} else if input.ProviderPresent || input.AuthTypePresent {
		config, err := mergeProviderConfig(provider, providerConfig)
		if err != nil {
			return nil, err
		}
		providerConfig, err = marshalProviderConfig(config)
		if err != nil {
			return nil, err
		}
	}
	if input.CapabilitiesPresent {
		capabilities, err = json.Marshal(input.Capabilities)
		if err != nil {
			return nil, validationError("capabilities must be a JSON object")
		}
	}
	if err := validateMailProvider(provider); err != nil {
		return nil, err
	}
	if err := validateMailAuthType(authType); err != nil {
		return nil, err
	}
	oauth := authType == "MICROSOFT_OAUTH" || authType == "GOOGLE_OAUTH"
	if oauth {
		if !clientID.Valid || strings.TrimSpace(clientID.String) == "" || !refreshToken.Valid {
			return nil, validationError("OAuth mail accounts require clientId and refreshToken")
		}
	} else if !password.Valid {
		return nil, validationError("app-password mail accounts require password")
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE email_accounts
		SET email = $2,
		    provider = $3::"MailProvider",
		    auth_type = $4::"MailAuthType",
		    client_id = $5,
		    client_secret = $6,
		    refresh_token = $7,
		    password = $8,
		    account_login_password = $9,
		    status = $10::"EmailStatus",
		    group_id = $11,
		    provider_config = $12::jsonb,
		    capabilities = $13::jsonb,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, email, provider, authType, nullableAnyString(clientID), nullableAnyString(clientSecret),
		nullableAnyString(refreshToken), nullableAnyString(password), nullableAnyString(loginPassword), status,
		nullableAnyInt64(groupID), string(providerConfig), string(capabilities))
	if err != nil {
		if managementPGCode(err) == "23505" {
			return nil, managementConflict("EMAIL_EXISTS", err)
		}
		return nil, fmt.Errorf("update mail account: %w", err)
	}
	return s.getMailAccount(ctx, id)
}

func (s *PostgresStore) updateMailAccountHealth(ctx context.Context, id int64, healthy bool, message string) error {
	status := "ERROR"
	var errorMessage any = strings.TrimSpace(message)
	if healthy {
		status = "ACTIVE"
		errorMessage = nil
	}
	command, err := s.pool.Exec(ctx, `
		UPDATE email_accounts
		SET status = $2::"EmailStatus",
		    error_message = $3,
		    last_check_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, status, errorMessage)
	if err != nil {
		return fmt.Errorf("update mail account health: %w", err)
	}
	if command.RowsAffected() == 0 {
		return managementNotFound("NOT_FOUND")
	}
	return nil
}

func (s *PostgresStore) updateMailboxSyncState(
	ctx context.Context,
	id int64,
	mailbox string,
	messages []providerMessage,
	checkpoint map[string]any,
	markAsSeen bool,
) (map[string]any, error) {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(mailbox_status, '{}'::jsonb) FROM email_accounts WHERE id = $1`, id).Scan(&raw); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("NOT_FOUND")
		}
		return nil, fmt.Errorf("load mailbox state: %w", err)
	}
	var existing map[string]any
	_ = json.Unmarshal(raw, &existing)
	status := normalizeMailboxStatus(existing)
	key := canonicalMailboxName(mailbox)
	previous, _ := status[key].(map[string]any)
	if previous == nil {
		previous = emptyMailboxState()
	}
	var latestID, latestDate any
	if len(messages) > 0 {
		latestID = messages[0].ID
		if messages[0].Date != "" {
			latestDate = messages[0].Date
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	hasNew := false
	if !markAsSeen && latestID != nil && previous["lastSyncedAt"] != nil {
		previousID, _ := previous["latestMessageId"].(string)
		if previousID != "" && previousID != latestID {
			hasNew = true
		} else if value, ok := previous["hasNew"].(bool); ok {
			hasNew = value
		}
	}
	uidValidity := previous["uidValidity"]
	lastUID := previous["lastUid"]
	if value, ok := checkpoint["uidValidity"]; ok {
		uidValidity = value
	}
	if value, ok := checkpoint["lastUid"]; ok {
		lastUID = value
	}
	lastViewedAt := previous["lastViewedAt"]
	if markAsSeen {
		lastViewedAt = now
	}
	status[key] = map[string]any{
		"latestMessageId": latestID,
		"latestMessageDate": latestDate,
		"messageCount": len(messages),
		"hasNew": hasNew,
		"lastSyncedAt": now,
		"lastViewedAt": lastViewedAt,
		"uidValidity": uidValidity,
		"lastUid": lastUID,
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		return nil, fmt.Errorf("encode mailbox state: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE email_accounts SET mailbox_status = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, string(encoded)); err != nil {
		return nil, fmt.Errorf("save mailbox state: %w", err)
	}
	return status, nil
}

func (s *PostgresStore) clearMailboxSyncState(ctx context.Context, id int64, mailbox string) (map[string]any, error) {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(mailbox_status, '{}'::jsonb) FROM email_accounts WHERE id = $1`, id).Scan(&raw); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("NOT_FOUND")
		}
		return nil, err
	}
	var existing map[string]any
	_ = json.Unmarshal(raw, &existing)
	status := normalizeMailboxStatus(existing)
	state := emptyMailboxState()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	state["lastSyncedAt"] = now
	state["lastViewedAt"] = now
	status[canonicalMailboxName(mailbox)] = state
	encoded, _ := json.Marshal(status)
	if _, err := s.pool.Exec(ctx, `UPDATE email_accounts SET mailbox_status = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, string(encoded)); err != nil {
		return nil, err
	}
	return status, nil
}

func emptyMailboxStatus() map[string]any {
	return map[string]any{"INBOX": emptyMailboxState(), "SENT": emptyMailboxState(), "Junk": emptyMailboxState()}
}

func emptyMailboxState() map[string]any {
	return map[string]any{
		"latestMessageId": nil,
		"latestMessageDate": nil,
		"messageCount": 0,
		"hasNew": false,
		"lastSyncedAt": nil,
		"lastViewedAt": nil,
		"uidValidity": nil,
		"lastUid": nil,
	}
}

func normalizeMailboxStatus(value map[string]any) map[string]any {
	result := emptyMailboxStatus()
	for _, key := range []string{"INBOX", "SENT", "Junk"} {
		source, ok := value[key].(map[string]any)
		if !ok {
			continue
		}
		state := emptyMailboxState()
		for field := range state {
			if candidate, exists := source[field]; exists {
				state[field] = candidate
			}
		}
		result[key] = state
	}
	return result
}

func canonicalMailboxName(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "sent":
		return "SENT"
	case "junk", "spam":
		return "Junk"
	default:
		return "INBOX"
	}
}
