package businessapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestGmailSendCapabilityFollowsGrantedScopes(t *testing.T) {
	const read = "https://www.googleapis.com/auth/gmail.readonly"
	const send = "https://www.googleapis.com/auth/gmail.send"
	for _, tc := range []struct {
		name, scopes string
		canSend      bool
	}{
		{name: "unknown"},
		{name: "read only", scopes: read},
		{name: "modify only", scopes: "https://www.googleapis.com/auth/gmail.modify", canSend: true},
		{name: "send", scopes: read + " " + send, canSend: true},
		{name: "full", scopes: "https://mail.google.com/", canSend: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := mailAccountSupportsSend(mailAccountCredentials{
				Provider: "GMAIL", AuthType: "GOOGLE_OAUTH", ProviderConfig: mailProviderConfig{OAuthScopes: tc.scopes},
			}); got != tc.canSend {
				t.Fatalf("Gmail send capability = %t, want %t", got, tc.canSend)
			}
		})
	}
	config := oauthProviderConfig{Provider: "GMAIL", Scopes: "openid email profile " + read + " " + send}
	if got := gmailGrantedScopes(config.Scopes, map[string]any{"scope": read}); got != read {
		t.Fatalf("persisted Gmail scopes = %q, want only granted %q", got, read)
	}
	if got := gmailGrantedScopes(config.Scopes, nil); got != config.Scopes {
		t.Fatalf("persisted Gmail scopes with implicit grant = %q, want %q", got, config.Scopes)
	}
	authorizationURL, err := url.Parse(buildOAuthAuthorizationURL(config, "state"))
	if err != nil || authorizationURL.Query().Get("prompt") != "select_account consent" {
		t.Fatalf("Gmail authorization must explicitly let users select their account: %v, %v", authorizationURL, err)
	}
}

func TestTemporaryGmailUsesOnlyFixedProviderEndpoints(t *testing.T) {
	server := testServer(&fakeStore{admin: Admin{ID: 7, Status: "ACTIVE"}})
	var log bytes.Buffer
	server.logger = slog.New(slog.NewTextHandler(&log, nil))
	var dialed string
	const secret = "qrstuvwxyzabcdef"
	server.providerDialContext = func(_ context.Context, _, address string) (net.Conn, error) {
		dialed = address
		return nil, errors.New("untrusted provider error containing " + secret)
	}
	const path = "/admin/emails/gmail/temporary"
	const credentials = `"email":"me@example.test","password":"qrst uvwx yzab cdef",`
	for _, tc := range []struct {
		name, body, origin, address string
		anonymous                   bool
		status                      int
	}{
		{name: "requires administrator", body: `{"operation":"list"}`, anonymous: true, status: 401},
		{name: "rejects cross origin", body: `{"operation":"list"}`, origin: "https://untrusted.example.test", status: 403},
		{name: "rejects non application password", body: `{"email":"me@example.test","password":"normal-password","operation":"list","mailbox":"INBOX"}`, status: 400},
		{name: "rejects mutation", body: `{` + credentials + `"operation":"delete","mailbox":"INBOX"}`, status: 400},
		{name: "requires UID validity", body: `{` + credentials + `"operation":"detail","mailbox":"INBOX","messageId":"uid:42"}`, status: 400},
		{name: "rejects custom server configuration", body: `{` + credentials + `"operation":"list","mailbox":"INBOX","imapHost":"untrusted.example.test"}`, status: 400},
		{name: "lists with Gmail IMAP", body: `{` + credentials + `"operation":"list","mailbox":"INBOX"}`, status: 502, address: "imap.gmail.com:993"},
		{name: "reads detail with Gmail IMAP", body: `{` + credentials + `"operation":"detail","mailbox":"SENT","messageId":"uid:42","uidValidity":1}`, status: 502, address: "imap.gmail.com:993"},
		{name: "validates recipients before sending", body: `{` + credentials + `"operation":"send","message":{"to":["invalid"],"subject":"Subject","text":"Body"}}`, status: 400},
		{name: "sends with Gmail TLS SMTP", body: `{` + credentials + `"operation":"send","message":{"to":["recipient@example.test"],"subject":"Subject","text":"Body"}}`, status: 502, address: "smtp.gmail.com:465"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dialed = ""
			log.Reset()
			var request *http.Request
			if tc.anonymous {
				request = httptest.NewRequest(http.MethodPost, path, strings.NewReader(tc.body))
			} else {
				request = authenticatedRequest(t, http.MethodPost, path, "admin-console")
				request.Body = io.NopCloser(strings.NewReader(tc.body))
			}
			if tc.origin != "" {
				request.Header.Set("Origin", tc.origin)
			}
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != tc.status || dialed != tc.address {
				t.Fatalf("got status %d and dial %q, want %d and %q: %s", response.Code, dialed, tc.status, tc.address, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" || strings.Contains(response.Body.String(), secret) || strings.Contains(log.String(), secret) {
				t.Fatal("temporary credential response must not be cached or disclose the secret in the response or logs")
			}
		})
	}
}
