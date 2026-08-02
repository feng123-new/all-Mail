package initialize

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"github.com/feng123-new/all-Mail/core/internal/oauthscope"
	"github.com/jackc/pgx/v5"
)

type ImportSummary struct {
	OAuthImported    []string
	OAuthUnchanged   []string
	SendApproved     []string
	IngressImported  []string
	IngressUnchanged []string
}

type oauthImport struct {
	Provider     string
	ClientID     string
	ClientSecret string
	RedirectURI  string
	Scopes       *string
	Tenant       *string
}

func ImportEnvironment(ctx context.Context, databaseURL, encryptionKey string, environment map[string]string) (ImportSummary, error) {
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return ImportSummary{}, fmt.Errorf("connect environment import: %w", err)
	}
	defer connection.Close(context.Background())
	transaction, err := connection.Begin(ctx)
	if err != nil {
		return ImportSummary{}, fmt.Errorf("begin environment import: %w", err)
	}
	defer transaction.Rollback(context.Background())
	summary := ImportSummary{}
	for _, provider := range []string{"GMAIL", "OUTLOOK"} {
		desired, err := buildOAuthImport(provider, environment)
		if err != nil {
			return ImportSummary{}, err
		}
		if desired != nil {
			if err := importOAuth(ctx, transaction, encryptionKey, *desired, &summary); err != nil {
				return ImportSummary{}, err
			}
		}
	}
	if err := importSendApprovals(ctx, transaction, environment, &summary); err != nil {
		return ImportSummary{}, err
	}
	if err := importIngress(ctx, transaction, encryptionKey, environment, &summary); err != nil {
		return ImportSummary{}, err
	}
	if err := normalizeStoredOAuthScopes(ctx, transaction); err != nil {
		return ImportSummary{}, err
	}
	if err := backfillOAuthAuthority(ctx, transaction); err != nil {
		return ImportSummary{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return ImportSummary{}, fmt.Errorf("commit environment import: %w", err)
	}
	return summary, nil
}

