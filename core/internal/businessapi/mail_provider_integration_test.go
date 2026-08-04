package businessapi

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

type providerRoundTripFunc func(*http.Request) (*http.Response, error)

func (function providerRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestGmailProviderMockMessagesListGetSendDelete(t *testing.T) {
	var mutex sync.Mutex
	requests := make([]string, 0, 5)
	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		mutex.Lock()
		requests = append(requests, request.Method+" "+request.URL.RequestURI())
		mutex.Unlock()
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/gmail/v1/users/me/messages":
			return providerJSONResponse(http.StatusOK, `{"messages":[{"id":"gmail-message-1"}]}`), nil
		case request.Method == http.MethodGet && request.URL.Path == "/gmail/v1/users/me/messages/gmail-message-1":
			text := base64.RawURLEncoding.EncodeToString([]byte("fixture body"))
			return providerJSONResponse(http.StatusOK, fmt.Sprintf(`{"id":"gmail-message-1","payload":{"mimeType":"multipart/alternative","headers":[{"name":"From","value":"sender@example.test"},{"name":"To","value":"receiver@example.test"},{"name":"Subject","value":"fixture subject"},{"name":"Date","value":"Fri, 31 Jul 2026 00:00:00 +0000"}],"parts":[{"mimeType":"text/plain","body":{"data":%q}}]}}`, text)), nil
		case request.Method == http.MethodPost && request.URL.Path == "/gmail/v1/users/me/messages/send":
			var payload map[string]string
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload["raw"] == "" {
				return nil, fmt.Errorf("invalid Gmail send payload: %v", err)
			}
			return providerJSONResponse(http.StatusOK, `{"id":"gmail-sent-1"}`), nil
		case request.Method == http.MethodPost && request.URL.Path == "/gmail/v1/users/me/messages/gmail-message-1/trash":
			return providerJSONResponse(http.StatusOK, `{}`), nil
		default:
			return nil, fmt.Errorf("unexpected Gmail request %s %s", request.Method, request.URL.String())
		}
	})
	server := providerTestServer(transport)
	provider := gmailMailProvider{server: server}
	account := mailAccountCredentials{Email: "receiver@example.test", Provider: "GMAIL", AuthType: "GOOGLE_OAUTH"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	fetched, err := provider.Fetch(ctx, account, "INBOX", 2)
	if err != nil {
		t.Fatal(err)
	}
	if fetched.Count != 1 || fetched.Messages[0].ID != "gmail-message-1" || fetched.Messages[0].Text != "fixture body" {
		t.Fatalf("Gmail fetch = %#v", fetched)
	}
	sent, err := provider.Send(ctx, account, providerSendInput{FromEmail: account.Email, To: []string{"to@example.test"}, Subject: "subject", Text: "body"})
	if err != nil {
		t.Fatal(err)
	}
	if sent.ProviderMessageID == nil || *sent.ProviderMessageID != "gmail-sent-1" {
		t.Fatalf("Gmail send = %#v", sent)
	}
	deleted, err := provider.Delete(ctx, account, "INBOX", []string{"gmail-message-1"})
	if err != nil {
		t.Fatal(err)
	}
	if deleted.DeletedCount != 1 {
		t.Fatalf("Gmail delete = %#v", deleted)
	}
	assertProviderRequests(t, requests, []string{
		"GET /gmail/v1/users/me/messages?labelIds=INBOX&maxResults=2",
		"GET /gmail/v1/users/me/messages/gmail-message-1?format=full",
		"POST /gmail/v1/users/me/messages/send",
		"POST /gmail/v1/users/me/messages/gmail-message-1/trash",
	})
}

