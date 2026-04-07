export interface ImapClientIdentificationConnection {
    serverSupports(capability: string): boolean;
    id?: (identification: Record<string, string> | null, callback: (error: Error | null) => void) => void;
}

export interface ImapPreReadyIdentificationConnection extends ImapClientIdentificationConnection {
    _enqueue?: (fullcmd: string, promote?: boolean | ((error: Error | null) => void), cb?: (error: Error | null) => void) => void;
}

export interface IdentifyImapClientOptions {
    identification?: Record<string, string>;
    onWarning?: (error: unknown, message: string) => void;
}

export const DEFAULT_IMAP_CLIENT_IDENTIFICATION: Record<string, string> = {
    name: 'all-Mail',
    version: '2.0.0',
    vendor: 'all-Mail',
};

function escapeImapIdComponent(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function formatImapIdentificationCommand(identification: Record<string, string>): string {
    const pairs: string[] = [];

    for (const [key, value] of Object.entries(identification)) {
        pairs.push(`"${escapeImapIdComponent(key)}"`);
        pairs.push(`"${escapeImapIdComponent(value)}"`);
    }

    return `ID (${pairs.join(' ')})`;
}

export function shouldForcePreReadyImapId(host: string): boolean {
    const normalized = host.trim().toLowerCase();
    return normalized.endsWith('.163.com')
        || normalized.endsWith('.126.com')
        || normalized.endsWith('.188.com')
        || normalized === 'imap.163.com'
        || normalized === 'imap.126.com'
        || normalized === 'imap.188.com';
}

export function installPreReadyImapIdHook(
    imap: ImapPreReadyIdentificationConnection,
    host: string,
    options: IdentifyImapClientOptions = {},
) : boolean {
    if (!shouldForcePreReadyImapId(host) || typeof imap._enqueue !== 'function') {
        return false;
    }

    const originalEnqueue = imap._enqueue.bind(imap);
    const identification = options.identification || DEFAULT_IMAP_CLIENT_IDENTIFICATION;
    const onWarning = options.onWarning;
    const idCommand = formatImapIdentificationCommand(identification);
    let injected = false;

    imap._enqueue = (fullcmd, promote, cb) => {
        if (!injected && fullcmd === 'LIST "" ""') {
            injected = true;
            originalEnqueue(idCommand, (error) => {
                if (error) {
                    onWarning?.(error, 'Pre-ready IMAP ID command failed; continuing with default node-imap startup flow');
                }
            });
        }

        if (typeof promote === 'function') {
            return originalEnqueue(fullcmd, promote);
        }

        if (typeof cb === 'function') {
            return originalEnqueue(fullcmd, promote, cb);
        }

        return originalEnqueue(fullcmd, promote);
    };

    return true;
}

export async function identifyImapClient(
    imap: ImapClientIdentificationConnection,
    options: IdentifyImapClientOptions = {},
): Promise<void> {
    if (typeof imap.id !== 'function') {
        return;
    }

    const sendId = imap.id;
    const identification = options.identification || DEFAULT_IMAP_CLIENT_IDENTIFICATION;
    const onWarning = options.onWarning;

    await new Promise<void>((resolve) => {
        try {
            sendId(identification, (error) => {
                if (error) {
                    onWarning?.(error, 'Failed to send IMAP ID command; continuing without client identification');
                }
                resolve();
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== 'Server does not support ID') {
                onWarning?.(error, 'IMAP client identification could not be sent');
            }
            resolve();
        }
    });
}