func normalizeStoredOAuthScopes(ctx context.Context, tx pgx.Tx) error {
	rows, err := tx.Query(ctx, `SELECT id, provider::text, COALESCE(scopes, '') FROM provider_oauth_configs ORDER BY id`)
	if err != nil {
		return fmt.Errorf("list stored OAuth scopes: %w", err)
	}
	type storedScope struct {
		ID       int64
		Provider string
		Scopes   string
	}
	var records []storedScope
	for rows.Next() {
		var record storedScope
		if err := rows.Scan(&record.ID, &record.Provider, &record.Scopes); err != nil {
			rows.Close()
			return fmt.Errorf("scan stored OAuth scope: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate stored OAuth scopes: %w", err)
	}
	rows.Close()
	for _, record := range records {
		normalized, _, err := oauthscope.Normalize(record.Provider, record.Scopes)
		if err != nil {
			return fmt.Errorf("normalize stored %s OAuth scopes: %w", record.Provider, err)
		}
		if normalized == strings.TrimSpace(record.Scopes) {
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE provider_oauth_configs SET scopes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, record.ID, normalized); err != nil {
			return fmt.Errorf("update stored %s OAuth scopes: %w", record.Provider, err)
		}
	}
	return nil
}

func backfillOAuthAuthority(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `
		UPDATE email_accounts AS account
		SET provider_config = COALESCE(account.provider_config, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
			'oauthTenant', CASE
				WHEN COALESCE(account.provider_config->>'oauthTenant', '') = '' THEN NULLIF(provider.tenant, '')
				ELSE NULL
			END,
			'oauthScopes', CASE
				WHEN COALESCE(account.provider_config->>'oauthScopes', '') = '' THEN NULLIF(provider.scopes, '')
				ELSE NULL
			END
		))
		FROM provider_oauth_configs AS provider
		WHERE account.provider::text = provider.provider::text
		  AND account.auth_type::text IN ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH')
		  AND account.client_id = provider.client_id
		  AND (
			COALESCE(account.provider_config->>'oauthTenant', '') = ''
			OR COALESCE(account.provider_config->>'oauthScopes', '') = ''
		  )
	`); err != nil {
		return fmt.Errorf("backfill OAuth account authority: %w", err)
	}
	var incomplete bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM email_accounts AS account
			JOIN provider_oauth_configs AS provider
			  ON account.provider::text = provider.provider::text
			 AND account.client_id = provider.client_id
			WHERE account.auth_type::text IN ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH')
			  AND (
				(COALESCE(provider.tenant, '') <> '' AND COALESCE(account.provider_config->>'oauthTenant', '') = '')
				OR (COALESCE(provider.scopes, '') <> '' AND COALESCE(account.provider_config->>'oauthScopes', '') = '')
			  )
		)
	`).Scan(&incomplete); err != nil {
		return fmt.Errorf("validate OAuth account authority: %w", err)
	}
	if incomplete {
		return errors.New("OAuth account authority backfill is incomplete")
	}
	return nil
}

func buildOAuthImport(provider string, environment map[string]string) (*oauthImport, error) {
	prefix := "GOOGLE"
	if provider == "OUTLOOK" {
		prefix = "MICROSOFT"
	}
	clientID := strings.TrimSpace(environment[prefix+"_OAUTH_CLIENT_ID"])
	clientSecret := strings.TrimSpace(environment[prefix+"_OAUTH_CLIENT_SECRET"])
	redirectURI := strings.TrimSpace(environment[prefix+"_OAUTH_REDIRECT_URI"])
	if clientID == "" && clientSecret == "" {
		return nil, nil
	}
	if clientID == "" || clientSecret == "" || redirectURI == "" {
		return nil, fmt.Errorf("%s OAuth environment import requires client id, client secret, and redirect URI", provider)
	}
	parsed, err := url.Parse(redirectURI)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("%s OAuth redirect URI must be an absolute HTTP(S) URL", provider)
	}
	normalizedScopes, _, err := oauthscope.Normalize(provider, environment[prefix+"_OAUTH_SCOPES"])
	if err != nil {
		return nil, fmt.Errorf("%s OAuth scopes: %w", provider, err)
	}
	result := &oauthImport{
		Provider:     provider,
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURI:  redirectURI,
		Scopes:       &normalizedScopes,
	}
	if provider == "OUTLOOK" {
		result.Tenant = pointer(strings.TrimSpace(environment["MICROSOFT_OAUTH_TENANT"]))
	}
	return result, nil
}

func importOAuth(ctx context.Context, tx pgx.Tx, encryptionKey string, desired oauthImport, summary *ImportSummary) error {
	var currentID int64
	var currentClientID, currentSecret, currentRedirect, currentScopes, currentTenant *string
	err := tx.QueryRow(ctx, `
		SELECT id, client_id, client_secret, redirect_uri, scopes, tenant
		FROM provider_oauth_configs WHERE provider = $1::"MailProvider"
	`, desired.Provider).Scan(&currentID, &currentClientID, &currentSecret, &currentRedirect, &currentScopes, &currentTenant)
	if err != nil && !noRows(err) {
		return fmt.Errorf("read %s OAuth configuration: %w", desired.Provider, err)
	}
	if noRows(err) {
		currentID = 0
		currentClientID, currentSecret, currentRedirect, currentScopes, currentTenant = nil, nil, nil, nil, nil
	}
	var currentPlaintext *string
	if currentSecret != nil {
		plaintext, err := legacycrypto.Decrypt(encryptionKey, *currentSecret)
		if err != nil {
			return fmt.Errorf("decrypt %s OAuth client secret: %w", desired.Provider, err)
		}
		currentPlaintext = &plaintext
	}
	currentScopesValue, _, err := oauthscope.Normalize(desired.Provider, value(currentScopes))
	if err != nil {
		return fmt.Errorf("normalize %s OAuth database scopes: %w", desired.Provider, err)
	}
	normalizedCurrentScopes := &currentScopesValue
	normalizedCurrentTenant := pointer(strings.TrimSpace(value(currentTenant)))
	if conflicts(currentClientID, desired.ClientID) || conflicts(currentPlaintext, desired.ClientSecret) || conflicts(currentRedirect, desired.RedirectURI) || optionalConflict(normalizedCurrentScopes, desired.Scopes) || optionalConflict(normalizedCurrentTenant, desired.Tenant) {
		return fmt.Errorf("%s OAuth database configuration conflicts with the legacy environment values", desired.Provider)
	}
	if equal(currentClientID, desired.ClientID) && equal(currentPlaintext, desired.ClientSecret) && equal(currentRedirect, desired.RedirectURI) && optionalComplete(normalizedCurrentScopes, desired.Scopes) && optionalComplete(normalizedCurrentTenant, desired.Tenant) {
		summary.OAuthUnchanged = append(summary.OAuthUnchanged, desired.Provider)
		return nil
	}
	nextSecret := currentSecret
	if nextSecret == nil {
		encrypted, err := legacycrypto.Encrypt(encryptionKey, desired.ClientSecret)
		if err != nil {
			return fmt.Errorf("encrypt %s OAuth client secret: %w", desired.Provider, err)
		}
		nextSecret = &encrypted
	}
	nextClientID := currentClientID
	if nextClientID == nil {
		nextClientID = &desired.ClientID
	}
	nextRedirect := currentRedirect
	if nextRedirect == nil {
		nextRedirect = &desired.RedirectURI
	}
	nextScopes := normalizedCurrentScopes
	if nextScopes == nil {
		nextScopes = desired.Scopes
	}
	nextTenant := normalizedCurrentTenant
	if nextTenant == nil {
		nextTenant = desired.Tenant
	}
	if currentID == 0 {
		_, err = tx.Exec(ctx, `
			INSERT INTO provider_oauth_configs (provider, client_id, client_secret, redirect_uri, scopes, tenant, created_at, updated_at)
			VALUES ($1::"MailProvider", $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		`, desired.Provider, nullableString(nextClientID), nullableString(nextSecret), nullableString(nextRedirect), nullableString(nextScopes), nullableString(nextTenant))
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE provider_oauth_configs
			SET client_id = $2, client_secret = $3, redirect_uri = $4, scopes = $5, tenant = $6, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, currentID, nullableString(nextClientID), nullableString(nextSecret), nullableString(nextRedirect), nullableString(nextScopes), nullableString(nextTenant))
	}
	if err != nil {
		return fmt.Errorf("store %s OAuth configuration: %w", desired.Provider, err)
	}
	summary.OAuthImported = append(summary.OAuthImported, desired.Provider)
	return nil
}

func importSendApprovals(ctx context.Context, tx pgx.Tx, environment map[string]string, summary *ImportSummary) error {
	names := uniqueNormalized(strings.Split(environment["SEND_ENABLED_DOMAINS"], ","), true)
	var missing []string
	for _, name := range names {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT id FROM domains WHERE name = $1`, name).Scan(&id); err != nil {
			if noRows(err) {
				missing = append(missing, name)
				continue
			}
			return fmt.Errorf("read send-enabled domain %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE domains
			SET send_approved = true,
				send_approved_at = COALESCE(send_approved_at, CURRENT_TIMESTAMP),
				send_approval_source = COALESCE(send_approval_source, 'environment-import'),
				updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND send_approved = false
		`, id); err != nil {
			return fmt.Errorf("approve send-enabled domain %s: %w", name, err)
		}
		summary.SendApproved = append(summary.SendApproved, name)
	}
	if len(missing) > 0 {
		return fmt.Errorf("SEND_ENABLED_DOMAINS contains unknown domains: %s", strings.Join(missing, ", "))
	}
	return nil
}

func importIngress(ctx context.Context, tx pgx.Tx, encryptionKey string, environment map[string]string, summary *ImportSummary) error {
	secret := strings.TrimSpace(environment["INGRESS_SIGNING_SECRET"])
	if secret == "" {
		return nil
	}
	if len(secret) < 16 || hasPlaceholderPrefix(strings.ToLower(secret)) {
		return errors.New("INGRESS_SIGNING_SECRET must contain at least 16 non-placeholder characters")
	}
	keyID := strings.TrimSpace(environment["INGRESS_IMPORT_KEY_ID"])
	if keyID == "" {
		keyID = "allmail-edge-main"
	}
	hash := sha256.Sum256([]byte(secret))
	hashText := hex.EncodeToString(hash[:])
	var id int64
	var currentHash, currentEncrypted *string
	err := tx.QueryRow(ctx, `
		SELECT id, signing_key_hash, signing_secret_encrypted FROM ingress_endpoints WHERE key_id = $1
	`, keyID).Scan(&id, &currentHash, &currentEncrypted)
	if noRows(err) {
		err = tx.QueryRow(ctx, `
			INSERT INTO ingress_endpoints (key_id, name, provider, signing_key_hash, status, created_at, updated_at)
			VALUES ($1, 'environment-imported ingress endpoint', 'CLOUDFLARE_WORKER', $2, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id
		`, keyID, hashText).Scan(&id)
		currentHash, currentEncrypted = &hashText, nil
	}
	if err != nil {
		return fmt.Errorf("read or create ingress endpoint %s: %w", keyID, err)
	}
	if currentHash != nil && *currentHash != hashText {
		return fmt.Errorf("ingress endpoint %s conflicts with the legacy environment signing secret", keyID)
	}
	if currentEncrypted != nil {
		plaintext, err := legacycrypto.Decrypt(encryptionKey, *currentEncrypted)
		if err != nil || plaintext != secret {
			return fmt.Errorf("ingress endpoint %s contains a different encrypted signing secret", keyID)
		}
		summary.IngressUnchanged = append(summary.IngressUnchanged, keyID)
		return nil
	}
	encrypted, err := legacycrypto.Encrypt(encryptionKey, secret)
	if err != nil {
		return fmt.Errorf("encrypt ingress signing secret: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE ingress_endpoints
		SET signing_key_hash = $2, signing_secret_encrypted = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, hashText, encrypted); err != nil {
		return fmt.Errorf("store ingress signing secret: %w", err)
	}
	summary.IngressImported = append(summary.IngressImported, keyID)
	return nil
}

func normalizeScopes(input string) *string {
	values := uniqueNormalized(strings.Fields(strings.TrimSpace(input)), false)
	if len(values) == 0 {
		return nil
	}
	result := strings.Join(values, " ")
	return &result
}

func uniqueNormalized(values []string, lowercase bool) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0, len(values))
	for _, item := range values {
		item = strings.TrimSpace(item)
		if lowercase {
			item = strings.ToLower(item)
		}
		if item == "" {
			continue
		}
		if _, exists := seen[item]; exists {
			continue
		}
		seen[item] = struct{}{}
		result = append(result, item)
	}
	return result
}

func value(input *string) string {
	if input == nil {
		return ""
	}
	return *input
}

func conflicts(current *string, desired string) bool {
	return current != nil && *current != desired
}

func optionalConflict(current, desired *string) bool {
	return current != nil && desired != nil && *current != *desired
}

func equal(current *string, desired string) bool {
	return current != nil && *current == desired
}

func optionalComplete(current, desired *string) bool {
	return desired == nil || (current != nil && *current == *desired)
}

func hasPlaceholderPrefix(value string) bool {
	for _, prefix := range []string{"replace-with-", "changeme-", "example-"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}
