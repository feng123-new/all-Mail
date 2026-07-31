package businessapi

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

type oauthProviderConfig struct {
	Provider     string
	ClientID     string
	ClientSecret string
	RedirectURI  string
	Scopes       string
	Tenant       string
}

type oauthProviderConfigSummary struct {
	Provider        string  `json:"provider"`
	Configured      bool    `json:"configured"`
	Source          string  `json:"source"`
	ClientID        *string `json:"clientId"`
	RedirectURI     *string `json:"redirectUri"`
	Scopes          *string `json:"scopes"`
	Tenant          *string `json:"tenant"`
	HasClientSecret bool    `json:"hasClientSecret"`
}

type oauthProviderConfigUpdate struct {
	ClientIDPresent     bool
	ClientID            *string
	ClientSecretPresent bool
	ClientSecret        *string
	RedirectURIPresent  bool
	RedirectURI         *string
	ScopesPresent       bool
	Scopes              *string
	TenantPresent       bool
	Tenant              *string
}

type oauthProviderConfigRow struct {
	Provider              string
	ClientID              sql.NullString
	EncryptedClientSecret sql.NullString
	RedirectURI           sql.NullString
	Scopes                sql.NullString
	Tenant                sql.NullString
}

func oauthConfigSummary(row oauthProviderConfigRow, found bool) oauthProviderConfigSummary {
	if !found {
		return oauthProviderConfigSummary{Provider: row.Provider, Source: "none"}
	}
	return oauthProviderConfigSummary{
		Provider:        row.Provider,
		Configured:      row.ClientID.Valid && strings.TrimSpace(row.ClientID.String) != "" && row.EncryptedClientSecret.Valid && strings.TrimSpace(row.EncryptedClientSecret.String) != "" && row.RedirectURI.Valid && strings.TrimSpace(row.RedirectURI.String) != "",
		Source:          "database",
		ClientID:        nullableStringValue(row.ClientID),
		RedirectURI:     nullableStringValue(row.RedirectURI),
		Scopes:          nullableStringValue(row.Scopes),
		Tenant:          nullableStringValue(row.Tenant),
		HasClientSecret: row.EncryptedClientSecret.Valid && strings.TrimSpace(row.EncryptedClientSecret.String) != "",
	}
}

func (s *PostgresStore) loadOAuthProviderConfigRow(ctx context.Context, provider string) (oauthProviderConfigRow, bool, error) {
	row := oauthProviderConfigRow{Provider: provider}
	err := s.pool.QueryRow(ctx, `
		SELECT provider::text, client_id, client_secret, redirect_uri, scopes, tenant
		FROM provider_oauth_configs
		WHERE provider = $1::"MailProvider"
	`, provider).Scan(&row.Provider, &row.ClientID, &row.EncryptedClientSecret, &row.RedirectURI, &row.Scopes, &row.Tenant)
	if errorsIsNoRows(err) {
		return row, false, nil
	}
	if err != nil {
		return oauthProviderConfigRow{}, false, fmt.Errorf("load OAuth provider configuration: %w", err)
	}
	return row, true, nil
}

func (s *PostgresStore) listOAuthProviderConfigSummaries(ctx context.Context) (map[string]oauthProviderConfigSummary, error) {
	result := make(map[string]oauthProviderConfigSummary, 2)
	for _, provider := range []string{"GMAIL", "OUTLOOK"} {
		row, found, err := s.loadOAuthProviderConfigRow(ctx, provider)
		if err != nil {
			return nil, err
		}
		result[provider] = oauthConfigSummary(row, found)
	}
	return result, nil
}