func TestGraphProviderMockMessagesAndSendMail(t *testing.T) {
	var mutex sync.Mutex
	requests := make([]string, 0, 3)
	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		mutex.Lock()
		requests = append(requests, request.Method+" "+request.URL.RequestURI())
		mutex.Unlock()
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/v1.0/me/mailFolders/inbox/messages":
			return providerJSONResponse(http.StatusOK, `{"value":[{"id":"graph-message-1","subject":"fixture subject","bodyPreview":"fixture body","body":{"contentType":"text","content":"fixture body"},"from":{"emailAddress":{"name":"Sender","address":"sender@example.test"}},"toRecipients":[{"emailAddress":{"name":"Receiver","address":"receiver@example.test"}}],"receivedDateTime":"2026-07-31T00:00:00Z"}]}`), nil
		case request.Method == http.MethodPost && request.URL.Path == "/v1.0/me/sendMail":
			var payload struct {
				SaveToSentItems bool `json:"saveToSentItems"`
			}
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || !payload.SaveToSentItems {
				return nil, fmt.Errorf("invalid Graph send payload: %v", err)
			}
			return providerJSONResponse(http.StatusAccepted, ""), nil
		case request.Method == http.MethodDelete && request.URL.Path == "/v1.0/me/messages/graph-message-1":
			return providerJSONResponse(http.StatusNoContent, ""), nil
		default:
			return nil, fmt.Errorf("unexpected Graph request %s %s", request.Method, request.URL.String())
		}
	})
	server := providerTestServer(transport)
	provider := graphMailProvider{server: server}
	account := mailAccountCredentials{Email: "receiver@example.test", Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	fetched, err := provider.Fetch(ctx, account, "INBOX", 5)
	if err != nil {
		t.Fatal(err)
	}
	if fetched.Count != 1 || fetched.Messages[0].ID != "graph-message-1" || fetched.Messages[0].Text != "fixture body" {
		t.Fatalf("Graph fetch = %#v", fetched)
	}
	if _, err := provider.Send(ctx, account, providerSendInput{FromEmail: account.Email, To: []string{"to@example.test"}, Subject: "subject", Text: "body"}); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Delete(ctx, account, "INBOX", []string{"graph-message-1"}); err != nil {
		t.Fatal(err)
	}
	assertProviderRequests(t, requests, []string{
		"GET /v1.0/me/mailFolders/inbox/messages?$top=5&$orderby=receivedDateTime%20desc&$select=id,subject,bodyPreview,body,from,toRecipients,receivedDateTime",
		"POST /v1.0/me/sendMail",
		"DELETE /v1.0/me/messages/graph-message-1",
	})
}

