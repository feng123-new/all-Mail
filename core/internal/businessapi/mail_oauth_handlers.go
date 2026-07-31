package businessapi

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	googleAuthorizationURL = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL         = "https://oauth2.googleapis.com/token"
	googleUserInfoURL      = "https://openidconnect.googleapis.com/v1/userinfo"
	googleGmailProfileURL  = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
	microsoftGraphMeURL    = "https://graph.microsoft.com/v1.0/me?$select=mail"
	googleDefaultScopes    = "openid email profile https://www.googleapis.com/auth/gmail.modify https://mail.google.com/"
	microsoftDefaultScopes = "offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send"
)

type oauthStartRequest struct {
	GroupID *int64 `json:"groupId"`
	EmailID *int64 `json:"emailId"`
}

type oauthConfigRequest struct {
	ClientID     json.RawMessage `json:"clientId"`
	ClientSecret json.RawMessage `json:"clientSecret"`
	RedirectURI  json.RawMessage `json:"redirectUri"`
	Scopes       json.RawMessage `json:"scopes"`
	Tenant       json.RawMessage `json:"tenant"`
}

type googleClientSecretRequest struct {
	FilePath    *string `json:"filePath"`
	JSONText    *string `json:"jsonText"`
	CallbackURI *string `json:"callbackUri"`
}

type googleClientSecretDocument struct {
	Web *struct {
		ClientID     string   `json:"client_id"`
		ClientSecret string   `json:"client_secret"`
		RedirectURIs []string `json:"redirect_uris"`
		ProjectID    string   `json:"project_id"`
	} `json:"web"`
}

func (s *Server) registerOAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/oauth/providers", s.withAdministrator(s.oauthProviderSummaries))
	mux.HandleFunc("GET /admin/oauth/configs", s.withAdministrator(s.oauthProviderSummaries))
	mux.HandleFunc("PUT /admin/oauth/configs/{provider}", s.withAdministrator(s.updateOAuthProviderConfig))
	mux.HandleFunc("POST /admin/oauth/google/parse-client-secret", s.withAdministrator(s.parseGoogleClientSecret))
	mux.HandleFunc("POST /admin/oauth/{provider}/start", s.withAdministrator(s.startOAuthAuthorization))
	mux.HandleFunc("GET /admin/oauth/{provider}/status", s.withAdministrator(s.oauthAuthorizationStatus))
	mux.HandleFunc("GET /admin/oauth/{provider}/callback", s.withProviderRequest(s.oauthAuthorizationCallback))
	mux.HandleFunc("GET /oauth", s.withProviderRequest(s.oauthCompatibilityCallback))
}

func parseOAuthProvider(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "GMAIL", "GOOGLE":
		return "GMAIL", nil
	case "OUTLOOK", "MICROSOFT":
		return "OUTLOOK", nil
	default:
		return "", &requestError{Status: http.StatusBadRequest, Code: "OAUTH_PROVIDER_UNSUPPORTED"}
	}
}

