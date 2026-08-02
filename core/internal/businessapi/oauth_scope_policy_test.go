package businessapi

import (
	"strings"
	"testing"
)

func TestOAuthDefaultScopesAreLeastPrivilege(t *testing.T) {
	google := oauthScopes(oauthProviderConfig{Provider: "GMAIL"})
	if !strings.Contains(google, "gmail.readonly") || strings.Contains(google, "gmail.modify") || strings.Contains(google, "mail.google.com") {
		t.Fatalf("Google default scopes = %q", google)
	}
	microsoft := oauthScopes(oauthProviderConfig{Provider: "OUTLOOK"})
	if !strings.Contains(microsoft, "Mail.Read") || strings.Contains(microsoft, "Mail.ReadWrite") || strings.Contains(microsoft, "Mail.Send") {
		t.Fatalf("Microsoft default scopes = %q", microsoft)
	}
}