func (s *PostgresStore) saveOAuthProviderConfig(ctx context.Context, provider string, input oauthProviderConfigUpdate, encryptionKey string) (oauthProviderConfigSummary, error) {
	row, found, err := s.loadOAuthProviderConfigRow(ctx, provider)
	if err != nil {
		return oauthProviderConfigSummary{}, err
	}
	if !found {
		row.Provider = provider
	}
	if input.ClientIDPresent {
		row.ClientID = nullableSQLString(input.ClientID)
	}
	if input.RedirectURIPresent {
		row.RedirectURI = nullableSQLString(input.RedirectURI)
	}
	if input.ScopesPresent {
		row.Scopes = nullableSQLString(input.Scopes)
	}
	if provider == "OUTLOOK" && input.TenantPresent {
		row.Tenant = nullableSQLString(input.Tenant)
	} else if provider == "GMAIL" {
		row.Tenant = sql.NullString{}
	}
	if input.ClientSecretPresent {
		row.EncryptedClientSecret = sql.NullString{}
		if input.ClientSecret != nil && strings.TrimSpace(*input.ClientSecret) != "" {
			encrypted, err := legacycrypto.Encrypt(encryptionKey, strings.TrimSpace(*input.ClientSecret))
			if err != nil {
				return oauthProviderConfigSummary{}, fmt.Errorf("encrypt OAuth client secret: %w", err)
			}
			row.EncryptedClientSecret = sql.NullString{String: encrypted, Valid: true}
		}
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO provider_oauth_configs (
			provider, client_id, client_secret, redirect_uri, scopes, tenant, created_at, updated_at
		)
		VALUES ($1::"MailProvider", $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT (provider) DO UPDATE SET
			client_id = EXCLUDED.client_id,
			client_secret = EXCLUDED.client_secret,
			redirect_uri = EXCLUDED.redirect_uri,
			scopes = EXCLUDED.scopes,
			tenant = EXCLUDED.tenant,
			updated_at = CURRENT_TIMESTAMP
	`, provider, nullableAnyString(row.ClientID), nullableAnyString(row.EncryptedClientSecret), nullableAnyString(row.RedirectURI), nullableAnyString(row.Scopes), nullableAnyString(row.Tenant)); err != nil {
		return oauthProviderConfigSummary{}, fmt.Errorf("save OAuth provider configuration: %w", err)
	}
	return oauthConfigSummary(row, true), nil
}

func (s *PostgresStore) loadOAuthProviderConfig(ctx context.Context, provider, encryptionKey string) (oauthProviderConfig, error) {
	config, found, err := s.loadOAuthProviderRefreshConfig(ctx, provider, encryptionKey)
	if err != nil {
		return oauthProviderConfig{}, err
	}
	if !found {
		return oauthProviderConfig{}, managementNotFound("OAUTH_CONFIG_NOT_FOUND")
	}
	if config.ClientID == "" || config.ClientSecret == "" || config.RedirectURI == "" {
		return oauthProviderConfig{}, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_NOT_CONFIGURED"}
	}
	return config, nil
}

func (s *PostgresStore) loadOAuthProviderRefreshConfig(ctx context.Context, provider, encryptionKey string) (oauthProviderConfig, bool, error) {
	row, found, err := s.loadOAuthProviderConfigRow(ctx, provider)
	if err != nil || !found {
		return oauthProviderConfig{Provider: provider}, found, err
	}
	config := oauthProviderConfig{
		Provider:    row.Provider,
		ClientID:    strings.TrimSpace(row.ClientID.String),
		RedirectURI: strings.TrimSpace(row.RedirectURI.String),
		Scopes:      strings.TrimSpace(row.Scopes.String),
		Tenant:      strings.TrimSpace(row.Tenant.String),
	}
	if row.EncryptedClientSecret.Valid && strings.TrimSpace(row.EncryptedClientSecret.String) != "" {
		decrypted, err := legacycrypto.Decrypt(encryptionKey, row.EncryptedClientSecret.String)
		if err != nil {
			return oauthProviderConfig{}, false, &requestError{Status: http.StatusInternalServerError, Code: "OAUTH_CONFIG_INVALID", Cause: err}
		}
		config.ClientSecret = decrypted
	}
	return config, true, nil
}

func (s *PostgresStore) updateEncryptedRefreshToken(ctx context.Context, accountID int64, refreshToken, encryptionKey string) error {
	encrypted, err := legacycrypto.Encrypt(encryptionKey, refreshToken)
	if err != nil {
		return fmt.Errorf("encrypt rotated refresh token: %w", err)
	}
	command, err := s.pool.Exec(ctx, `
		UPDATE email_accounts
		SET refresh_token = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, accountID, encrypted)
	if err != nil {
		return fmt.Errorf("update rotated refresh token: %w", err)
	}
	if command.RowsAffected() == 0 {
		return managementNotFound("EMAIL_NOT_FOUND")
	}
	return nil
}
