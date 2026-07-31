package businessapi

import (
	"context"
	"fmt"
	"strings"
)

type oauthMailboxBinding struct {
	ID     int64
	Email  string
	Action string
}

func (s *PostgresStore) findOAuthMailboxByEmail(ctx context.Context, email string) (mailAccountRow, bool, error) {
	row, err := scanMailAccount(s.pool.QueryRow(ctx, mailAccountSelect+` WHERE LOWER(account.email) = LOWER($1)`, strings.TrimSpace(email)))
	if errorsIsNoRows(err) {
		return mailAccountRow{}, false, nil
	}
	if err != nil {
		return mailAccountRow{}, false, fmt.Errorf("find OAuth mailbox by email: %w", err)
	}
	return row, true, nil
}

func (s *PostgresStore) findOAuthMailboxByID(ctx context.Context, id int64) (mailAccountRow, bool, error) {
	row, err := scanMailAccount(s.pool.QueryRow(ctx, mailAccountSelect+` WHERE account.id = $1`, id))
	if errorsIsNoRows(err) {
		return mailAccountRow{}, false, nil
	}
	if err != nil {
		return mailAccountRow{}, false, fmt.Errorf("find OAuth mailbox by id: %w", err)
	}
	return row, true, nil
}

func (s *Server) bindOAuthMailbox(
	ctx context.Context,
	provider, email string,
	providerConfig oauthProviderConfig,
	refreshToken string,
	groupID, emailID *int64,
	verificationError string,
) (oauthMailboxBinding, error) {
	store, err := s.managementStore()
	if err != nil {
		return oauthMailboxBinding{}, err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	authType := defaultMailAuthType(provider)
	mailConfig := oauthBoundProviderConfig(provider, providerConfig)
	status := "ACTIVE"
	var errorMessage *string
	if strings.TrimSpace(verificationError) != "" {
		status = "ERROR"
		errorMessage = stringPointer(strings.TrimSpace(verificationError))
	}
	update := func(row mailAccountRow, action string) (oauthMailboxBinding, error) {
		input := mailAccountUpdateInput{
			EmailPresent:          true,
			Email:                 email,
			ProviderPresent:       true,
			Provider:              provider,
			AuthTypePresent:       true,
			AuthType:              authType,
			ClientIDPresent:       true,
			ClientID:              stringPointer(providerConfig.ClientID),
			ClientSecretPresent:   true,
			ClientSecret:          stringPointer(providerConfig.ClientSecret),
			RefreshTokenPresent:   true,
			RefreshToken:          stringPointer(refreshToken),
			PasswordPresent:       true,
			Password:              nil,
			StatusPresent:         true,
			Status:                status,
			ErrorMessagePresent:   true,
			ErrorMessage:          errorMessage,
			ProviderConfigPresent: true,
			ProviderConfig:        mailConfig,
		}
		if groupID != nil {
			input.GroupIDPresent = true
			input.GroupID = groupID
		}
		if _, err := store.updateMailAccount(ctx, row.ID, input, s.cfg.EncryptionKey); err != nil {
			return oauthMailboxBinding{}, err
		}
		return oauthMailboxBinding{ID: row.ID, Email: email, Action: action}, nil
	}

	if row, found, err := store.findOAuthMailboxByEmail(ctx, email); err != nil {
		return oauthMailboxBinding{}, err
	} else if found {
		return update(row, "updated_exact_email")
	}
	if emailID != nil {
		row, found, err := store.findOAuthMailboxByID(ctx, *emailID)
		if err != nil {
			return oauthMailboxBinding{}, err
		}
		if found && strings.EqualFold(strings.TrimSpace(row.Email), email) {
			return update(row, "updated_target_id")
		}
	}
	created, err := store.createMailAccount(ctx, mailAccountCreateInput{
		Email:          email,
		Provider:       provider,
		AuthType:       authType,
		ClientID:       stringPointer(providerConfig.ClientID),
		ClientSecret:   stringPointer(providerConfig.ClientSecret),
		RefreshToken:   stringPointer(refreshToken),
		GroupID:        groupID,
		ProviderConfig: mailConfig,
		Capabilities:   map[string]any{},
		Status:         status,
		ErrorMessage:   errorMessage,
	}, s.cfg.EncryptionKey)
	if err != nil {
		return oauthMailboxBinding{}, err
	}
	id, ok := created["id"].(int64)
	if !ok {
		return oauthMailboxBinding{}, fmt.Errorf("created OAuth mailbox returned invalid id")
	}
	return oauthMailboxBinding{ID: id, Email: email, Action: "created_new_email"}, nil
}

func oauthBoundProviderConfig(provider string, config oauthProviderConfig) mailProviderConfig {
	result := defaultProviderConfig(provider)
	result.OAuthTenant = strings.TrimSpace(config.Tenant)
	result.OAuthScopes = strings.TrimSpace(config.Scopes)
	return result
}
