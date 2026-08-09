package businessapi

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

const defaultMailImportSeparator = "----"

type importedMailAccount struct {
	Email                string
	Provider             string
	AuthType             string
	ClientID             *string
	ClientSecret         *string
	RefreshToken         *string
	Password             *string
	AccountLoginPassword *string
	ProviderConfig       mailProviderConfig
}

type exportMailAccountRow struct {
	Email                string
	Provider             string
	AuthType             string
	ClientID             sql.NullString
	ClientSecret         sql.NullString
	RefreshToken         sql.NullString
	Password             sql.NullString
	AccountLoginPassword sql.NullString
	ProviderConfig       []byte
}

func (s *Server) importMailAccounts(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body importMailAccountsRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.Content = strings.TrimSpace(body.Content)
	if body.Content == "" {
		s.writeRequestError(w, r, validationError("content is required"))
		return
	}
	separator := body.Separator
	if separator == "" {
		separator = defaultMailImportSeparator
	}
	if len(separator) > 32 || strings.ContainsAny(separator, "\r\n") {
		s.writeRequestError(w, r, validationError("separator must be a single-line value no longer than 32 bytes"))
		return
	}
	if err := store.ensureEmailGroup(r.Context(), body.GroupID); err != nil {
		s.writeStoreError(w, r, "validate import group", err)
		return
	}
	lines := strings.Split(body.Content, "\n")
	if len(lines) > 10_000 {
		s.writeRequestError(w, r, validationError("content contains more than 10000 lines"))
		return
	}
	success := 0
	failed := 0
	errorsList := make([]string, 0)
	for _, rawLine := range lines {
		line := strings.TrimSpace(strings.TrimSuffix(rawLine, "\r"))
		if line == "" {
			continue
		}
		parsed, parseErr := parseImportedMailAccount(line, separator)
		if parseErr == nil {
			parseErr = store.upsertImportedMailAccount(r.Context(), parsed, body.GroupID, s.cfg.EncryptionKey)
		}
		if parseErr != nil {
			failed++
			preview := line
			if len(preview) > 50 {
				preview = preview[:50]
			}
			errorsList = append(errorsList, fmt.Sprintf("Line %q: %s", preview, boundedProviderError(parseErr)))
			continue
		}
		success++
	}
	if success == 0 && failed > 0 {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "IMPORT_FAILED", Cause: fmt.Errorf("import failed for all %d lines", failed)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]any{"success": success, "failed": failed, "errors": errorsList},
	})
}

