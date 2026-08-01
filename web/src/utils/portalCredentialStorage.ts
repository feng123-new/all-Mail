const LEGACY_PORTAL_LOGIN_PREFILL_PREFIX = 'all-mail:portal-login:';

/**
 * Older releases persisted freshly issued portal passwords in localStorage.
 * Current code never stores portal credentials in browser storage; this cleanup
 * removes any values left behind when an existing browser loads the fixed UI.
 */
export function clearLegacyPortalCredentialPrefills(): void {
    try {
        const storage = globalThis.localStorage;
        if (!storage) {
            return;
        }

        const legacyKeys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(LEGACY_PORTAL_LOGIN_PREFILL_PREFIX)) {
                legacyKeys.push(key);
            }
        }
        for (const key of legacyKeys) {
            storage.removeItem(key);
        }
    } catch {
        // Browser policy may disable storage access. The current UI never writes
        // portal credentials, so cleanup failure must not block authentication.
    }
}
