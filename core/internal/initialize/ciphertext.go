package initialize

import (
	"context"
	"fmt"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"github.com/jackc/pgx/v5"
)

func VerifyCiphertexts(ctx context.Context, databaseURL, encryptionKey string) (int, error) {
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return 0, fmt.Errorf("connect ciphertext verification: %w", err)
	}
	defer connection.Close(context.Background())
	transaction, err := connection.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return 0, fmt.Errorf("begin ciphertext verification: %w", err)
	}
	defer transaction.Rollback(context.Background())
	rows, err := transaction.Query(ctx, ciphertextInventorySQL)
	if err != nil {
		return 0, fmt.Errorf("read ciphertext inventory: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var category, rowID, ciphertext string
		if err := rows.Scan(&category, &rowID, &ciphertext); err != nil {
			return count, fmt.Errorf("scan ciphertext inventory: %w", err)
		}
		plaintext, err := legacycrypto.Decrypt(encryptionKey, ciphertext)
		if err != nil {
			return count, fmt.Errorf("decrypt %s row %s: %w", category, rowID, err)
		}
		rewritten, err := legacycrypto.Encrypt(encryptionKey, plaintext)
		if err != nil {
			return count, fmt.Errorf("rewrite-check %s row %s: %w", category, rowID, err)
		}
		roundTrip, err := legacycrypto.Decrypt(encryptionKey, rewritten)
		if err != nil || roundTrip != plaintext {
			return count, fmt.Errorf("rewrite-check %s row %s did not round trip", category, rowID)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return count, fmt.Errorf("read ciphertext inventory: %w", err)
	}
	return count, nil
}

const ciphertextInventorySQL = `
SELECT 'admins.two_factor_secret', id::text, two_factor_secret FROM admins WHERE two_factor_secret IS NOT NULL
UNION ALL SELECT 'admins.two_factor_temp_secret', id::text, two_factor_temp_secret FROM admins WHERE two_factor_temp_secret IS NOT NULL
UNION ALL SELECT 'mailbox_users.two_factor_secret', id::text, two_factor_secret FROM mailbox_users WHERE two_factor_secret IS NOT NULL
UNION ALL SELECT 'provider_oauth_configs.client_secret', id::text, client_secret FROM provider_oauth_configs WHERE client_secret IS NOT NULL
UNION ALL SELECT 'email_accounts.client_secret', id::text, client_secret FROM email_accounts WHERE client_secret IS NOT NULL
UNION ALL SELECT 'email_accounts.refresh_token', id::text, refresh_token FROM email_accounts WHERE refresh_token IS NOT NULL
UNION ALL SELECT 'email_accounts.password', id::text, password FROM email_accounts WHERE password IS NOT NULL
UNION ALL SELECT 'email_accounts.account_login_password', id::text, account_login_password FROM email_accounts WHERE account_login_password IS NOT NULL
UNION ALL SELECT 'domain_sending_configs.api_key_encrypted', id::text, api_key_encrypted FROM domain_sending_configs WHERE api_key_encrypted IS NOT NULL
UNION ALL SELECT 'ingress_endpoints.signing_secret_encrypted', id::text, signing_secret_encrypted FROM ingress_endpoints WHERE signing_secret_encrypted IS NOT NULL
UNION ALL SELECT 'domains.dns_status.cloudflare.apiTokenEncrypted', id::text, dns_status #>> '{cloudflare,apiTokenEncrypted}' FROM domains WHERE dns_status #>> '{cloudflare,apiTokenEncrypted}' IS NOT NULL
ORDER BY 1, 2
`
