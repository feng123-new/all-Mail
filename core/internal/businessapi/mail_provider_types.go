package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type mailProviderConfig struct {
	ReadMode    string            `json:"readMode,omitempty"`
	IMAPHost    string            `json:"imapHost,omitempty"`
	IMAPPort    int               `json:"imapPort,omitempty"`
	IMAPTLS     *bool             `json:"imapTls,omitempty"`
	SMTPHost    string            `json:"smtpHost,omitempty"`
	SMTPPort    int               `json:"smtpPort,omitempty"`
	SMTPSecure  *bool             `json:"smtpSecure,omitempty"`
	Folders     map[string]string `json:"folders,omitempty"`
	OAuthTenant string            `json:"oauthTenant,omitempty"`
	OAuthScopes string            `json:"oauthScopes,omitempty"`
}

type mailAccountCredentials struct {
	ID                   int64
	Email                string
	Provider             string
	AuthType             string
	ClientID             string
	ClientSecret         string
	RefreshToken         string
	Password             string
	AccountLoginPassword string
	FetchStrategy        string
	ProviderConfig       mailProviderConfig
	Capabilities         map[string]any
	Status               string
	GroupID              *int64
	MailboxStatus        map[string]any
	Proxy                providerProxyConfig
}

type providerMessage struct {
	ID      string `json:"id"`
	From    string `json:"from"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
	HTML    string `json:"html"`
	Date    string `json:"date"`
}

type providerFetchResult struct {
	Email             string            `json:"email"`
	Mailbox           string            `json:"mailbox"`
	ResolvedMailbox   string            `json:"resolvedMailbox,omitempty"`
	Count             int               `json:"count"`
	Messages          []providerMessage `json:"messages"`
	MailboxCheckpoint map[string]any    `json:"mailboxCheckpoint,omitempty"`
	Method            string            `json:"method"`
	Provider          string            `json:"provider"`
}

type providerDeleteResult struct {
	Email             string         `json:"email"`
	Mailbox           string         `json:"mailbox"`
	ResolvedMailbox   string         `json:"resolvedMailbox,omitempty"`
	DeletedCount      int            `json:"deletedCount"`
	Message           string         `json:"message,omitempty"`
	MailboxCheckpoint map[string]any `json:"mailboxCheckpoint,omitempty"`
	Method            string         `json:"method"`
	Provider          string         `json:"provider"`
}

type providerSendInput struct {
	FromEmail string
	FromName  string
	To        []string
	Subject   string
	Text      string
	HTML      string
}

type providerSendResult struct {
	Provider          string   `json:"provider"`
	Method            string   `json:"method"`
	ProviderMessageID *string  `json:"providerMessageId,omitempty"`
	Accepted          []string `json:"accepted"`
}

type mailProvider interface {
	Fetch(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error)
	Delete(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error)
	Clear(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error)
	Send(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error)
}

var supportedEmailProviders = map[string]struct{}{
	"OUTLOOK": {}, "GMAIL": {}, "QQ": {}, "NETEASE_163": {}, "NETEASE_126": {},
	"ICLOUD": {}, "YAHOO": {}, "ZOHO": {}, "ALIYUN": {}, "AMAZON_WORKMAIL": {},
	"FASTMAIL": {}, "AOL": {}, "GMX": {}, "MAILCOM": {}, "YANDEX": {}, "CUSTOM_IMAP_SMTP": {},
}

var supportedEmailAuthTypes = map[string]struct{}{
	"MICROSOFT_OAUTH": {}, "GOOGLE_OAUTH": {}, "APP_PASSWORD": {},
}

func validateMailProvider(provider string) error {
	if _, ok := supportedEmailProviders[provider]; !ok {
		return validationError("provider contains an unsupported value")
	}
	return nil
}

func validateMailAuthType(authType string) error {
	if _, ok := supportedEmailAuthTypes[authType]; !ok {
		return validationError("authType contains an unsupported value")
	}
	return nil
}

func defaultMailAuthType(provider string) string {
	switch provider {
	case "OUTLOOK":
		return "MICROSOFT_OAUTH"
	case "GMAIL":
		return "GOOGLE_OAUTH"
	default:
		return "APP_PASSWORD"
	}
}

func providerProfile(provider, authType string) string {
	if provider == "OUTLOOK" && authType == "MICROSOFT_OAUTH" {
		return "outlook-oauth"
	}
	if provider == "GMAIL" && authType == "GOOGLE_OAUTH" {
		return "gmail-oauth"
	}
	if provider == "GMAIL" {
		return "gmail-app-password"
	}
	return strings.ToLower(strings.ReplaceAll(provider, "_", "-")) + "-imap-smtp"
}

func representativeProtocol(provider, authType string) string {
	if authType == "MICROSOFT_OAUTH" || authType == "GOOGLE_OAUTH" {
		return "oauth_api"
	}
	return "imap_smtp"
}

func providerProfileSummary(provider, authType string, config mailProviderConfig, fetchStrategy string) map[string]any {
	oauth := authType == "MICROSOFT_OAUTH" || authType == "GOOGLE_OAUTH"
	clearMailbox := mailAccountSupportsClear(mailAccountCredentials{
		Provider: provider, AuthType: authType, ProviderConfig: config, FetchStrategy: fetchStrategy,
	})
	sendMail := mailAccountSupportsSend(mailAccountCredentials{
		Provider: provider, AuthType: authType, ProviderConfig: config, FetchStrategy: fetchStrategy,
	})
	modes := []string{"IMAP", "SMTP"}
	secondary := []string{"smtp"}
	if provider == "OUTLOOK" && oauth {
		switch strings.ToUpper(strings.TrimSpace(config.ReadMode)) {
		case "GRAPH_API", "GRAPH_ONLY":
			modes, secondary = []string{"GRAPH_API"}, []string{}
		case "IMAP", "IMAP_ONLY":
			modes, secondary = []string{"IMAP"}, []string{}
		default:
			modes, secondary = []string{"GRAPH_API", "IMAP"}, []string{"imap"}
		}
	}
	if provider == "GMAIL" && oauth {
		modes = []string{"GMAIL_API", "IMAP"}
		secondary = []string{"imap"}
	}
	return map[string]any{
		"providerProfile":        providerProfile(provider, authType),
		"representativeProtocol": representativeProtocol(provider, authType),
		"secondaryProtocols":     secondary,
		"profileSummaryHint":     providerProfile(provider, authType),
		"capabilitySummary": map[string]any{
			"readInbox":    true,
			"readJunk":     true,
			"readSent":     true,
			"clearMailbox": clearMailbox,
			"sendMail":     sendMail,
			"usesOAuth":    oauth,
			"receiveMail":  true,
			"apiAccess":    oauth,
			"forwarding":   false,
			"search":       false,
			"refreshToken": oauth,
			"webhook":      false,
			"aliasSupport": false,
			"modes":        modes,
		},
	}
}

func defaultProviderConfig(provider string) mailProviderConfig {
	secure := true
	config := mailProviderConfig{ReadMode: "IMAP", IMAPPort: 993, IMAPTLS: &secure, SMTPPort: 465, SMTPSecure: &secure, Folders: map[string]string{"inbox": "INBOX", "junk": "Junk", "sent": "Sent"}}
	switch provider {
	case "GMAIL":
		config.ReadMode = "GMAIL_API"
		config.IMAPHost, config.SMTPHost = "imap.gmail.com", "smtp.gmail.com"
		config.Folders["junk"], config.Folders["sent"] = "[Gmail]/Spam", "[Gmail]/Sent Mail"
	case "QQ":
		config.IMAPHost, config.SMTPHost = "imap.qq.com", "smtp.qq.com"
		config.Folders["sent"] = "Sent Messages"
	case "NETEASE_163":
		config.IMAPHost, config.SMTPHost = "imap.163.com", "smtp.163.com"
	case "NETEASE_126":
		config.IMAPHost, config.SMTPHost = "imap.126.com", "smtp.126.com"
	case "ICLOUD":
		config.IMAPHost, config.SMTPHost = "imap.mail.me.com", "smtp.mail.me.com"
		config.SMTPPort = 587
		config.SMTPSecure = boolPointer(false)
	case "YAHOO":
		config.IMAPHost, config.SMTPHost = "imap.mail.yahoo.com", "smtp.mail.yahoo.com"
	case "ZOHO":
		config.IMAPHost, config.SMTPHost = "imap.zoho.com", "smtp.zoho.com"
	case "ALIYUN":
		config.IMAPHost, config.SMTPHost = "imap.mxhichina.com", "smtp.mxhichina.com"
	case "AMAZON_WORKMAIL":
		config.IMAPHost, config.SMTPHost = "imap.mail.us-east-1.awsapps.com", "smtp.mail.us-east-1.awsapps.com"
		config.SMTPPort = 465
	case "FASTMAIL":
		config.IMAPHost, config.SMTPHost = "imap.fastmail.com", "smtp.fastmail.com"
	case "AOL":
		config.IMAPHost, config.SMTPHost = "imap.aol.com", "smtp.aol.com"
	case "GMX":
		config.IMAPHost, config.SMTPHost = "imap.gmx.com", "mail.gmx.com"
	case "MAILCOM":
		config.IMAPHost, config.SMTPHost = "imap.mail.com", "smtp.mail.com"
	case "YANDEX":
		config.IMAPHost, config.SMTPHost = "imap.yandex.com", "smtp.yandex.com"
	case "OUTLOOK":
		config.ReadMode = "GRAPH_ONLY"
		config.IMAPHost, config.SMTPHost = "outlook.office365.com", "smtp.office365.com"
		config.SMTPPort = 587
		config.SMTPSecure = boolPointer(false)
	}
	return config
}

func mergeProviderConfig(provider string, raw json.RawMessage) (mailProviderConfig, error) {
	return mergeProviderConfigInto(defaultProviderConfig(provider), raw)
}

func mergeProviderConfigInto(config mailProviderConfig, raw json.RawMessage) (mailProviderConfig, error) {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		return config, nil
	}
	var override mailProviderConfig
	if err := json.Unmarshal(raw, &override); err != nil {
		return mailProviderConfig{}, validationError("providerConfig must be a JSON object")
	}
	if override.ReadMode != "" {
		config.ReadMode = override.ReadMode
	}
	if override.IMAPHost != "" {
		config.IMAPHost = override.IMAPHost
	}
	if override.IMAPPort > 0 {
		config.IMAPPort = override.IMAPPort
	}
	if override.IMAPTLS != nil {
		config.IMAPTLS = override.IMAPTLS
	}
	if override.SMTPHost != "" {
		config.SMTPHost = override.SMTPHost
	}
	if override.SMTPPort > 0 {
		config.SMTPPort = override.SMTPPort
	}
	if override.SMTPSecure != nil {
		config.SMTPSecure = override.SMTPSecure
	}
	if override.Folders != nil {
		if config.Folders == nil {
			config.Folders = make(map[string]string)
		}
		for key, value := range override.Folders {
			config.Folders[strings.ToLower(key)] = strings.TrimSpace(value)
		}
	}
	if override.OAuthTenant != "" {
		config.OAuthTenant = strings.TrimSpace(override.OAuthTenant)
	}
	if override.OAuthScopes != "" {
		config.OAuthScopes = strings.TrimSpace(override.OAuthScopes)
	}
	if config.IMAPPort < 1 || config.IMAPPort > 65535 || config.SMTPPort < 1 || config.SMTPPort > 65535 {
		return mailProviderConfig{}, validationError("providerConfig contains an invalid port")
	}
	return config, nil
}

func mailboxFolder(config mailProviderConfig, mailbox string) string {
	key := strings.ToLower(strings.TrimSpace(mailbox))
	if key == "spam" {
		key = "junk"
	}
	if config.Folders != nil && strings.TrimSpace(config.Folders[key]) != "" {
		return config.Folders[key]
	}
	switch key {
	case "junk":
		return "Junk"
	case "sent":
		return "Sent"
	default:
		return "INBOX"
	}
}

func boolPointer(value bool) *bool { return &value }

func marshalProviderConfig(config mailProviderConfig) ([]byte, error) {
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("encode provider config: %w", err)
	}
	return encoded, nil
}
