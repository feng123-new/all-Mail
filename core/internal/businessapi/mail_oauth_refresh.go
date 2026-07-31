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

func (s *Server) refreshProviderAccessToken(ctx context.Context, account mailAccountCredentials) (string, error) {
	if strings.TrimSpace(account.RefreshToken) == "" {
		return "", providerFailure("OAUTH_REFRESH_TOKEN_MISSING", fmt.Errorf("refresh token is missing"))
	}
	store, err := s.managementStore()
	if err != nil {
		return "", err
	}
	config, err := store.loadOAuthProviderConfig(ctx, account.Provider, s.cfg.EncryptionKey)
	if err != nil {
		return "", err
	}
	values := url.Values{
		"client_id":     {config.ClientID},
		"client_secret": {config.ClientSecret},
		"refresh_token": {account.RefreshToken},
		"grant_type":    {"refresh_token"},
	}
	endpoint := "https://oauth2.googleapis.com/token"
	if account.Provider == "OUTLOOK" {
		tenant := strings.TrimSpace(config.Tenant)
		if tenant == "" {
			tenant = "common"
		}
		endpoint = "https://login.microsoftonline.com/" + url.PathEscape(tenant) + "/oauth2/v2.0/token"
		if strings.TrimSpace(config.Scopes) != "" {
			values.Set("scope", config.Scopes)
		}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return "", providerFailure("OAUTH_TOKEN_REFRESH_FAILED", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.providerClient().Do(request)
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
	if token.RefreshToken != "" && token.RefreshToken != account.RefreshToken {
		if err := store.updateEncryptedRefreshToken(ctx, account.ID, token.RefreshToken, s.cfg.EncryptionKey); err != nil {
			return "", err
		}
	}
	return token.AccessToken, nil
}
