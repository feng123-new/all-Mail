package businessapi

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestPostgresAPIKeyAndExternalRouteIntegrationOAuthStateMachine(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	const encryptionKey = "pr35-oauth-integration-key-0123456789"
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	googleEmail := "verified-google-" + suffix + "@example.test"
	microsoftEmail := "verified-microsoft-" + suffix + "@example.test"
	maliciousEmail := "id-token-attacker-" + suffix + "@example.test"
	manualEmail := "manual-microsoft-" + suffix + "@example.test"
	failGoogleMailboxVerification := false
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_accounts WHERE email = ANY($1::text[])`, []string{googleEmail, microsoftEmail, maliciousEmail, manualEmail})
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM provider_oauth_configs WHERE provider IN ('GMAIL', 'OUTLOOK')`)
	}()

	for _, item := range []struct {
		provider     string
		clientID     string
		clientSecret string
		redirectURI  string
		scopes       string
		tenant       *string
	}{
		{provider: "GMAIL", clientID: "google-client-id", clientSecret: "google-client-secret", redirectURI: "https://mail.example.test/admin/oauth/google/callback", scopes: googleDefaultScopes},
		{provider: "OUTLOOK", clientID: "microsoft-client-id", clientSecret: "microsoft-client-secret", redirectURI: "https://mail.example.test/admin/oauth/outlook/callback", scopes: microsoftDefaultScopes, tenant: stringPointer("consumers")},
	} {
		if _, err := store.saveOAuthProviderConfig(ctx, item.provider, oauthProviderConfigUpdate{
			ClientIDPresent: true, ClientID: &item.clientID,
			ClientSecretPresent: true, ClientSecret: &item.clientSecret,
			RedirectURIPresent: true, RedirectURI: &item.redirectURI,
			ScopesPresent: true, Scopes: &item.scopes,
			TenantPresent: true, Tenant: item.tenant,
		}, encryptionKey); err != nil {
			t.Fatal(err)
		}
	}
	manualClientID, manualRefreshToken := "microsoft-client-id", "manual-refresh-token"
	manualAccount, err := store.createMailAccount(ctx, mailAccountCreateInput{
		Email: manualEmail, Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH",
		ClientID: &manualClientID, RefreshToken: &manualRefreshToken,
		ProviderConfig: defaultProviderConfig("OUTLOOK"), Capabilities: map[string]any{},
	}, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	manualID, ok := manualAccount["id"].(int64)
	if !ok {
		t.Fatalf("manual OAuth account id = %#v", manualAccount["id"])
	}
	manualCredentials, err := store.loadMailAccountCredentials(ctx, manualID, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	if manualCredentials.ProviderConfig.OAuthTenant != "consumers" || !strings.Contains(manualCredentials.ProviderConfig.OAuthScopes, "Mail.Send") {
		t.Fatalf("manual OAuth authority = %#v", manualCredentials.ProviderConfig)
	}

	idTokenPayload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"email":%q}`, maliciousEmail)))
	idToken := "e30." + idTokenPayload + ".ignored-signature"
	var requestMutex sync.Mutex
	remoteRequests := make([]string, 0, 6)
	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requestMutex.Lock()
		remoteRequests = append(remoteRequests, request.Method+" "+request.URL.Host+request.URL.RequestURI())
		requestMutex.Unlock()
		switch {
		case request.Method == http.MethodPost && request.URL.Host == "oauth2.googleapis.com" && request.URL.Path == "/token":
			assertOAuthCodeExchange(t, request, "google-authorization-code")
			return providerJSONResponse(http.StatusOK, fmt.Sprintf(`{"access_token":"google-access-token","refresh_token":"google-refresh-token","id_token":%q}`, idToken)), nil
		case request.Method == http.MethodGet && request.URL.Host == "openidconnect.googleapis.com" && request.URL.Path == "/v1/userinfo":
			return providerJSONResponse(http.StatusOK, fmt.Sprintf(`{"email":%q}`, googleEmail)), nil
		case request.Method == http.MethodGet && request.URL.Host == "gmail.googleapis.com" && request.URL.Path == "/gmail/v1/users/me/profile":
			return providerJSONResponse(http.StatusOK, fmt.Sprintf(`{"emailAddress":%q}`, googleEmail)), nil
		case request.Method == http.MethodGet && request.URL.Host == "gmail.googleapis.com" && request.URL.Path == "/gmail/v1/users/me/messages":
			if failGoogleMailboxVerification {
				return providerJSONResponse(http.StatusForbidden, `{"error":"insufficient scope"}`), nil
			}
			return providerJSONResponse(http.StatusOK, `{"messages":[]}`), nil
		case request.Method == http.MethodPost && request.URL.Host == "login.microsoftonline.com" && request.URL.Path == "/consumers/oauth2/v2.0/token":
			assertOAuthCodeExchange(t, request, "microsoft-authorization-code")
			return providerJSONResponse(http.StatusOK, fmt.Sprintf(`{"access_token":"microsoft-access-token","refresh_token":"microsoft-refresh-token","id_token":%q}`, idToken)), nil
		case request.Method == http.MethodGet && request.URL.Host == "graph.microsoft.com" && request.URL.Path == "/v1.0/me":
			return providerJSONResponse(http.StatusOK, fmt.Sprintf(`{"mail":%q,"userPrincipalName":%q}`, microsoftEmail, maliciousEmail)), nil
		case request.Method == http.MethodGet && request.URL.Host == "graph.microsoft.com" && request.URL.Path == "/v1.0/me/mailFolders/inbox/messages":
			return providerJSONResponse(http.StatusOK, `{"value":[]}`), nil
		default:
			return nil, fmt.Errorf("unexpected OAuth request %s %s", request.Method, request.URL.String())
		}
	})
	now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	server := &Server{
		cfg: config.GoBusinessAPIConfig{
			EncryptionKey: encryptionKey, QueryTimeout: 10 * time.Second, ProviderTimeout: 5 * time.Second,
		},
		logger:             slog.New(slog.NewTextHandler(io.Discard, nil)),
		store:              store,
		oauthStateStore:    newMemoryOAuthStateStore(),
		providerHTTPClient: &http.Client{Transport: transport, Timeout: 5 * time.Second},
		now:                func() time.Time { return now },
	}

	for _, item := range []struct {
		provider        string
		state           string
		code            string
		expectedEmail   string
		expectedSecret  string
		expectedRefresh string
	}{
		{provider: "GMAIL", state: "google-state", code: "google-authorization-code", expectedEmail: googleEmail, expectedSecret: "google-client-secret", expectedRefresh: "google-refresh-token"},
		{provider: "OUTLOOK", state: "microsoft-state", code: "microsoft-authorization-code", expectedEmail: microsoftEmail, expectedSecret: "microsoft-client-secret", expectedRefresh: "microsoft-refresh-token"},
	} {
		if err := server.saveOAuthState(ctx, item.state, oauthStateRecord{AdminID: 1, Provider: item.provider, CreatedAt: now.UnixMilli()}); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodGet, "/admin/oauth/callback?state="+url.QueryEscape(item.state)+"&code="+url.QueryEscape(item.code), nil)
		result, err := server.completeOAuthAuthorization(request, item.provider)
		if err != nil {
			t.Fatal(err)
		}
		if result.Status != "success" || result.Email != item.expectedEmail || result.Code != "OAUTH_AUTHORIZED_SUCCESS" {
			t.Fatalf("%s OAuth result = %#v", item.provider, result)
		}
		row, found, err := store.findOAuthMailboxByEmail(ctx, item.expectedEmail)
		if err != nil || !found {
			t.Fatalf("%s OAuth mailbox found=%v err=%v", item.provider, found, err)
		}
		credentials, err := store.loadMailAccountCredentials(ctx, row.ID, encryptionKey)
		if err != nil {
			t.Fatal(err)
		}
		if credentials.ClientSecret != item.expectedSecret || credentials.RefreshToken != item.expectedRefresh {
			t.Fatalf("%s OAuth credentials = clientSecret %q refreshToken %q", item.provider, credentials.ClientSecret, credentials.RefreshToken)
		}
		if credentials.ProviderConfig.OAuthScopes == "" {
			t.Fatalf("%s OAuth scopes were not bound to the account", item.provider)
		}
		if item.provider == "OUTLOOK" && (credentials.ProviderConfig.OAuthTenant != "consumers" || credentials.ProviderConfig.ReadMode != "GRAPH_ONLY") {
			t.Fatalf("Outlook bound provider config = %#v", credentials.ProviderConfig)
		}
	}
	failGoogleMailboxVerification = true
	if err := server.saveOAuthState(ctx, "google-warning-state", oauthStateRecord{AdminID: 1, Provider: "GMAIL", CreatedAt: now.UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	warningRequest := httptest.NewRequest(http.MethodGet, "/admin/oauth/callback?state=google-warning-state&code=google-authorization-code", nil)
	warningResult, err := server.completeOAuthAuthorization(warningRequest, "GMAIL")
	if err != nil {
		t.Fatal(err)
	}
	if warningResult.Status != "warning" || warningResult.Code != "OAUTH_AUTHORIZED_VERIFY_FAILED" || warningResult.Email != googleEmail {
		t.Fatalf("OAuth verification warning = %#v", warningResult)
	}
	var warningStatus string
	if err := store.pool.QueryRow(ctx, `SELECT status::text FROM email_accounts WHERE LOWER(email) = LOWER($1)`, googleEmail).Scan(&warningStatus); err != nil {
		t.Fatal(err)
	}
	if warningStatus != "ERROR" {
		t.Fatalf("OAuth verification failure status = %q", warningStatus)
	}
	if _, found, err := store.findOAuthMailboxByEmail(ctx, maliciousEmail); err != nil || found {
		t.Fatalf("unverified id_token email was bound: found=%v err=%v", found, err)
	}
	requestMutex.Lock()
	requests := strings.Join(remoteRequests, "\n")
	requestMutex.Unlock()
	for _, expected := range []string{
		"POST oauth2.googleapis.com/token",
		"GET openidconnect.googleapis.com/v1/userinfo",
		"GET gmail.googleapis.com/gmail/v1/users/me/profile",
		"GET gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=1",
		"POST login.microsoftonline.com/consumers/oauth2/v2.0/token",
		"GET graph.microsoft.com/v1.0/me?$select=mail",
		"GET graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=1&$select=id",
	} {
		if !strings.Contains(requests, expected) {
			t.Fatalf("OAuth requests missing %q:\n%s", expected, requests)
		}
	}
}

func assertOAuthCodeExchange(t *testing.T, request *http.Request, expectedCode string) {
	t.Helper()
	content, err := io.ReadAll(request.Body)
	if err != nil {
		t.Fatal(err)
	}
	values, err := url.ParseQuery(string(content))
	if err != nil {
		t.Fatal(err)
	}
	if values.Get("grant_type") != "authorization_code" || values.Get("code") != expectedCode || values.Get("client_secret") == "" {
		t.Fatalf("OAuth token exchange form = %v", values)
	}
}

type memoryOAuthStateStore struct {
	mutex  sync.Mutex
	values map[string]string
}

func newMemoryOAuthStateStore() *memoryOAuthStateStore {
	return &memoryOAuthStateStore{values: make(map[string]string)}
}

func (store *memoryOAuthStateStore) Set(_ context.Context, key, value string, _ time.Duration) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.values[key] = value
	return nil
}

func (store *memoryOAuthStateStore) Get(_ context.Context, key string) (string, bool, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	value, found := store.values[key]
	return value, found, nil
}

func (store *memoryOAuthStateStore) Take(_ context.Context, key string) (string, bool, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	value, found := store.values[key]
	delete(store.values, key)
	return value, found, nil
}
