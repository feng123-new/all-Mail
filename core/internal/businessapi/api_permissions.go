package businessapi

import (
	"fmt"
	"sort"
	"strings"
)

var permissionAliases = map[string]string{
	"get_email":             actionExternalAllocateMailbox,
	"mail_new":              actionExternalReadLatestMessage,
	"mail_text":             actionExternalReadMessageText,
	"mail_all":              actionExternalListMessages,
	"process_mailbox":       actionExternalClearMailbox,
	"list_emails":           actionExternalListMailboxes,
	"pool_stats":            actionExternalMailboxAllocationStats,
	"pool_reset":            actionExternalMailboxAllocationReset,
	"domain_get_mailbox":    actionDomainAllocateMailbox,
	"domain_mail_new":       actionDomainReadLatestMessage,
	"domain_mail_text":      actionDomainReadMessageText,
	"domain_mail_all":       actionDomainListMessages,
	"domain_list_mailboxes": actionDomainListMailboxes,
	"domain_pool_stats":     actionDomainMailboxAllocationStats,
	"domain_pool_reset":     actionDomainMailboxAllocationReset,
}

var knownPermissionActions = map[string]struct{}{
	actionExternalAllocateMailbox:        {},
	actionExternalReadLatestMessage:      {},
	actionExternalReadMessageText:        {},
	actionExternalListMessages:           {},
	actionExternalClearMailbox:           {},
	actionExternalListMailboxes:          {},
	actionExternalMailboxAllocationStats: {},
	actionExternalMailboxAllocationReset: {},
	actionDomainAllocateMailbox:          {},
	actionDomainReadLatestMessage:        {},
	actionDomainReadMessageText:          {},
	actionDomainListMessages:             {},
	actionDomainListMailboxes:            {},
	actionDomainMailboxAllocationStats:   {},
	actionDomainMailboxAllocationReset:   {},
}

var wildcardPermissions = map[string]struct{}{
	"*":       {},
	"all":     {},
	"__all__": {},
}

func normalizePermissionKey(value string) string {
	normalized := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(value)), "-", "_")
	if alias, ok := permissionAliases[normalized]; ok {
		return alias
	}
	return normalized
}

func normalizePermissions(input map[string]bool) (map[string]bool, error) {
	if len(input) == 0 {
		return nil, nil
	}
	result := make(map[string]bool, len(input))
	unknown := make([]string, 0)
	for key, enabled := range input {
		normalized := normalizePermissionKey(key)
		if !isKnownPermission(normalized) {
			unknown = append(unknown, key)
			continue
		}
		if existing, ok := result[normalized]; ok && existing != enabled {
			return nil, fmt.Errorf("conflicting permission aliases for %s", normalized)
		}
		result[normalized] = enabled
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, fmt.Errorf("unknown permission keys: %s", strings.Join(unknown, ", "))
	}
	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}

func isKnownPermission(normalized string) bool {
	if _, ok := wildcardPermissions[normalized]; ok {
		return true
	}
	_, ok := knownPermissionActions[normalized]
	return ok
}

func permissionAllowed(permissions map[string]bool, action string) bool {
	if len(permissions) == 0 {
		return true
	}
	for wildcard := range wildcardPermissions {
		if permissions[wildcard] {
			return true
		}
	}
	normalized := normalizePermissionKey(action)
	allowed, exists := permissions[normalized]
	return exists && allowed
}
