import { MAIL_LOG_ACTIONS } from '../modules/mail/mail.actions.js';

export type ApiPermissions = Record<string, boolean>;

const LEGACY_PERMISSION_ALIASES: Record<string, string> = {
    get_email: MAIL_LOG_ACTIONS.GET_EMAIL,
    mail_new: MAIL_LOG_ACTIONS.MAIL_NEW,
    mail_text: MAIL_LOG_ACTIONS.MAIL_TEXT,
    mail_all: MAIL_LOG_ACTIONS.MAIL_ALL,
    process_mailbox: MAIL_LOG_ACTIONS.PROCESS_MAILBOX,
    list_emails: MAIL_LOG_ACTIONS.LIST_EMAILS,
    pool_stats: MAIL_LOG_ACTIONS.POOL_STATS,
    pool_reset: MAIL_LOG_ACTIONS.POOL_RESET,
    domain_get_mailbox: MAIL_LOG_ACTIONS.DOMAIN_GET_MAILBOX,
    domain_mail_new: MAIL_LOG_ACTIONS.DOMAIN_MAIL_NEW,
    domain_mail_text: MAIL_LOG_ACTIONS.DOMAIN_MAIL_TEXT,
    domain_mail_all: MAIL_LOG_ACTIONS.DOMAIN_MAIL_ALL,
    domain_list_mailboxes: MAIL_LOG_ACTIONS.DOMAIN_LIST_MAILBOXES,
    domain_pool_stats: MAIL_LOG_ACTIONS.DOMAIN_POOL_STATS,
    domain_pool_reset: MAIL_LOG_ACTIONS.DOMAIN_POOL_RESET,
};

function resolvePermissionAlias(key: string): string {
    const normalizedKey = key.trim().toLowerCase().replace(/-/g, '_');
    return LEGACY_PERMISSION_ALIASES[normalizedKey] ?? normalizedKey;
}

export function normalizeApiPermissionKey(key: string): string {
    return resolvePermissionAlias(key);
}

const ALLOWED_ACTION_KEYS = new Set(
    Object.values(MAIL_LOG_ACTIONS).map((action) => normalizeApiPermissionKey(action))
);
const WILDCARD_KEYS = new Set(['*', 'all', '__all__']);

export function isKnownApiPermissionKey(key: string): boolean {
    const normalizedKey = normalizeApiPermissionKey(key);
    return WILDCARD_KEYS.has(normalizedKey) || ALLOWED_ACTION_KEYS.has(normalizedKey);
}

export function parseApiPermissions(value: unknown): ApiPermissions | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const entries: Array<[string, boolean]> = Object.entries(value as Record<string, unknown>)
        .filter(([, permissionValue]) => typeof permissionValue === 'boolean')
        .map(([permissionKey, permissionValue]) => [normalizeApiPermissionKey(permissionKey), permissionValue as boolean] as [string, boolean])
        .filter(([permissionKey]) => isKnownApiPermissionKey(permissionKey));

    if (entries.length === 0) {
        return undefined;
    }

    return Object.fromEntries(entries);
}

export function isApiPermissionAllowed(permissions: ApiPermissions | undefined, action: string): boolean {
    if (!permissions || Object.keys(permissions).length === 0) {
        return true;
    }

    const actionKey = normalizeApiPermissionKey(action);
    for (const wildcardKey of WILDCARD_KEYS) {
        if (permissions[wildcardKey] === true) {
            return true;
        }
    }

    if (permissions[actionKey] === true) {
        return true;
    }
    if (permissions[actionKey] === false) {
        return false;
    }

    const legacyKey = actionKey.replace(/_/g, '-');
    if (permissions[legacyKey] === true) {
        return true;
    }
    if (permissions[legacyKey] === false) {
        return false;
    }

    return false;
}