func TestProviderClearTraversesEveryRemotePage(t *testing.T) {
	t.Run("Gmail", func(t *testing.T) {
		var requests []string
		transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			requests = append(requests, request.Method+" "+request.URL.RequestURI())
			switch request.URL.Query().Get("pageToken") {
			case "":
				return providerJSONResponse(http.StatusOK, `{"messages":[{"id":"gmail-1"},{"id":"gmail-2"}],"nextPageToken":"page-2"}`), nil
			case "page-2":
				return providerJSONResponse(http.StatusOK, `{"messages":[{"id":"gmail-3"}]}`), nil
			default:
				return nil, fmt.Errorf("unexpected Gmail page %s", request.URL.String())
			}
		})
		transportWithDeletes := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method == http.MethodPost && strings.HasSuffix(request.URL.Path, "/trash") {
				requests = append(requests, request.Method+" "+request.URL.RequestURI())
				return providerJSONResponse(http.StatusOK, `{}`), nil
			}
			return transport.RoundTrip(request)
		})
		provider := gmailMailProvider{server: providerTestServer(transportWithDeletes)}
		result, err := provider.Clear(context.Background(), mailAccountCredentials{Email: "gmail@example.test", Provider: "GMAIL", AuthType: "GOOGLE_OAUTH"}, "INBOX")
		if err != nil || result.DeletedCount != 3 {
			t.Fatalf("Gmail clear = %#v, %v", result, err)
		}
		if len(requests) != 5 || !strings.Contains(requests[1], "pageToken=page-2") {
			t.Fatalf("Gmail clear requests = %#v", requests)
		}
	})

	t.Run("Graph", func(t *testing.T) {
		var requests []string
		transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			requests = append(requests, request.Method+" "+request.URL.RequestURI())
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/v1.0/me/mailFolders/inbox/messages":
				return providerJSONResponse(http.StatusOK, `{"value":[{"id":"graph-1"},{"id":"graph-2"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/clear-page-2"}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/v1.0/clear-page-2":
				return providerJSONResponse(http.StatusOK, `{"value":[{"id":"graph-3"}]}`), nil
			case request.Method == http.MethodDelete && strings.HasPrefix(request.URL.Path, "/v1.0/me/messages/"):
				return providerJSONResponse(http.StatusNoContent, ""), nil
			default:
				return nil, fmt.Errorf("unexpected Graph clear request %s %s", request.Method, request.URL.String())
			}
		})
		provider := graphMailProvider{server: providerTestServer(transport)}
		result, err := provider.Clear(context.Background(), mailAccountCredentials{Email: "graph@example.test", Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH"}, "INBOX")
		if err != nil || result.DeletedCount != 3 {
			t.Fatalf("Graph clear = %#v, %v", result, err)
		}
		if len(requests) != 5 {
			t.Fatalf("Graph clear requests = %#v", requests)
		}
	})
}

func TestMailAccountClearCapabilitiesFailClosed(t *testing.T) {
	for name, account := range map[string]mailAccountCredentials{
		"gmail app password": {Provider: "GMAIL", AuthType: "APP_PASSWORD"},
		"qq app password":    {Provider: "QQ", AuthType: "APP_PASSWORD"},
		"custom":             {Provider: "CUSTOM_IMAP_SMTP", AuthType: "APP_PASSWORD"},
		"outlook imap only":  {Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH", FetchStrategy: "IMAP_ONLY"},
	} {
		if mailAccountSupportsClear(account) {
			t.Fatalf("%s unexpectedly supports clear", name)
		}
	}
	for name, account := range map[string]mailAccountCredentials{
		"gmail oauth": {Provider: "GMAIL", AuthType: "GOOGLE_OAUTH"},
		"outlook graph": {
			Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH", FetchStrategy: "GRAPH_FIRST",
			ProviderConfig: mailProviderConfig{ReadMode: "GRAPH_ONLY", OAuthScopes: "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send"},
		},
	} {
		if !mailAccountSupportsClear(account) {
			t.Fatalf("%s unexpectedly rejects clear", name)
		}
	}
	if summary := providerProfileSummary("QQ", "APP_PASSWORD", defaultProviderConfig("QQ"), ""); summary["capabilitySummary"].(map[string]any)["clearMailbox"] != false {
		t.Fatalf("QQ capability summary = %#v", summary)
	}
	imapOnly := defaultProviderConfig("OUTLOOK")
	imapOnly.ReadMode = "IMAP_ONLY"
	if summary := providerProfileSummary("OUTLOOK", "MICROSOFT_OAUTH", imapOnly, ""); summary["capabilitySummary"].(map[string]any)["clearMailbox"] != false || summary["capabilitySummary"].(map[string]any)["sendMail"] != false {
		t.Fatalf("Outlook IMAP-only capability summary = %#v", summary)
	}
	graphOnly := defaultProviderConfig("OUTLOOK")
	graphOnly.OAuthScopes = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send"
	if summary := providerProfileSummary("OUTLOOK", "MICROSOFT_OAUTH", graphOnly, ""); summary["capabilitySummary"].(map[string]any)["clearMailbox"] != true {
		t.Fatalf("Outlook Graph capability summary = %#v", summary)
	}
	readOnly := defaultProviderConfig("OUTLOOK")
	readOnly.OAuthScopes = "User.Read Mail.Read"
	if summary := providerProfileSummary("OUTLOOK", "MICROSOFT_OAUTH", readOnly, ""); summary["capabilitySummary"].(map[string]any)["clearMailbox"] != false || summary["capabilitySummary"].(map[string]any)["sendMail"] != false {
		t.Fatalf("Outlook read-only capability summary = %#v", summary)
	}
}

func TestMailAccountProviderModePlans(t *testing.T) {
	for name, fixture := range map[string]struct {
		account mailAccountCredentials
		want    []string
	}{
		"outlook graph first": {
			account: mailAccountCredentials{Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH", FetchStrategy: "GRAPH_FIRST", ProviderConfig: mailProviderConfig{ReadMode: "AUTO", OAuthScopes: microsoftIMAPScope}},
			want:    []string{providerModeGraph, providerModeIMAP},
		},
		"outlook imap first": {
			account: mailAccountCredentials{Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH", FetchStrategy: "IMAP_FIRST", ProviderConfig: mailProviderConfig{ReadMode: "AUTO", OAuthScopes: microsoftIMAPScope}},
			want:    []string{providerModeIMAP, providerModeGraph},
		},
		"outlook auto without imap consent": {
			account: mailAccountCredentials{Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH", FetchStrategy: "IMAP_FIRST", ProviderConfig: mailProviderConfig{ReadMode: "AUTO"}},
			want:    []string{providerModeGraph},
		},
		"outlook imap only alias": {
			account: mailAccountCredentials{Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH", ProviderConfig: mailProviderConfig{ReadMode: "IMAP"}},
			want:    []string{providerModeIMAP},
		},
		"gmail auto": {
			account: mailAccountCredentials{Provider: "GMAIL", AuthType: "GOOGLE_OAUTH", ProviderConfig: mailProviderConfig{ReadMode: "AUTO"}},
			want:    []string{providerModeGmail, providerModeIMAP},
		},
		"gmail imap": {
			account: mailAccountCredentials{Provider: "GMAIL", AuthType: "GOOGLE_OAUTH", ProviderConfig: mailProviderConfig{ReadMode: "IMAP"}},
			want:    []string{providerModeIMAP},
		},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := mailAccountFetchModes(fixture.account)
			if err != nil || strings.Join(got, ",") != strings.Join(fixture.want, ",") {
				t.Fatalf("fetch modes = %#v, %v; want %#v", got, err, fixture.want)
			}
		})
	}
	if mode, err := mailAccountDeleteMode(
		mailAccountCredentials{Provider: "GMAIL", AuthType: "GOOGLE_OAUTH", ProviderConfig: mailProviderConfig{ReadMode: "AUTO"}},
		[]string{"uid:42"},
	); err != nil || mode != providerModeIMAP {
		t.Fatalf("IMAP-origin delete mode = %q, %v", mode, err)
	}
}

func TestOAuthRefreshPrefersAccountApplicationCredentials(t *testing.T) {
	clientID, clientSecret, err := resolveOAuthClientCredentials(
		mailAccountCredentials{ClientID: "imported-client", ClientSecret: "imported-secret"},
		oauthProviderConfig{ClientID: "global-client", ClientSecret: "global-secret"},
	)
	if err != nil || clientID != "imported-client" || clientSecret != "imported-secret" {
		t.Fatalf("account OAuth credentials = %q/%q, %v", clientID, clientSecret, err)
	}
	clientID, clientSecret, err = resolveOAuthClientCredentials(
		mailAccountCredentials{},
		oauthProviderConfig{ClientID: "global-client", ClientSecret: "global-secret"},
	)
	if err != nil || clientID != "global-client" || clientSecret != "global-secret" {
		t.Fatalf("global OAuth fallback = %q/%q, %v", clientID, clientSecret, err)
	}
}

func TestOAuthRefreshUsesAccountAuthorityWithoutGlobalConfig(t *testing.T) {
	var endpoint, form string
	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		endpoint, form = request.URL.String(), string(body)
		return providerJSONResponse(http.StatusOK, `{"access_token":"account-access-token","token_type":"Bearer"}`), nil
	})
	server := &Server{
		cfg:                config.GoBusinessAPIConfig{ProviderTimeout: 5 * time.Second},
		providerHTTPClient: &http.Client{Transport: transport},
	}
	accessToken, err := server.refreshProviderAccessToken(context.Background(), mailAccountCredentials{
		Provider: "OUTLOOK", ClientID: "account-client", ClientSecret: "account-secret", RefreshToken: "account-refresh",
		ProviderConfig: mailProviderConfig{OAuthTenant: "account-tenant", OAuthScopes: "offline_access https://graph.microsoft.com/Mail.ReadWrite"},
	})
	if err != nil || accessToken != "account-access-token" {
		t.Fatalf("account OAuth refresh = %q, %v", accessToken, err)
	}
	if !strings.Contains(endpoint, "/account-tenant/oauth2/v2.0/token") {
		t.Fatalf("account OAuth endpoint = %s", endpoint)
	}
	for _, expected := range []string{"client_id=account-client", "client_secret=account-secret", "refresh_token=account-refresh", "scope=offline_access+https%3A%2F%2Fgraph.microsoft.com%2FMail.ReadWrite"} {
		if !strings.Contains(form, expected) {
			t.Fatalf("account OAuth form missing %q: %s", expected, form)
		}
	}
}

func TestOAuthExportImportPreservesAccountAuthority(t *testing.T) {
	const encryptionKey = "oauth-export-test-key-0123456789"
	encrypt := func(value string) sql.NullString {
		encrypted, err := legacycrypto.Encrypt(encryptionKey, value)
		if err != nil {
			t.Fatal(err)
		}
		return sql.NullString{String: encrypted, Valid: true}
	}
	configValue := oauthBoundProviderConfig("OUTLOOK", oauthProviderConfig{
		Tenant: "organizations", Scopes: "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send",
	})
	encodedConfig, err := json.Marshal(configValue)
	if err != nil {
		t.Fatal(err)
	}
	line, err := formatExportMailAccount(exportMailAccountRow{
		Email: "authority@example.test", Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH",
		ClientID: sql.NullString{String: "account-client", Valid: true}, ClientSecret: encrypt("account-secret"),
		RefreshToken: encrypt("account-refresh"), ProviderConfig: encodedConfig,
	}, defaultMailImportSeparator, false, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseImportedMailAccount(line, defaultMailImportSeparator)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.ProviderConfig.OAuthTenant != "organizations" || !strings.Contains(parsed.ProviderConfig.OAuthScopes, "Mail.Send") || parsed.ProviderConfig.ReadMode != "GRAPH_ONLY" {
		t.Fatalf("OAuth export/import authority = %#v", parsed.ProviderConfig)
	}
}

func TestMailAccountProfileValidationRejectsImpossibleRecords(t *testing.T) {
	value := "credential"
	for name, fixture := range map[string]struct {
		provider string
		authType string
		config   mailProviderConfig
	}{
		"gmail microsoft":  {provider: "GMAIL", authType: "MICROSOFT_OAUTH", config: defaultProviderConfig("GMAIL")},
		"outlook password": {provider: "OUTLOOK", authType: "APP_PASSWORD", config: defaultProviderConfig("OUTLOOK")},
		"qq google":        {provider: "QQ", authType: "GOOGLE_OAUTH", config: defaultProviderConfig("QQ")},
		"custom hosts":     {provider: "CUSTOM_IMAP_SMTP", authType: "APP_PASSWORD", config: defaultProviderConfig("CUSTOM_IMAP_SMTP")},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateMailAccountInput(fixture.provider, fixture.authType, &value, &value, &value, fixture.config); err == nil {
				t.Fatal("invalid mail account profile was accepted")
			}
		})
	}
	custom := defaultProviderConfig("CUSTOM_IMAP_SMTP")
	custom.IMAPHost, custom.SMTPHost = "imap.example.test", "smtp.example.test"
	if err := validateMailAccountInput("CUSTOM_IMAP_SMTP", "APP_PASSWORD", nil, nil, &value, custom); err != nil {
		t.Fatalf("valid custom profile rejected: %v", err)
	}
	if err := validateMailAccountInput("GMAIL", "GOOGLE_OAUTH", &value, &value, nil, defaultProviderConfig("GMAIL")); err != nil {
		t.Fatalf("valid Gmail OAuth profile rejected: %v", err)
	}
	update, err := parseUpdateMailAccount(updateMailAccountRequest{ProviderConfig: json.RawMessage(`{"readMode":"AUTO"}`)})
	if err != nil {
		t.Fatal(err)
	}
	merged, err := mergeProviderConfig("GMAIL", update.ProviderConfigRaw)
	if err != nil || merged.IMAPHost != "imap.gmail.com" || merged.SMTPHost != "smtp.gmail.com" || merged.ReadMode != "AUTO" {
		t.Fatalf("deferred Gmail provider config = %#v, %v", merged, err)
	}
	bound := oauthBoundProviderConfig("OUTLOOK", oauthProviderConfig{Tenant: "organizations", Scopes: "offline_access https://graph.microsoft.com/Mail.ReadWrite"})
	merged, err = mergeProviderConfigInto(bound, json.RawMessage(`{"readMode":"GRAPH_ONLY"}`))
	if err != nil || merged.OAuthTenant != "organizations" || !strings.Contains(merged.OAuthScopes, "Mail.ReadWrite") {
		t.Fatalf("partial provider config lost OAuth authority = %#v, %v", merged, err)
	}
}

func TestOAuthIMAPModeAuthenticatesWithXoauth2(t *testing.T) {
	fixture := newIMAPFixture(t)
	defer fixture.Close(t)
	host, portText, err := net.SplitHostPort(fixture.listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	useTLS := false
	server := providerTestServer(providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("unexpected HTTP request during OAuth IMAP test: %s", request.URL.String())
	}))
	provider := imapSMTPProvider{server: server}
	account := mailAccountCredentials{
		Email: "oauth@example.test", Provider: "GMAIL", AuthType: "GOOGLE_OAUTH", RefreshToken: "fixture-refresh-token",
		ProviderConfig: mailProviderConfig{ReadMode: "IMAP", IMAPHost: host, IMAPPort: port, IMAPTLS: &useTLS},
	}
	result, err := provider.Fetch(context.Background(), account, "INBOX", 1)
	if err != nil || result.Count != 1 {
		t.Fatalf("OAuth IMAP fetch = %#v, %v", result, err)
	}
	commands := strings.ToUpper(strings.Join(fixture.Commands(), "\n"))
	if !strings.Contains(commands, "AUTHENTICATE XOAUTH2") || strings.Contains(commands, "LOGIN") {
		t.Fatalf("OAuth IMAP commands = %s", commands)
	}
}

func TestIMAPFixtureLoginSelectFetchStoreDeleteExpunge(t *testing.T) {
	fixture := newIMAPFixture(t)
	defer fixture.Close(t)
	host, portText, err := net.SplitHostPort(fixture.listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	useTLS := false
	provider := imapSMTPProvider{server: providerTestServer(http.DefaultTransport)}
	account := mailAccountCredentials{
		Email: "receiver@example.test", Provider: "QQ", AuthType: "APP_PASSWORD", Password: "fixture-password",
		ProviderConfig: mailProviderConfig{IMAPHost: host, IMAPPort: port, IMAPTLS: &useTLS, Folders: map[string]string{"inbox": "INBOX"}},
		MailboxStatus:  map[string]any{"INBOX": map[string]any{"uidValidity": float64(7)}},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	fetched, err := provider.Fetch(ctx, account, "INBOX", 1)
	if err != nil {
		t.Fatal(err)
	}
	if fetched.Count != 1 || fetched.Messages[0].ID != "uid:42" {
		t.Fatalf("IMAP fetch = %#v", fetched)
	}
	deleted, err := provider.Delete(ctx, account, "INBOX", []string{"uid:42"})
	if err != nil {
		t.Fatal(err)
	}
	if deleted.DeletedCount != 1 {
		t.Fatalf("IMAP delete = %#v", deleted)
	}
	staleAccount := account
	staleAccount.MailboxStatus = map[string]any{"INBOX": map[string]any{"uidValidity": float64(8)}}
	_, err = provider.Delete(ctx, staleAccount, "INBOX", []string{"uid:42"})
	var requestErr *requestError
	if !errors.As(err, &requestErr) || requestErr.Status != http.StatusConflict || requestErr.Code != "IMAP_MAILBOX_RESYNC_REQUIRED" {
		t.Fatalf("stale IMAP delete error = %#v", err)
	}
	commands := strings.ToUpper(strings.Join(fixture.Commands(), "\n"))
	for _, expected := range []string{"LOGIN", "SELECT INBOX", "FETCH", "UID STORE", "\\DELETED", "EXPUNGE"} {
		if !strings.Contains(commands, expected) {
			t.Fatalf("IMAP commands missing %q:\n%s", expected, commands)
		}
	}
}

func TestMailComProviderDefaults(t *testing.T) {
	config := defaultProviderConfig("MAILCOM")
	if config.IMAPHost != "imap.mail.com" || config.IMAPPort != 993 || config.IMAPTLS == nil || !*config.IMAPTLS {
		t.Fatalf("Mail.com IMAP defaults = %#v", config)
	}
	if config.SMTPHost != "smtp.mail.com" || config.SMTPPort != 587 || config.SMTPSecure == nil || *config.SMTPSecure {
		t.Fatalf("Mail.com SMTP defaults = %#v", config)
	}
	if config.Folders["sent"] != "Sent Items" || config.Folders["junk"] != "Junk email" {
		t.Fatalf("Mail.com folder defaults = %#v", config.Folders)
	}
	provider, authType, ok := importTokenProfile("MAILCOM_IMAP_SMTP")
	if !ok || provider != "MAILCOM" || authType != "APP_PASSWORD" {
		t.Fatalf("Mail.com import profile = %q/%q/%v", provider, authType, ok)
	}
}

func providerTestServer(transport http.RoundTripper) *Server {
	return &Server{
		cfg:                 config.GoBusinessAPIConfig{ProviderTimeout: 5 * time.Second},
		providerHTTPClient:  &http.Client{Transport: transport, Timeout: 5 * time.Second},
		providerDialContext: (&net.Dialer{Timeout: 20 * time.Second}).DialContext,
		providerTokenSource: func(context.Context, mailAccountCredentials) (string, error) { return "fixture-access-token", nil },
		now:                 time.Now,
	}
}

func providerJSONResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func assertProviderRequests(t *testing.T, actual, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("provider requests = %#v; want %#v", actual, expected)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("provider request %d = %q; want %q", index, actual[index], expected[index])
		}
	}
}

type imapFixture struct {
	listener net.Listener
	mutex    sync.Mutex
	commands []string
	errors   []error
	wait     sync.WaitGroup
}

func newIMAPFixture(t *testing.T) *imapFixture {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	fixture := &imapFixture{listener: listener}
	fixture.wait.Add(1)
	go func() {
		defer fixture.wait.Done()
		for {
			connection, err := listener.Accept()
			if err != nil {
				if !errorsIsNetworkClosed(err) {
					fixture.recordError(err)
				}
				return
			}
			fixture.wait.Add(1)
			go func() {
				defer fixture.wait.Done()
				fixture.serve(connection)
			}()
		}
	}()
	return fixture
}

func (fixture *imapFixture) serve(connection net.Conn) {
	defer connection.Close()
	_, _ = io.WriteString(connection, "* OK IMAP fixture ready\r\n")
	scanner := bufio.NewScanner(connection)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Fields(line)
		if len(parts) < 2 {
			fixture.recordError(fmt.Errorf("invalid IMAP command %q", line))
			return
		}
		tag := parts[0]
		command := strings.ToUpper(parts[1])
		fixture.mutex.Lock()
		fixture.commands = append(fixture.commands, strings.Join(parts[1:], " "))
		fixture.mutex.Unlock()
		switch command {
		case "CAPABILITY":
			_, _ = io.WriteString(connection, "* CAPABILITY IMAP4rev1 SASL-IR AUTH=XOAUTH2\r\n"+tag+" OK CAPABILITY completed\r\n")
		case "LOGIN":
			_, _ = io.WriteString(connection, tag+" OK [CAPABILITY IMAP4rev1 SASL-IR AUTH=XOAUTH2] LOGIN completed\r\n")
		case "AUTHENTICATE":
			if len(parts) < 3 || strings.ToUpper(parts[2]) != "XOAUTH2" {
				fixture.recordError(fmt.Errorf("unexpected AUTHENTICATE command %q", line))
				return
			}
			_, _ = io.WriteString(connection, tag+" OK AUTHENTICATE completed\r\n")
		case "SELECT":
			_, _ = io.WriteString(connection, "* FLAGS (\\Seen \\Deleted)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\n"+tag+" OK [READ-WRITE] SELECT completed\r\n")
		case "FETCH":
			message := "From: Sender <sender@example.test>\r\nTo: Receiver <receiver@example.test>\r\nSubject: Fixture subject\r\nDate: Fri, 31 Jul 2026 00:00:00 +0000\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nFixture body\r\n"
			envelope := "(\"Fri, 31 Jul 2026 00:00:00 +0000\" \"Fixture subject\" ((\"Sender\" NIL \"sender\" \"example.test\")) ((\"Sender\" NIL \"sender\" \"example.test\")) ((\"Sender\" NIL \"sender\" \"example.test\")) ((\"Receiver\" NIL \"receiver\" \"example.test\")) NIL NIL NIL \"<fixture@example.test>\")"
			_, _ = fmt.Fprintf(connection, "* 1 FETCH (UID 42 ENVELOPE %s BODY[] {%d}\r\n%s)\r\n%s OK FETCH completed\r\n", envelope, len(message), message, tag)
		case "UID":
			if len(parts) < 3 || strings.ToUpper(parts[2]) != "STORE" {
				fixture.recordError(fmt.Errorf("unexpected UID command %q", line))
				return
			}
			_, _ = io.WriteString(connection, tag+" OK STORE completed\r\n")
		case "EXPUNGE":
			_, _ = io.WriteString(connection, "* 1 EXPUNGE\r\n* 0 EXISTS\r\n"+tag+" OK EXPUNGE completed\r\n")
		case "LOGOUT":
			_, _ = io.WriteString(connection, "* BYE LOGOUT requested\r\n"+tag+" OK LOGOUT completed\r\n")
			return
		default:
			fixture.recordError(fmt.Errorf("unexpected IMAP command %q", line))
			_, _ = io.WriteString(connection, tag+" BAD unexpected command\r\n")
			return
		}
	}
	if err := scanner.Err(); err != nil {
		fixture.recordError(err)
	}
}

func (fixture *imapFixture) recordError(err error) {
	fixture.mutex.Lock()
	defer fixture.mutex.Unlock()
	fixture.errors = append(fixture.errors, err)
}

func (fixture *imapFixture) Commands() []string {
	fixture.mutex.Lock()
	defer fixture.mutex.Unlock()
	return append([]string(nil), fixture.commands...)
}

func (fixture *imapFixture) Close(t *testing.T) {
	t.Helper()
	_ = fixture.listener.Close()
	fixture.wait.Wait()
	fixture.mutex.Lock()
	defer fixture.mutex.Unlock()
	if len(fixture.errors) > 0 {
		t.Fatalf("IMAP fixture errors: %v", fixture.errors)
	}
}

func errorsIsNetworkClosed(err error) bool {
	return err == net.ErrClosed || strings.Contains(strings.ToLower(err.Error()), "use of closed network connection")
}
