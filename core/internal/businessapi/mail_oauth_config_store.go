package businessapi

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"

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

func (s *PostgresStore) loadOAuthProviderConfig(ctx context.Context, provider, encryptionKey string) (oauthProviderConfig, error) {
	var config oauthProviderConfig
	var encryptedSecret, redirectURI, scopes, tenant sql.NullString
	err := s.pool.QueryRow(ctx, `
		SELECT provider::text, COALESCE(client_id, ''), client_secret, redirect_uri, scopes, tenant
		FROM provider_oauth_configs
		WHERE provider = $1::"MailProvider"
	`, provider).Scan(
		&config.Provider,
		&config.ClientID,
		&encryptedSecret,
		&redirectURI,
		&scopes,
		&tenant,
	)
	if err != nil {
		if errorsIsNoRows(err) {
			return oauthProviderConfig{}, managementNotFound("OAUTH_CONFIG_NOT_FOUND")
		}
		return oauthProviderConfig{}, fmt.Errorf("load OAuth provider config: %w", err)
	}
	if encryptedSecret.Valid {
		decrypted, err := legacycrypto.Decrypt(encryptionKey, encryptedSecret.String)
		if err != nil {
			return oauthProviderConfig{}, &requestError{Status: http.StatusInternalServerError, Code: "OAUTH_CONFIG_INVALID", Cause: err}
		}
		config.ClientSecret = decrypted
	}
	if redirectURI.Valid {
		config.RedirectURI = redirectURI.String
	}
	if scopes.Valid {
		config.Scopes = scopes.String
	}
	if tenant.Valid {
		config.Tenant = tenant.String
	}
	if config.ClientID == "" || config.ClientSecret == "" || config.RedirectURI == "" {
		return oauthProviderConfig{}, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_NOT_CONFIGURED"}
	}
	return config, nil
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