func (s *Server) oauthProviderSummaries(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.listOAuthProviderConfigSummaries(r.Context())
	if err != nil {
		s.writeStoreError(w, r, "list OAuth provider configurations", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateOAuthProviderConfig(w http.ResponseWriter, r *http.Request, _ Admin) {
	provider, err := parseOAuthProvider(r.PathValue("provider"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body oauthConfigRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	clientID, clientIDPresent, err := decodeNullableString(body.ClientID, "clientId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	clientSecret, clientSecretPresent, err := decodeNullableString(body.ClientSecret, "clientSecret")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	redirectURI, redirectPresent, err := decodeNullableString(body.RedirectURI, "redirectUri")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if redirectURI != nil && *redirectURI != "" {
		parsed, parseErr := url.Parse(*redirectURI)
		if parseErr != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			s.writeRequestError(w, r, validationError("redirectUri must be an absolute HTTP or HTTPS URL"))
			return
		}
		if provider == "OUTLOOK" && parsed.Scheme == "https" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1") {
			parsed.Scheme = "http"
			normalized := parsed.String()
			redirectURI = &normalized
		}
	}
	scopes, scopesPresent, err := decodeNullableString(body.Scopes, "scopes")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if scopes != nil {
		normalized := strings.Join(strings.Fields(*scopes), " ")
		scopes = &normalized
	}
	tenant, tenantPresent, err := decodeNullableString(body.Tenant, "tenant")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.saveOAuthProviderConfig(r.Context(), provider, oauthProviderConfigUpdate{
		ClientIDPresent: clientIDPresent, ClientID: clientID,
		ClientSecretPresent: clientSecretPresent, ClientSecret: clientSecret,
		RedirectURIPresent: redirectPresent, RedirectURI: redirectURI,
		ScopesPresent: scopesPresent, Scopes: scopes,
		TenantPresent: tenantPresent, Tenant: tenant,
	}, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "save OAuth provider configuration", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) parseGoogleClientSecret(w http.ResponseWriter, r *http.Request, _ Admin) {
	var body googleClientSecretRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	jsonText := ""
	if body.JSONText != nil {
		jsonText = strings.TrimSpace(*body.JSONText)
	}
	if jsonText == "" && body.FilePath != nil && strings.TrimSpace(*body.FilePath) != "" {
		file, err := os.Open(strings.TrimSpace(*body.FilePath))
		if err != nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_CLIENT_SECRET_PATH_UNREADABLE", Cause: err})
			return
		}
		content, readErr := io.ReadAll(io.LimitReader(file, 1<<20))
		closeErr := file.Close()
		if readErr != nil || closeErr != nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_CLIENT_SECRET_PATH_UNREADABLE", Cause: errors.Join(readErr, closeErr)})
			return
		}
		jsonText = string(content)
	}
	if jsonText == "" || len(jsonText) > 1<<20 {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_CLIENT_SECRET_SOURCE_REQUIRED"})
		return
	}
	var document googleClientSecretDocument
	if err := json.Unmarshal([]byte(jsonText), &document); err != nil || document.Web == nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_CLIENT_SECRET_JSON_INVALID", Cause: err})
		return
	}
	redirectURIs := normalizeManagementStrings(document.Web.RedirectURIs)
	if strings.TrimSpace(document.Web.ClientID) == "" || strings.TrimSpace(document.Web.ClientSecret) == "" || len(redirectURIs) == 0 {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_CLIENT_SECRET_JSON_INVALID"})
		return
	}
	redirectURI := redirectURIs[0]
	if body.CallbackURI != nil && strings.TrimSpace(*body.CallbackURI) != "" {
		redirectURI = strings.TrimSpace(*body.CallbackURI)
		matched := false
		for _, candidate := range redirectURIs {
			if candidate == redirectURI {
				matched = true
				break
			}
		}
		if !matched {
			s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_REDIRECT_URI_MISMATCH"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"clientId": strings.TrimSpace(document.Web.ClientID), "clientSecret": strings.TrimSpace(document.Web.ClientSecret),
		"redirectUri": redirectURI, "redirectUris": redirectURIs, "projectId": nullIfEmpty(strings.TrimSpace(document.Web.ProjectID)),
	}})
}

func (s *Server) startOAuthAuthorization(w http.ResponseWriter, r *http.Request, admin Admin) {
	provider, err := parseOAuthProvider(r.PathValue("provider"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body oauthStartRequest
	if err := decodeJSONBody(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.GroupID != nil && *body.GroupID <= 0 || body.EmailID != nil && *body.EmailID <= 0 {
		s.writeRequestError(w, r, validationError("groupId and emailId must be positive integers"))
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	providerConfig, err := store.loadOAuthProviderConfig(r.Context(), provider, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "load OAuth provider configuration", err)
		return
	}
	stateBytes := make([]byte, 24)
	if _, err := rand.Read(stateBytes); err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "OAUTH_STATE_GENERATION_FAILED", Cause: err})
		return
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)
	createdAt := s.now().UnixMilli()
	if err := s.saveOAuthState(r.Context(), state, oauthStateRecord{
		AdminID: admin.ID, Provider: provider, GroupID: body.GroupID, EmailID: body.EmailID, CreatedAt: createdAt,
	}); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"provider": provider, "state": state, "authUrl": buildOAuthAuthorizationURL(providerConfig, state),
		"expiresIn": int(oauthStateTTL / time.Second), "expiresAt": createdAt + oauthStateTTL.Milliseconds(),
	}})
}