func (s *Server) exportMailAccounts(w http.ResponseWriter, r *http.Request, admin Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	ids, err := parseExportMailAccountIDs(r.URL.Query().Get("ids"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	groupID, err := parseOptionalPositiveQueryID(r, "groupId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	separator := r.URL.Query().Get("separator")
	if separator == "" {
		separator = defaultMailImportSeparator
	}
	if len(separator) > 32 || strings.ContainsAny(separator, "\r\n") {
		s.writeRequestError(w, r, validationError("separator must be a single-line value no longer than 32 bytes"))
		return
	}
	rawSecrets := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("rawSecrets")), "true")
	if rawSecrets && admin.Role != "SUPER_ADMIN" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN"})
		return
	}
	content, err := store.exportMailAccounts(r.Context(), ids, groupID, separator, rawSecrets, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "export mail accounts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]string{"content": content}})
}

func parseExportMailAccountIDs(value string) ([]int64, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	parts := strings.Split(value, ",")
	if len(parts) > 1000 {
		return nil, validationError("ids contains more than 1000 values")
	}
	ids := make([]int64, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || id <= 0 {
			return nil, validationError("ids must be a comma-separated list of positive integers")
		}
		ids = append(ids, id)
	}
	return normalizeManagementIDs(ids), nil
}

func parseImportedMailAccount(line, separator string) (importedMailAccount, error) {
	parts := strings.Split(line, separator)
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	if len(parts) < 2 {
		return importedMailAccount{}, fmt.Errorf("invalid format")
	}
	if provider, authType, ok := importTokenProfile(parts[0]); ok {
		return parseTokenizedImportedMailAccount(parts, provider, authType)
	}
	if strings.Contains(parts[0], "@") {
		return parseEmailFirstImportedMailAccount(parts)
	}
	return parseLegacyOutlookImport(parts)
}

func parseTokenizedImportedMailAccount(parts []string, provider, authType string) (importedMailAccount, error) {
	if len(parts) < 3 || validateEmailAddress(strings.ToLower(parts[1])) != nil {
		return importedMailAccount{}, fmt.Errorf("invalid email address")
	}
	result := importedMailAccount{
		Email:          strings.ToLower(parts[1]),
		Provider:       provider,
		AuthType:       authType,
		ProviderConfig: defaultProviderConfig(provider),
	}
	if authType != "APP_PASSWORD" {
		if len(parts) < 5 || parts[2] == "" || parts[4] == "" {
			return importedMailAccount{}, fmt.Errorf("OAuth format requires token, email, clientId, clientSecret, and refreshToken")
		}
		result.ClientID = stringPointer(parts[2])
		result.ClientSecret = optionalStringPointer(parts[3])
		result.RefreshToken = stringPointer(parts[4])
		if len(parts) > 5 {
			result.AccountLoginPassword = optionalStringPointer(parts[5])
		}
		if len(parts) > 6 {
			config, err := decodeImportedOAuthProviderConfig(provider, parts[6])
			if err != nil {
				return importedMailAccount{}, err
			}
			result.ProviderConfig = config
		}
		return result, nil
	}
	if parts[2] == "" {
		return importedMailAccount{}, fmt.Errorf("application password is required")
	}
	result.Password = stringPointer(parts[2])
	if len(parts) >= 12 {
		result.ProviderConfig = mailProviderConfig{
			ReadMode:   "IMAP",
			IMAPHost:   parts[3],
			IMAPPort:   parsePortOrDefault(parts[4], 993),
			IMAPTLS:    boolPointer(parseBoolOrDefault(parts[5], true)),
			SMTPHost:   parts[6],
			SMTPPort:   parsePortOrDefault(parts[7], 465),
			SMTPSecure: boolPointer(parseBoolOrDefault(parts[8], true)),
			Folders: map[string]string{
				"inbox": defaultString(parts[9], "INBOX"),
				"junk":  defaultString(parts[10], "Junk"),
				"sent":  defaultString(parts[11], "Sent"),
			},
		}
		if len(parts) > 12 {
			result.AccountLoginPassword = optionalStringPointer(parts[12])
		}
	} else if len(parts) > 3 {
		result.AccountLoginPassword = optionalStringPointer(parts[3])
	}
	if result.ProviderConfig.IMAPHost == "" || result.ProviderConfig.SMTPHost == "" {
		return importedMailAccount{}, fmt.Errorf("IMAP and SMTP hosts are required")
	}
	return result, nil
}

func parseEmailFirstImportedMailAccount(parts []string) (importedMailAccount, error) {
	email := strings.ToLower(parts[0])
	if err := validateEmailAddress(email); err != nil {
		return importedMailAccount{}, err
	}
	provider, passwordProfile := inferProviderFromEmail(email)
	if provider == "" {
		provider = "OUTLOOK"
	}
	if len(parts) == 2 && passwordProfile {
		return importedMailAccount{
			Email: email, Provider: provider, AuthType: "APP_PASSWORD",
			Password: stringPointer(parts[1]), ProviderConfig: defaultProviderConfig(provider),
		}, nil
	}
	if len(parts) == 3 && passwordProfile && !looksLikeOAuthClientID(parts[1]) {
		return importedMailAccount{
			Email: email, Provider: provider, AuthType: "APP_PASSWORD",
			Password: stringPointer(parts[1]), AccountLoginPassword: optionalStringPointer(parts[2]),
			ProviderConfig: defaultProviderConfig(provider),
		}, nil
	}
	if len(parts) == 3 && looksLikeOAuthClientID(parts[1]) && looksLikeRefreshToken(parts[2]) {
		return importedMailAccount{
			Email: email, Provider: provider, AuthType: oauthAuthType(provider),
			ClientID: stringPointer(parts[1]), RefreshToken: stringPointer(parts[2]),
			ProviderConfig: defaultProviderConfig(provider),
		}, nil
	}
	if len(parts) >= 4 {
		providerConfig := defaultProviderConfig(provider)
		if provider == "OUTLOOK" {
			providerConfig.ReadMode = "IMAP_ONLY"
		}
		result := importedMailAccount{
			Email: email, Provider: provider, AuthType: oauthAuthType(provider),
			AccountLoginPassword: optionalStringPointer(parts[1]),
			ClientID:             optionalStringPointer(parts[2]),
			RefreshToken:         optionalStringPointer(parts[3]),
			ProviderConfig:       providerConfig,
		}
		if len(parts) > 4 {
			result.ClientSecret = optionalStringPointer(parts[4])
		}
		if result.ClientID == nil || result.RefreshToken == nil {
			return importedMailAccount{}, fmt.Errorf("OAuth import is missing clientId or refreshToken")
		}
		return result, nil
	}
	return importedMailAccount{}, fmt.Errorf("unrecognized email-first import format")
}

func parseLegacyOutlookImport(parts []string) (importedMailAccount, error) {
	if len(parts) < 3 {
		return importedMailAccount{}, fmt.Errorf("legacy format requires at least three columns")
	}
	result := importedMailAccount{Provider: "OUTLOOK", AuthType: "MICROSOFT_OAUTH", ProviderConfig: defaultProviderConfig("OUTLOOK")}
	if len(parts) >= 5 && strings.EqualFold(parts[3], "oauth") {
		result.Email, result.ClientID, result.ClientSecret, result.RefreshToken = strings.ToLower(parts[0]), optionalStringPointer(parts[1]), optionalStringPointer(parts[2]), optionalStringPointer(parts[4])
	} else if len(parts) >= 5 {
		result.Email, result.ClientID, result.RefreshToken = strings.ToLower(parts[0]), optionalStringPointer(parts[1]), optionalStringPointer(parts[4])
	} else if len(parts) == 4 {
		result.Email, result.AccountLoginPassword, result.ClientID, result.RefreshToken = strings.ToLower(parts[0]), optionalStringPointer(parts[1]), optionalStringPointer(parts[2]), optionalStringPointer(parts[3])
	} else {
		result.Email, result.ClientID, result.RefreshToken = strings.ToLower(parts[0]), optionalStringPointer(parts[1]), optionalStringPointer(parts[2])
	}
	if err := validateEmailAddress(result.Email); err != nil || result.ClientID == nil || result.RefreshToken == nil {
		return importedMailAccount{}, fmt.Errorf("legacy Outlook import is missing required fields")
	}
	return result, nil
}

func importTokenProfile(value string) (string, string, bool) {
	profiles := map[string][2]string{
		"OUTLOOK_OAUTH":             {"OUTLOOK", "MICROSOFT_OAUTH"},
		"GMAIL_OAUTH":               {"GMAIL", "GOOGLE_OAUTH"},
		"GMAIL_APP_PASSWORD":        {"GMAIL", "APP_PASSWORD"},
		"QQ_IMAP_SMTP":              {"QQ", "APP_PASSWORD"},
		"NETEASE_163_IMAP_SMTP":     {"NETEASE_163", "APP_PASSWORD"},
		"NETEASE_126_IMAP_SMTP":     {"NETEASE_126", "APP_PASSWORD"},
		"ICLOUD_IMAP_SMTP":          {"ICLOUD", "APP_PASSWORD"},
		"YAHOO_IMAP_SMTP":           {"YAHOO", "APP_PASSWORD"},
		"ZOHO_IMAP_SMTP":            {"ZOHO", "APP_PASSWORD"},
		"ALIYUN_IMAP_SMTP":          {"ALIYUN", "APP_PASSWORD"},
		"AMAZON_WORKMAIL_IMAP_SMTP": {"AMAZON_WORKMAIL", "APP_PASSWORD"},
		"FASTMAIL_IMAP_SMTP":        {"FASTMAIL", "APP_PASSWORD"},
		"AOL_IMAP_SMTP":             {"AOL", "APP_PASSWORD"},
		"GMX_IMAP_SMTP":             {"GMX", "APP_PASSWORD"},
		"MAILCOM_IMAP_SMTP":         {"MAILCOM", "APP_PASSWORD"},
		"YANDEX_IMAP_SMTP":          {"YANDEX", "APP_PASSWORD"},
		"CUSTOM_IMAP_SMTP":          {"CUSTOM_IMAP_SMTP", "APP_PASSWORD"},
	}
	profile, ok := profiles[strings.ToUpper(strings.TrimSpace(value))]
	return profile[0], profile[1], ok
}

func inferProviderFromEmail(email string) (string, bool) {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return "", false
	}
	domain := strings.ToLower(strings.TrimSpace(parts[1]))
	switch domain {
	case "gmail.com":
		return "GMAIL", true
	case "qq.com":
		return "QQ", true
	case "163.com":
		return "NETEASE_163", true
	case "126.com":
		return "NETEASE_126", true
	case "icloud.com", "me.com", "mac.com":
		return "ICLOUD", true
	case "yahoo.com":
		return "YAHOO", true
	case "zoho.com":
		return "ZOHO", true
	case "aliyun.com":
		return "ALIYUN", true
	case "fastmail.com":
		return "FASTMAIL", true
	case "aol.com":
		return "AOL", true
	case "gmx.com":
		return "GMX", true
	case "mail.com":
		return "MAILCOM", true
	case "yandex.com", "yandex.ru", "ya.ru":
		return "YANDEX", true
	case "outlook.com", "hotmail.com", "live.com", "msn.com":
		return "OUTLOOK", false
	default:
		return "", false
	}
}

