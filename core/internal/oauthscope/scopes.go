package oauthscope

import (
	"fmt"
	"strings"
)

type Profile string

const (
	Minimal Profile = "minimal"
	Send    Profile = "send"
	Manage  Profile = "manage"
	Full    Profile = "full"
)

var profiles = []Profile{Minimal, Send, Manage, Full}

var googleIdentity = []string{
	"openid",
	"email",
	"profile",
}

var microsoftIdentity = []string{
	"offline_access",
	"openid",
	"profile",
	"email",
	"https://graph.microsoft.com/User.Read",
}

var googleScopes = map[Profile][]string{
	Minimal: appendCopy(googleIdentity, "https://www.googleapis.com/auth/gmail.readonly"),
	Send: appendCopy(googleIdentity,
		"https://www.googleapis.com/auth/gmail.readonly",
		"https://www.googleapis.com/auth/gmail.send",
	),
	Manage: appendCopy(googleIdentity,
		"https://www.googleapis.com/auth/gmail.modify",
		"https://www.googleapis.com/auth/gmail.send",
	),
	Full: appendCopy(googleIdentity, "https://mail.google.com/"),
}

var microsoftScopes = map[Profile][]string{
	Minimal: appendCopy(microsoftIdentity, "https://graph.microsoft.com/Mail.Read"),
	Send: appendCopy(microsoftIdentity,
		"https://graph.microsoft.com/Mail.Read",
		"https://graph.microsoft.com/Mail.Send",
	),
	Manage: appendCopy(microsoftIdentity,
		"https://graph.microsoft.com/Mail.ReadWrite",
		"https://graph.microsoft.com/Mail.Send",
	),
	Full: appendCopy(microsoftIdentity,
		"https://graph.microsoft.com/Mail.ReadWrite",
		"https://graph.microsoft.com/Mail.Send",
		"https://graph.microsoft.com/Contacts.ReadWrite",
		"https://graph.microsoft.com/Calendars.ReadWrite",
		"https://graph.microsoft.com/MailboxSettings.ReadWrite",
	),
}

func Profiles() []Profile {
	return append([]Profile(nil), profiles...)
}

func Canonical(provider string, profile Profile) (string, error) {
	provider = normalizeProvider(provider)
	var values []string
	switch provider {
	case "GMAIL":
		values = googleScopes[profile]
	case "OUTLOOK":
		values = microsoftScopes[profile]
	default:
		return "", fmt.Errorf("unsupported OAuth provider %q", provider)
	}
	if len(values) == 0 {
		return "", fmt.Errorf("unsupported OAuth scope profile %q", profile)
	}
	return strings.Join(values, " "), nil
}

// Normalize accepts only scopes that belong to a supported profile and returns
// the canonical cumulative profile string. Legacy broad defaults are reduced to
// their explicit profile instead of being preserved as an arbitrary scope bag.
func Normalize(provider, raw string) (string, Profile, error) {
	provider = normalizeProvider(provider)
	fields := unique(strings.Fields(strings.TrimSpace(raw)))
	if len(fields) == 0 {
		value, err := Canonical(provider, Minimal)
		return value, Minimal, err
	}

	allowed := make(map[string]struct{})
	var candidates map[Profile][]string
	switch provider {
	case "GMAIL":
		candidates = googleScopes
	case "OUTLOOK":
		candidates = microsoftScopes
	default:
		return "", "", fmt.Errorf("unsupported OAuth provider %q", provider)
	}
	for _, values := range candidates {
		for _, value := range values {
			allowed[value] = struct{}{}
		}
	}
	for _, value := range fields {
		if _, ok := allowed[value]; !ok {
			return "", "", fmt.Errorf("OAuth scope %q is not allowed for %s", value, provider)
		}
	}

	fieldSet := set(fields)
	profile := classify(provider, fieldSet)
	canonical, err := Canonical(provider, profile)
	if err != nil {
		return "", "", err
	}
	canonicalSet := set(strings.Fields(canonical))
	for required := range canonicalSet {
		if _, ok := fieldSet[required]; !ok {
			return "", "", fmt.Errorf("OAuth scopes for %s do not form a complete %s profile", provider, profile)
		}
	}
	return canonical, profile, nil
}

func ParseProfile(raw string) (Profile, error) {
	profile := Profile(strings.ToLower(strings.TrimSpace(raw)))
	for _, candidate := range profiles {
		if profile == candidate {
			return profile, nil
		}
	}
	return "", fmt.Errorf("scopeProfile must be one of minimal, send, manage, or full")
}

func ProfileFor(provider, raw string) (Profile, error) {
	_, profile, err := Normalize(provider, raw)
	return profile, err
}

func classify(provider string, values map[string]struct{}) Profile {
	if provider == "GMAIL" {
		if has(values, "https://mail.google.com/") {
			return Full
		}
		if has(values, "https://www.googleapis.com/auth/gmail.modify") {
			return Manage
		}
		if has(values, "https://www.googleapis.com/auth/gmail.send") {
			return Send
		}
		return Minimal
	}
	if has(values,
		"https://graph.microsoft.com/Contacts.ReadWrite",
		"https://graph.microsoft.com/Calendars.ReadWrite",
		"https://graph.microsoft.com/MailboxSettings.ReadWrite",
	) {
		return Full
	}
	if has(values, "https://graph.microsoft.com/Mail.ReadWrite") {
		return Manage
	}
	if has(values, "https://graph.microsoft.com/Mail.Send") {
		return Send
	}
	return Minimal
}

func normalizeProvider(provider string) string {
	switch strings.ToUpper(strings.TrimSpace(provider)) {
	case "GOOGLE", "GMAIL":
		return "GMAIL"
	case "MICROSOFT", "OUTLOOK":
		return "OUTLOOK"
	default:
		return strings.ToUpper(strings.TrimSpace(provider))
	}
}

func appendCopy(base []string, values ...string) []string {
	result := append([]string(nil), base...)
	return append(result, values...)
}

func unique(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func set(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func has(values map[string]struct{}, candidates ...string) bool {
	for _, candidate := range candidates {
		if _, ok := values[candidate]; ok {
			return true
		}
	}
	return false
}
