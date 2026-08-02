package oauthscope

import (
	"strings"
	"testing"
)

func TestCanonicalDefaultsAreLeastPrivilege(t *testing.T) {
	google, err := Canonical("GMAIL", Minimal)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(google, "gmail.readonly") || strings.Contains(google, "gmail.modify") || strings.Contains(google, "mail.google.com") {
		t.Fatalf("Google minimal scopes = %q", google)
	}
	microsoft, err := Canonical("OUTLOOK", Minimal)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(microsoft, "Mail.Read") || strings.Contains(microsoft, "Mail.ReadWrite") || strings.Contains(microsoft, "Mail.Send") {
		t.Fatalf("Microsoft minimal scopes = %q", microsoft)
	}
}

func TestNormalizeMapsLegacyBroadDefaultsToExplicitFull(t *testing.T) {
	google, profile, err := Normalize("GOOGLE", "openid email profile https://www.googleapis.com/auth/gmail.modify https://mail.google.com/")
	if err != nil || profile != Full || strings.Contains(google, "gmail.modify") {
		t.Fatalf("Google normalization = %q, %q, %v", google, profile, err)
	}
	microsoft, profile, err := Normalize("MICROSOFT", "offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite")
	if err != nil || profile != Full || !strings.Contains(microsoft, "Contacts.ReadWrite") {
		t.Fatalf("Microsoft normalization = %q, %q, %v", microsoft, profile, err)
	}
}

func TestNormalizeRejectsIncompleteOrUnknownScopeSets(t *testing.T) {
	for _, test := range []struct {
		provider string
		scopes   string
	}{
		{"GMAIL", "openid email profile"},
		{"GMAIL", "openid email profile https://www.googleapis.com/auth/drive"},
		{"OUTLOOK", "offline_access openid profile email https://graph.microsoft.com/User.Read"},
		{"OUTLOOK", "offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Files.ReadWrite"},
	} {
		if _, _, err := Normalize(test.provider, test.scopes); err == nil {
			t.Fatalf("accepted %s scopes %q", test.provider, test.scopes)
		}
	}
}
