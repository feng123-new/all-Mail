package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type oauthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

func (s *Server) refreshProviderAccessToken(ctx context.Context, account mailAccountCredentials, requestedScope ...string) (string, error) {
	if s.providerTokenSource != nil {
		return s.providerTokenSource(ctx, account)
	}
	if strings.TrimSpace(account.RefreshToken) == "" {
		return "", providerFailure("OAUTH_REFRESH_TOKEN_MISSING", fmt.Errorf("refresh token is missing"))
	}
	config := oauthProviderConfig{
		Provider: account.Provider,
		Tenant:   account.ProviderConfig.OAuthTenant,
		Scopes:   account.ProviderConfig.OAuthScopes,
	}
	if strings.TrimSpace(account.ClientID) == "" {
		store, err := s.managementStore()
		if err != nil {
			return "", err
		}
		databaseCtx, cancelDatabase := s.databaseContext(ctx)
		config, _, err = store.loadOAuthProviderRefreshConfig(databaseCtx, account.Provider, s.cfg.EncryptionKey)
		cancelDatabase()
		if err != nil {
			return "", err
		}
	}
	clientID, clientSecret, err := resolveOAuthClientCredentials(account, config)
	if err != nil {
		return "", err
	}
	values := url.Values{
		"client_id":     {clientID},
		"refresh_token": {account.RefreshToken},
		"grant_type":    {"refresh_token"},
	}
	if clientSecret != "" {
		values.Set("client_secret", clientSecret)
	}
	endpoint := "https://oauth2.googleapis.com/token"
	if account.Provider == "OUTLOOK" {
		tenant := strings.TrimSpace(config.Tenant)
		if tenant == "" {
			tenant = "consumers"
		}
		endpoint = "https://login.microsoftonline.com/" + url.PathEscape(tenant) + "/oauth2/v2.0/token"
		if len(requestedScope) > 0 && strings.TrimSpace(requestedScope[0]) != "" {
			values.Set("scope", strings.TrimSpace(requestedScope[0]))
		} else if strings.TrimSpace(config.Scopes) != "" {
			values.Set("scope", config.Scopes)
		}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return "", providerFailure("OAUTH_TOKEN_REFRESH_FAILED", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.doProviderRequest(account, request)
	if err != nil {
		return "", providerFailure("OAUTH_TOKEN_REFRESH_FAILED", err)
	}
	defer response.Body.Close()
	var token oauthTokenResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&token); err != nil {
		return "", providerFailure("OAUTH_TOKEN_RESPONSE_INVALID", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || strings.TrimSpace(token.AccessToken) == "" {
		message := strings.TrimSpace(strings.Join([]string{token.Error, token.Description}, " "))
		if message == "" {
			message = response.Status
		}
		return "", providerFailure("OAUTH_TOKEN_REFRESH_FAILED", fmt.Errorf("%s", message))
	}
	if account.ID > 0 && token.RefreshToken != "" && token.RefreshToken != account.RefreshToken {
		store, err := s.managementStore()
		if err != nil {
			return "", err
		}
		databaseCtx, cancelDatabase := s.databaseContext(context.WithoutCancel(ctx))
		defer cancelDatabase()
		if err := store.updateEncryptedRefreshToken(databaseCtx, account.ID, token.RefreshToken, s.cfg.EncryptionKey); err != nil {
			return "", err
		}
	}
	return token.AccessToken, nil
}

func resolveOAuthClientCredentials(account mailAccountCredentials, config oauthProviderConfig) (string, string, error) {
	clientID := strings.TrimSpace(account.ClientID)
	clientSecret := strings.TrimSpace(account.ClientSecret)
	if clientID == "" {
		clientID = strings.TrimSpace(config.ClientID)
		clientSecret = strings.TrimSpace(config.ClientSecret)
	}
	if clientID == "" {
		return "", "", providerFailure("OAUTH_CLIENT_ID_MISSING", fmt.Errorf("OAuth client id is missing"))
	}
	return clientID, clientSecret, nil
}