func (s *Server) oauthAuthorizationStatus(w http.ResponseWriter, r *http.Request, admin Admin) {
	provider, err := parseOAuthProvider(r.PathValue("provider"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state == "" || len(state) > 256 {
		s.writeRequestError(w, r, validationError("state is required"))
		return
	}
	if completed, found, err := s.getOAuthStatus(r.Context(), state); err != nil {
		s.writeRequestError(w, r, err)
		return
	} else if found && completed.Provider == provider {
		if completed.AdminID != admin.ID {
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "OAUTH_STATUS_FORBIDDEN"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
			"provider": provider, "state": state, "status": completed.Phase, "expiresAt": completed.ExpiresAt,
			"completedAt": completed.CompletedAt, "result": completed.Result,
		}})
		return
	}
	pending, found, err := s.peekOAuthState(r.Context(), state)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if !found || pending.Provider != provider {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"provider": provider, "state": state, "status": "expired"}})
		return
	}
	if pending.AdminID != admin.ID {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "OAUTH_STATUS_FORBIDDEN"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"provider": provider, "state": state, "status": "pending", "expiresAt": pending.CreatedAt + oauthStateTTL.Milliseconds(),
	}})
}

func (s *Server) oauthAuthorizationCallback(w http.ResponseWriter, r *http.Request) {
	provider, err := parseOAuthProvider(r.PathValue("provider"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	s.completeOAuthCallback(w, r, provider)
}

func (s *Server) oauthCompatibilityCallback(w http.ResponseWriter, r *http.Request) {
	s.completeOAuthCallback(w, r, "OUTLOOK")
}

func (s *Server) completeOAuthCallback(w http.ResponseWriter, r *http.Request, provider string) {
	result, err := s.completeOAuthAuthorization(r, provider)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	http.Redirect(w, r, oauthCallbackRedirectURL(result), http.StatusFound)
}

func (s *Server) completeOAuthAuthorization(r *http.Request, provider string) (oauthCompletionResult, error) {
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state == "" {
		return oauthCompletionResult{Provider: provider, Status: "error", Code: "OAUTH_CALLBACK_MISSING_STATE"}, nil
	}
	record, found, err := s.takeOAuthState(r.Context(), state)
	if err != nil {
		return oauthCompletionResult{}, err
	}
	if !found || record.Provider != provider {
		return oauthCompletionResult{Provider: provider, Status: "error", Code: "OAUTH_STATE_INVALID"}, nil
	}
	now := s.now().UnixMilli()
	if err := s.saveOAuthStatus(r.Context(), state, oauthStatusSnapshot{
		AdminID: record.AdminID, Provider: provider, Phase: "processing", CreatedAt: record.CreatedAt, ExpiresAt: now + oauthResultTTL.Milliseconds(),
	}); err != nil {
		return oauthCompletionResult{}, err
	}
	finish := func(result oauthCompletionResult) (oauthCompletionResult, error) {
		completedAt := s.now().UnixMilli()
		if err := s.saveOAuthStatus(r.Context(), state, oauthStatusSnapshot{
			AdminID: record.AdminID, Provider: provider, Phase: "completed", CreatedAt: record.CreatedAt,
			ExpiresAt: completedAt + oauthResultTTL.Milliseconds(), CompletedAt: completedAt, Result: &result,
		}); err != nil {
			return oauthCompletionResult{}, err
		}
		return result, nil
	}
	if strings.TrimSpace(r.URL.Query().Get("error")) != "" {
		return finish(oauthCompletionResult{Provider: provider, Status: "error", Code: "OAUTH_PROVIDER_AUTH_FAILED"})
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		return finish(oauthCompletionResult{Provider: provider, Status: "error", Code: "OAUTH_CALLBACK_MISSING_CODE"})
	}

	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	store, storeErr := s.managementStore()
	var providerConfig oauthProviderConfig
	if storeErr == nil {
		providerConfig, storeErr = store.loadOAuthProviderConfig(databaseCtx, provider, s.cfg.EncryptionKey)
	}
	cancelDatabase()
	if storeErr != nil {
		result := oauthCompletionResult{Provider: provider, Status: "error", Code: oauthErrorCode(storeErr)}
		return finish(result)
	}
	tokenPayload, remoteErr := s.exchangeOAuthCode(r, providerConfig, code)
	if remoteErr != nil {
		return finish(oauthCompletionResult{Provider: provider, Status: "error", Code: oauthErrorCode(remoteErr)})
	}
	accessToken := oauthPayloadString(tokenPayload, "access_token")
	refreshToken := oauthPayloadString(tokenPayload, "refresh_token")
	if accessToken == "" {
		return finish(oauthCompletionResult{Provider: provider, Status: "error", Code: "OAUTH_ACCESS_TOKEN_MISSING"})
	}
	if refreshToken == "" {
		return finish(oauthCompletionResult{Provider: provider, Status: "error", Code: "OAUTH_REFRESH_TOKEN_MISSING"})
	}
	email, remoteErr := s.verifyOAuthRemoteIdentity(r, provider, accessToken)
	if remoteErr != nil {
		return finish(oauthCompletionResult{Provider: provider, Status: "error", Code: oauthErrorCode(remoteErr)})
	}
	verifyErr := s.verifyOAuthMailboxAccess(r, provider, accessToken)
	verificationError := ""
	if verifyErr != nil {
		verificationError = boundedProviderError(verifyErr)
	}
	databaseCtx, cancelDatabase = s.databaseContext(r.Context())
	binding, bindErr := s.bindOAuthMailbox(databaseCtx, provider, email, providerConfig, refreshToken, record.GroupID, record.EmailID, verificationError)
	cancelDatabase()
	if bindErr != nil {
		return finish(oauthCompletionResult{Provider: provider, Status: "error", Code: oauthErrorCode(bindErr)})
	}
	if verifyErr != nil {
		return finish(oauthCompletionResult{
			Provider: provider, Status: "warning", Code: "OAUTH_AUTHORIZED_VERIFY_FAILED", Email: binding.Email, Action: binding.Action,
		})
	}
	return finish(oauthCompletionResult{Provider: provider, Status: "success", Code: "OAUTH_AUTHORIZED_SUCCESS", Email: binding.Email, Action: binding.Action})
}

func (s *Server) verifyOAuthMailboxAccess(r *http.Request, provider, accessToken string) error {
	endpoint := "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=1"
	code := "GMAIL_MAILBOX_VERIFY_FAILED"
	if provider == "OUTLOOK" {
		endpoint = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=1&$select=id"
		code = "MICROSOFT_MAILBOX_VERIFY_FAILED"
	}
	if _, err := s.oauthRequestJSON(r, http.MethodGet, endpoint, "", "", accessToken); err != nil {
		return &requestError{Status: http.StatusBadGateway, Code: code, Cause: err}
	}
	return nil
}

func (s *Server) exchangeOAuthCode(r *http.Request, config oauthProviderConfig, code string) (map[string]any, error) {
	values := url.Values{
		"client_id": {config.ClientID}, "client_secret": {config.ClientSecret}, "code": {code},
		"redirect_uri": {config.RedirectURI}, "grant_type": {"authorization_code"},
	}
	endpoint := googleTokenURL
	if config.Provider == "OUTLOOK" {
		tenant := strings.TrimSpace(config.Tenant)
		if tenant == "" {
			tenant = "consumers"
		}
		endpoint = "https://login.microsoftonline.com/" + url.PathEscape(tenant) + "/oauth2/v2.0/token"
		values.Set("scope", oauthScopes(config))
	}
	return s.oauthRequestJSON(r, http.MethodPost, endpoint, values.Encode(), "application/x-www-form-urlencoded", "")
}

func (s *Server) verifyOAuthRemoteIdentity(r *http.Request, provider, accessToken string) (string, error) {
	if provider == "GMAIL" {
		userInfo, err := s.oauthRequestJSON(r, http.MethodGet, googleUserInfoURL, "", "", accessToken)
		if err != nil {
			return "", &requestError{Status: http.StatusBadGateway, Code: "GOOGLE_USERINFO_FAILED", Cause: err}
		}
		userInfoEmail := strings.ToLower(strings.TrimSpace(oauthPayloadString(userInfo, "email")))
		if err := validateEmailAddress(userInfoEmail); err != nil {
			return "", &requestError{Status: http.StatusBadGateway, Code: "GOOGLE_USERINFO_EMAIL_MISSING", Cause: err}
		}
		profile, err := s.oauthRequestJSON(r, http.MethodGet, googleGmailProfileURL, "", "", accessToken)
		if err != nil {
			return "", &requestError{Status: http.StatusBadGateway, Code: "GMAIL_PROFILE_FAILED", Cause: err}
		}
		profileEmail := strings.ToLower(strings.TrimSpace(oauthPayloadString(profile, "emailAddress")))
		if err := validateEmailAddress(profileEmail); err != nil {
			return "", &requestError{Status: http.StatusBadGateway, Code: "GMAIL_PROFILE_EMAIL_MISSING", Cause: err}
		}
		if userInfoEmail != profileEmail {
			return "", &requestError{Status: http.StatusBadGateway, Code: "GOOGLE_EMAIL_MISMATCH"}
		}
		return profileEmail, nil
	}
	profile, err := s.oauthRequestJSON(r, http.MethodGet, microsoftGraphMeURL, "", "", accessToken)
	if err != nil {
		return "", &requestError{Status: http.StatusBadGateway, Code: "MICROSOFT_GRAPH_PROFILE_FAILED", Cause: err}
	}
	email := strings.ToLower(strings.TrimSpace(oauthPayloadString(profile, "mail")))
	if err := validateEmailAddress(email); err != nil {
		return "", &requestError{Status: http.StatusBadGateway, Code: "MICROSOFT_GRAPH_MAIL_MISSING", Cause: err}
	}
	return email, nil
}

func (s *Server) oauthRequestJSON(r *http.Request, method, endpoint, body, contentType, accessToken string) (map[string]any, error) {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequestWithContext(r.Context(), method, endpoint, reader)
	if err != nil {
		return nil, providerFailure("OAUTH_REMOTE_REQUEST_FAILED", err)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}
	response, err := s.providerClient().Do(request)
	if err != nil {
		return nil, providerFailure("OAUTH_REMOTE_REQUEST_FAILED", err)
	}
	defer response.Body.Close()
	content, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, providerFailure("OAUTH_REMOTE_RESPONSE_INVALID", err)
	}
	var payload map[string]any
	if len(content) > 0 {
		if err := json.Unmarshal(content, &payload); err != nil {
			return nil, providerFailure("OAUTH_REMOTE_RESPONSE_INVALID", err)
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, providerFailure("OAUTH_REMOTE_REQUEST_FAILED", fmt.Errorf("provider returned %d", response.StatusCode))
	}
	if payload == nil {
		payload = map[string]any{}
	}
	return payload, nil
}

func buildOAuthAuthorizationURL(config oauthProviderConfig, state string) string {
	endpoint := googleAuthorizationURL
	values := url.Values{
		"client_id": {config.ClientID}, "redirect_uri": {config.RedirectURI}, "response_type": {"code"},
		"scope": {oauthScopes(config)}, "state": {state},
	}
	if config.Provider == "GMAIL" {
		values.Set("access_type", "offline")
		values.Set("include_granted_scopes", "true")
		values.Set("prompt", "consent")
	} else {
		tenant := strings.TrimSpace(config.Tenant)
		if tenant == "" {
			tenant = "consumers"
		}
		endpoint = "https://login.microsoftonline.com/" + url.PathEscape(tenant) + "/oauth2/v2.0/authorize"
		values.Set("response_mode", "query")
		values.Set("prompt", "select_account")
	}
	return endpoint + "?" + values.Encode()
}

func oauthScopes(config oauthProviderConfig) string {
	if strings.TrimSpace(config.Scopes) != "" {
		return strings.Join(strings.Fields(config.Scopes), " ")
	}
	if config.Provider == "GMAIL" {
		return googleDefaultScopes
	}
	return microsoftDefaultScopes
}

func oauthPayloadString(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}

func oauthErrorCode(err error) string {
	var requestErr *requestError
	if errors.As(err, &requestErr) && requestErr.Code != "" {
		return requestErr.Code
	}
	return "OAUTH_PROCESS_FAILED"
}

func oauthCallbackRedirectURL(result oauthCompletionResult) string {
	values := url.Values{"oauth_status": {result.Status}, "oauth_provider": {result.Provider}, "oauth_code": {result.Code}}
	if result.Email != "" {
		values.Set("oauth_email", result.Email)
	}
	if result.Action != "" {
		values.Set("oauth_action", result.Action)
	}
	return "/emails?" + values.Encode()
}