func oauthAuthType(provider string) string {
	if provider == "GMAIL" {
		return "GOOGLE_OAUTH"
	}
	return "MICROSOFT_OAUTH"
}

func looksLikeOAuthClientID(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasSuffix(strings.ToLower(value), ".apps.googleusercontent.com") || (len(value) == 36 && strings.Count(value, "-") == 4)
}

func looksLikeRefreshToken(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "M.") || strings.HasPrefix(value, "1//") || strings.HasPrefix(value, "ya29.")
}

func (s *PostgresStore) upsertImportedMailAccount(ctx context.Context, imported importedMailAccount, groupID *int64, encryptionKey string) error {
	input := mailAccountCreateInput{
		Email:                imported.Email,
		Provider:             imported.Provider,
		AuthType:             imported.AuthType,
		ClientID:             imported.ClientID,
		ClientSecret:         imported.ClientSecret,
		RefreshToken:         imported.RefreshToken,
		Password:             imported.Password,
		AccountLoginPassword: imported.AccountLoginPassword,
		GroupID:              groupID,
		ProviderConfig:       imported.ProviderConfig,
		Capabilities:         map[string]any{},
	}
	var err error
	input.ProviderConfig, err = s.completeOAuthAccountProviderConfig(ctx, input.Provider, input.ClientID, input.ProviderConfig)
	if err != nil {
		return err
	}
	if err := validateMailAccountInput(input.Provider, input.AuthType, input.ClientID, input.RefreshToken, input.Password, input.ProviderConfig); err != nil {
		return err
	}
	config, err := marshalProviderConfig(input.ProviderConfig)
	if err != nil {
		return err
	}
	encryptValue := func(value *string) (any, error) {
		if value == nil || strings.TrimSpace(*value) == "" {
			return nil, nil
		}
		return legacycrypto.Encrypt(encryptionKey, strings.TrimSpace(*value))
	}
	clientSecret, err := encryptValue(input.ClientSecret)
	if err != nil {
		return err
	}
	refreshToken, err := encryptValue(input.RefreshToken)
	if err != nil {
		return err
	}
	password, err := encryptValue(input.Password)
	if err != nil {
		return err
	}
	loginPassword, err := encryptValue(input.AccountLoginPassword)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO email_accounts (
			email, provider, auth_type, client_id, client_secret, refresh_token, password,
			account_login_password, provider_config, capabilities, status, group_id,
			mailbox_status, error_message, created_at, updated_at
		)
		VALUES ($1, $2::"MailProvider", $3::"MailAuthType", $4, $5, $6, $7, $8,
		        $9::jsonb, '{}'::jsonb, 'ACTIVE', $10, '{}'::jsonb, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT (email) DO UPDATE
		SET provider = EXCLUDED.provider,
		    auth_type = EXCLUDED.auth_type,
		    client_id = EXCLUDED.client_id,
		    client_secret = EXCLUDED.client_secret,
		    refresh_token = EXCLUDED.refresh_token,
		    password = EXCLUDED.password,
		    account_login_password = EXCLUDED.account_login_password,
		    provider_config = EXCLUDED.provider_config,
		    status = 'ACTIVE',
		    group_id = CASE WHEN $11 THEN EXCLUDED.group_id ELSE email_accounts.group_id END,
		    error_message = NULL,
		    updated_at = CURRENT_TIMESTAMP
	`, strings.ToLower(strings.TrimSpace(input.Email)), input.Provider, input.AuthType, nullablePointerValue(input.ClientID),
		clientSecret, refreshToken, password, loginPassword, string(config), groupID, groupID != nil)
	if err != nil {
		return fmt.Errorf("upsert imported mail account: %w", err)
	}
	return nil
}

func (s *PostgresStore) exportMailAccounts(ctx context.Context, ids []int64, groupID *int64, separator string, rawSecrets bool, encryptionKey string) (string, error) {
	var groupFilter any
	if groupID != nil {
		groupFilter = *groupID
	}
	rows, err := s.pool.Query(ctx, `
		SELECT email, provider::text, auth_type::text, client_id, client_secret, refresh_token,
		       password, account_login_password, COALESCE(provider_config, '{}'::jsonb)
		FROM email_accounts
		WHERE (COALESCE(cardinality($1::int[]), 0) = 0 OR id = ANY($1::int[]))
		  AND ($2::bigint IS NULL OR group_id = $2)
		ORDER BY id ASC
	`, ids, groupFilter)
	if err != nil {
		return "", fmt.Errorf("query mail accounts for export: %w", err)
	}
	defer rows.Close()
	lines := make([]string, 0)
	for rows.Next() {
		var row exportMailAccountRow
		if err := rows.Scan(&row.Email, &row.Provider, &row.AuthType, &row.ClientID, &row.ClientSecret, &row.RefreshToken, &row.Password, &row.AccountLoginPassword, &row.ProviderConfig); err != nil {
			return "", err
		}
		line, err := formatExportMailAccount(row, separator, rawSecrets, encryptionKey)
		if err != nil {
			return "", err
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return strings.Join(lines, "\n"), nil
}

func formatExportMailAccount(row exportMailAccountRow, separator string, rawSecrets bool, encryptionKey string) (string, error) {
	decrypt := func(value sql.NullString) (string, error) {
		if !value.Valid || strings.TrimSpace(value.String) == "" {
			return "", nil
		}
		return legacycrypto.Decrypt(encryptionKey, value.String)
	}
	clientSecret, err := decrypt(row.ClientSecret)
	if err != nil {
		return "", err
	}
	refreshToken, err := decrypt(row.RefreshToken)
	if err != nil {
		return "", err
	}
	password, err := decrypt(row.Password)
	if err != nil {
		return "", err
	}
	loginPassword, err := decrypt(row.AccountLoginPassword)
	if err != nil {
		return "", err
	}
	head := mailImportToken(row.Provider, row.AuthType)
	if row.AuthType != "APP_PASSWORD" {
		config, err := mergeProviderConfig(row.Provider, row.ProviderConfig)
		if err != nil {
			return "", err
		}
		encodedConfig, err := json.Marshal(config)
		if err != nil {
			return "", fmt.Errorf("encode OAuth provider config: %w", err)
		}
		parts := []string{head, row.Email, row.ClientID.String, clientSecret, refreshToken, ""}
		if rawSecrets {
			parts[5] = loginPassword
		}
		parts = append(parts, "config:"+base64.RawURLEncoding.EncodeToString(encodedConfig))
		return strings.Join(parts, separator), nil
	}
	config, err := mergeProviderConfig(row.Provider, row.ProviderConfig)
	if err != nil {
		return "", err
	}
	if providerConfigDiffersFromDefault(row.Provider, config) {
		parts := []string{
			head, row.Email, password, config.IMAPHost, strconv.Itoa(config.IMAPPort), strconv.FormatBool(config.IMAPTLS == nil || *config.IMAPTLS),
			config.SMTPHost, strconv.Itoa(config.SMTPPort), strconv.FormatBool(config.SMTPSecure == nil || *config.SMTPSecure),
			mailboxFolder(config, "INBOX"), mailboxFolder(config, "Junk"), mailboxFolder(config, "SENT"),
		}
		if rawSecrets {
			parts = append(parts, loginPassword)
		}
		return strings.Join(parts, separator), nil
	}
	parts := []string{head, row.Email, password}
	if rawSecrets {
		parts = append(parts, loginPassword)
	}
	return strings.Join(parts, separator), nil
}

func decodeImportedOAuthProviderConfig(provider, encoded string) (mailProviderConfig, error) {
	encoded = strings.TrimSpace(encoded)
	if !strings.HasPrefix(encoded, "config:") {
		return mailProviderConfig{}, fmt.Errorf("OAuth provider config is invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(encoded, "config:"))
	if err != nil {
		return mailProviderConfig{}, fmt.Errorf("decode OAuth provider config: %w", err)
	}
	config, err := mergeProviderConfig(provider, json.RawMessage(raw))
	if err != nil {
		return mailProviderConfig{}, err
	}
	return config, nil
}

func mailImportToken(provider, authType string) string {
	if provider == "OUTLOOK" && authType == "MICROSOFT_OAUTH" {
		return "OUTLOOK_OAUTH"
	}
	if provider == "GMAIL" && authType == "GOOGLE_OAUTH" {
		return "GMAIL_OAUTH"
	}
	if provider == "GMAIL" {
		return "GMAIL_APP_PASSWORD"
	}
	if provider == "CUSTOM_IMAP_SMTP" {
		return "CUSTOM_IMAP_SMTP"
	}
	return provider + "_IMAP_SMTP"
}

func providerConfigDiffersFromDefault(provider string, config mailProviderConfig) bool {
	defaults := defaultProviderConfig(provider)
	boolValue := func(value *bool, fallback bool) bool {
		if value == nil {
			return fallback
		}
		return *value
	}
	return config.IMAPHost != defaults.IMAPHost || config.IMAPPort != defaults.IMAPPort ||
		boolValue(config.IMAPTLS, true) != boolValue(defaults.IMAPTLS, true) ||
		config.SMTPHost != defaults.SMTPHost || config.SMTPPort != defaults.SMTPPort ||
		boolValue(config.SMTPSecure, true) != boolValue(defaults.SMTPSecure, true) ||
		mailboxFolder(config, "INBOX") != mailboxFolder(defaults, "INBOX") ||
		mailboxFolder(config, "Junk") != mailboxFolder(defaults, "Junk") ||
		mailboxFolder(config, "SENT") != mailboxFolder(defaults, "SENT")
}

func nullablePointerValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	return &value
}

func optionalStringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func parsePortOrDefault(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 || parsed > 65535 {
		return fallback
	}
	return parsed
}

func parseBoolOrDefault(value string, fallback bool) bool {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
