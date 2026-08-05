package businessapi

import "testing"

func TestParseEmailFirstOutlookVendorFormatUsesIMAP(t *testing.T) {
	account, err := parseImportedMailAccount(
		"buyer@hotmail.com----mailbox-password----11111111-2222-3333-4444-555555555555----M.compatibility-refresh-token",
		defaultMailImportSeparator,
	)
	if err != nil {
		t.Fatal(err)
	}
	if account.Provider != "OUTLOOK" || account.AuthType != "MICROSOFT_OAUTH" {
		t.Fatalf("provider profile = %s/%s", account.Provider, account.AuthType)
	}
	if account.ProviderConfig.ReadMode != "IMAP_ONLY" {
		t.Fatalf("read mode = %q, want IMAP_ONLY", account.ProviderConfig.ReadMode)
	}
	if account.AccountLoginPassword == nil || *account.AccountLoginPassword != "mailbox-password" {
		t.Fatalf("account login password = %#v", account.AccountLoginPassword)
	}
	if account.ClientID == nil || *account.ClientID != "11111111-2222-3333-4444-555555555555" {
		t.Fatalf("client id = %#v", account.ClientID)
	}
	if account.RefreshToken == nil || *account.RefreshToken != "M.compatibility-refresh-token" {
		t.Fatalf("refresh token = %#v", account.RefreshToken)
	}
}
