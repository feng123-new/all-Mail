package businessapi

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPostgresAPIKeyAndExternalRouteIntegrationMailCredentialMigration(t *testing.T) {
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

	const encryptionKey = "pr35-node-format-test-key-0123456789"
	type fixture struct {
		email            string
		provider         string
		authType         string
		clientID         string
		clientSecret     string
		refreshToken     string
		password         string
		wantClientSecret string
		wantRefreshToken string
		wantPassword     string
	}
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	fixtures := []fixture{
		{
			email: "pr35-google-" + suffix + "@example.test", provider: "GMAIL", authType: "GOOGLE_OAUTH", clientID: "google-client-id",
			clientSecret:     "01010101010101010101010101010101:e98882f3e95b6d87dd1a062bbdeee086:943489867f8737a9aebdd4fc5fbe334baa16b3",
			refreshToken:     "02020202020202020202020202020202:8d6a9df3ee71bb7a8c93526bfaef2e2b:2435c36f5f89e370ad822359d45c8895716387",
			wantClientSecret: "gmail-client-secret", wantRefreshToken: "gmail-refresh-token",
		},
		{
			email: "pr35-microsoft-" + suffix + "@example.test", provider: "OUTLOOK", authType: "MICROSOFT_OAUTH", clientID: "microsoft-client-id",
			clientSecret:     "03030303030303030303030303030303:8866d475e5b8d5688e1f02d6bceed964:2aee804e38b066d8c2370c345a617c4c474a205bb5a5d6",
			refreshToken:     "04040404040404040404040404040404:03e27ac1d5906fea53d089eb0feae382:5e8522fc97a4a21e74d9ebc9375d27929477018c0bc118",
			wantClientSecret: "microsoft-client-secret", wantRefreshToken: "microsoft-refresh-token",
		},
		{
			email: "pr35-app-password-" + suffix + "@example.test", provider: "QQ", authType: "APP_PASSWORD",
			password:     "05050505050505050505050505050505:e812c5d375f13746ce2522dc08e103bc:d6f4c55559dd8cd0de0c2bd2",
			wantPassword: "app-password",
		},
	}
	ids := make([]int64, 0, len(fixtures))
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if len(ids) > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_accounts WHERE id = ANY($1::bigint[])`, ids)
		}
	}()

	for _, item := range fixtures {
		for _, envelope := range []string{item.clientSecret, item.refreshToken, item.password} {
			if envelope != "" {
				assertNodeCipherEnvelope(t, envelope)
			}
		}
		var id int64
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO email_accounts (
				email, provider, auth_type, client_id, client_secret, refresh_token, password,
				provider_config, capabilities, status, mailbox_status, created_at, updated_at
			)
			VALUES ($1, $2::"MailProvider", $3::"MailAuthType", NULLIF($4, ''), NULLIF($5, ''),
			        NULLIF($6, ''), NULLIF($7, ''), '{}'::jsonb, '{}'::jsonb, 'ACTIVE', '{}'::jsonb,
			        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id
		`, item.email, item.provider, item.authType, item.clientID, item.clientSecret, item.refreshToken, item.password).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
		credentials, err := store.loadMailAccountCredentials(ctx, id, encryptionKey)
		if err != nil {
			t.Fatal(err)
		}
		if credentials.ClientSecret != item.wantClientSecret || credentials.RefreshToken != item.wantRefreshToken || credentials.Password != item.wantPassword {
			t.Fatalf("credentials for %s = clientSecret %q, refreshToken %q, password %q", item.authType, credentials.ClientSecret, credentials.RefreshToken, credentials.Password)
		}
	}
}

func assertNodeCipherEnvelope(t *testing.T, envelope string) {
	t.Helper()
	parts := strings.Split(envelope, ":")
	if len(parts) != 3 {
		t.Fatalf("Node cipher envelope has %d parts", len(parts))
	}
	for index, part := range parts {
		decoded, err := hex.DecodeString(part)
		if err != nil || len(decoded) == 0 {
			t.Fatalf("Node cipher envelope part %d is invalid: %v", index, err)
		}
	}
	if len(parts[0]) != 32 || len(parts[1]) != 32 {
		t.Fatalf("Node cipher envelope IV/tag lengths = %d/%d", len(parts[0]), len(parts[1]))
	}
}
