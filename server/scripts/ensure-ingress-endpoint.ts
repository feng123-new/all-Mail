import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient, Status } from '@prisma/client';

export interface Options {
    check: boolean;
    global: boolean;
    domainName?: string;
    keyId: string;
    name: string;
    provider: string;
}

export interface MinimalEnv {
    DATABASE_URL: string;
    INGRESS_SIGNING_SECRET?: string;
    ENCRYPTION_KEY?: string;
}

interface StoredIngressSecret {
    signing_secret_encrypted: string | null;
}

interface LockedIngressSecret extends StoredIngressSecret {
    id: number;
    key_id: string;
    signing_key_hash: string | null;
}

const scriptDir = import.meta.dirname;
const serverDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(serverDir, '..');
const candidateEnvFiles = [
    path.join(serverDir, '.env'),
    path.join(repoRoot, '.env'),
];

function parseArgs(argv: string[]): Options {
    const options: Options = {
        check: false,
        global: true,
        keyId: 'allmail-edge-main',
        name: 'allmail-edge global worker',
        provider: 'CLOUDFLARE_WORKER',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--check':
                options.check = true;
                break;
            case '--global':
                options.global = true;
                options.domainName = undefined;
                break;
            case '--domain':
                options.domainName = argv[index + 1]?.trim().toLowerCase();
                options.global = false;
                index += 1;
                break;
            case '--key-id':
                options.keyId = argv[index + 1]?.trim() || options.keyId;
                index += 1;
                break;
            case '--name':
                options.name = argv[index + 1]?.trim() || options.name;
                index += 1;
                break;
            case '--provider':
                options.provider = argv[index + 1]?.trim() || options.provider;
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.keyId) {
        throw new Error('Missing --key-id value');
    }
    if (!options.name) {
        throw new Error('Missing --name value');
    }
    if (!options.provider) {
        throw new Error('Missing --provider value');
    }
    if (!options.global && !options.domainName) {
        throw new Error('Use --domain <name> or --global');
    }

    return options;
}

function parseEnvValue(rawValue: string): string {
    const value = rawValue.trim();
    const first = value[0];
    const last = value[value.length - 1];
    return value.length >= 2
        && ((first === '"' && last === '"') || (first === "'" && last === "'"))
        ? value.slice(1, -1)
        : value;
}

function parseEnvFile(content: string): Map<string, string> {
    const entries = new Map<string, string>();
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }
        const key = line.slice(0, separatorIndex).trim();
        entries.set(key, parseEnvValue(line.slice(separatorIndex + 1)));
    }
    return entries;
}

function deriveDatabaseUrl(entries: Map<string, string>): string | undefined {
    const explicit = process.env.DATABASE_URL || entries.get('DATABASE_URL');
    if (explicit) {
        return explicit;
    }

    const postgresPassword = process.env.POSTGRES_PASSWORD || entries.get('POSTGRES_PASSWORD');
    if (!postgresPassword) {
        return undefined;
    }
    const postgresPort = process.env.DEV_POSTGRES_PORT || entries.get('DEV_POSTGRES_PORT') || '15433';
    const postgresUser = process.env.POSTGRES_USER || entries.get('POSTGRES_USER') || 'allmail';
    const postgresDb = process.env.POSTGRES_DB || entries.get('POSTGRES_DB') || 'allmail';
    const databaseUrl = new URL('postgresql://127.0.0.1');
    databaseUrl.username = postgresUser;
    databaseUrl.password = postgresPassword;
    databaseUrl.port = postgresPort;
    databaseUrl.pathname = `/${postgresDb}`;
    return databaseUrl.toString();
}

function loadMinimalEnv(): MinimalEnv {
    const merged = new Map<string, string>();

    for (const envFile of candidateEnvFiles) {
        if (!existsSync(envFile)) {
            continue;
        }
        const parsed = parseEnvFile(readFileSync(envFile, 'utf8'));
        for (const [key, value] of parsed.entries()) {
            if (!(key in process.env)) {
                process.env[key] = value;
            }
            merged.set(key, value);
        }
    }

    const databaseUrl = deriveDatabaseUrl(merged);
    if (!databaseUrl) {
        throw new Error(
            'DATABASE_URL is required, or define POSTGRES_PASSWORD with the documented POSTGRES_USER, POSTGRES_DB, and DEV_POSTGRES_PORT values.',
        );
    }

    return {
        DATABASE_URL: databaseUrl,
        INGRESS_SIGNING_SECRET: process.env.INGRESS_SIGNING_SECRET
            || merged.get('INGRESS_SIGNING_SECRET')
            || undefined,
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY
            || merged.get('ENCRYPTION_KEY')
            || undefined,
    };
}

function buildSigningKeyHash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

function validateIngressSecret(secret: string): void {
    if (secret.length < 16) {
        throw new Error('INGRESS_SIGNING_SECRET must contain at least 16 characters');
    }
    const lowered = secret.toLowerCase();
    if (['replace-with-', 'changeme-', 'example-'].some((prefix) => lowered.startsWith(prefix))) {
        throw new Error('INGRESS_SIGNING_SECRET must not be a placeholder value');
    }
}

function deriveEncryptionKey(encryptionKey: string): Buffer {
    if (encryptionKey.length !== 32) {
        throw new Error('ENCRYPTION_KEY must contain exactly 32 characters');
    }
    return createHash('sha256').update(encryptionKey).digest();
}

function encryptIngressSecret(secret: string, encryptionKey: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(encryptionKey), iv);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

function decryptIngressSecret(encryptedText: string, encryptionKey: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        throw new Error('Stored ingress signing secret has an invalid encrypted format');
    }
    const [ivHex, authTagHex, encrypted] = parts;
    const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveEncryptionKey(encryptionKey),
        Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function readStoredIngressSecret(
    prisma: PrismaClient,
    endpointId: number,
): Promise<string | null> {
    const rows = await prisma.$queryRaw<StoredIngressSecret[]>`
        SELECT signing_secret_encrypted
        FROM ingress_endpoints
        WHERE id = ${endpointId}
    `;
    return rows[0]?.signing_secret_encrypted || null;
}

async function resolveDomain(prisma: PrismaClient, domainName?: string) {
    if (!domainName) {
        return null;
    }

    const domain = await prisma.domain.findUnique({
        where: { name: domainName },
        select: {
            id: true,
            name: true,
            status: true,
            canReceive: true,
        },
    });

    if (!domain) {
        throw new Error(`Domain not found: ${domainName}`);
    }

    return domain;
}

export async function runCheck(
    prisma: PrismaClient,
    env: MinimalEnv,
    options: Options,
): Promise<number> {
    const endpoint = await prisma.ingressEndpoint.findUnique({
        where: { keyId: options.keyId },
        select: {
            id: true,
            domainId: true,
            keyId: true,
            name: true,
            provider: true,
            signingKeyHash: true,
            status: true,
            domain: {
                select: {
                    name: true,
                },
            },
        },
    });

    const expectedHash = env.INGRESS_SIGNING_SECRET
        ? buildSigningKeyHash(env.INGRESS_SIGNING_SECRET)
        : null;
    const encryptedSecret = endpoint
        ? await readStoredIngressSecret(prisma, endpoint.id)
        : null;
    let encryptedSecretValid: boolean | null = null;
    if (encryptedSecret && env.ENCRYPTION_KEY) {
        try {
            const decryptedSecret = decryptIngressSecret(encryptedSecret, env.ENCRYPTION_KEY);
            encryptedSecretValid = endpoint?.signingKeyHash === buildSigningKeyHash(decryptedSecret)
                && (!env.INGRESS_SIGNING_SECRET || decryptedSecret === env.INGRESS_SIGNING_SECRET);
        } catch {
            encryptedSecretValid = false;
        }
    }
    const report = {
        exists: Boolean(endpoint),
        encryptedSigningSecretConfigured: Boolean(encryptedSecret),
        encryptedSigningSecretValid: encryptedSecretValid,
        active: endpoint?.status === Status.ACTIVE,
        keyId: options.keyId,
        expectedDomain: options.domainName ?? null,
        actualDomain: endpoint?.domain?.name ?? null,
        envSigningSecretConfigured: Boolean(env.INGRESS_SIGNING_SECRET),
        signingKeyHashMatchesEnv: expectedHash ? endpoint?.signingKeyHash === expectedHash : null,
        endpoint,
    };

    console.log(JSON.stringify(report, null, 2));

    const domainMatches = options.domainName
        ? endpoint?.domain?.name === options.domainName
        : endpoint?.domain == null;
    const signingHashMatches = expectedHash
        ? endpoint?.signingKeyHash === expectedHash
        : true;
    if (
        !endpoint
        || endpoint.status !== Status.ACTIVE
        || !domainMatches
        || !signingHashMatches
        || !encryptedSecret
        || (env.ENCRYPTION_KEY !== undefined && encryptedSecretValid !== true)
    ) {
        return 1;
    }

    return 0;
}

export async function runEnsure(
    prisma: PrismaClient,
    env: MinimalEnv,
    options: Options,
): Promise<void> {
    if (!env.INGRESS_SIGNING_SECRET) {
        throw new Error('INGRESS_SIGNING_SECRET must be configured before ensuring ingress endpoint');
    }
    validateIngressSecret(env.INGRESS_SIGNING_SECRET);

    const domain = await resolveDomain(prisma, options.domainName);
    const signingKeyHash = buildSigningKeyHash(env.INGRESS_SIGNING_SECRET);
    const result = await prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<LockedIngressSecret[]>`
            SELECT id, key_id, signing_key_hash, signing_secret_encrypted
            FROM ingress_endpoints
            WHERE key_id = ${options.keyId}
            FOR UPDATE
        `;
        const existing = rows[0] || null;
        if (existing?.signing_secret_encrypted && env.ENCRYPTION_KEY) {
            let existingSecret: string;
            try {
                existingSecret = decryptIngressSecret(
                    existing.signing_secret_encrypted,
                    env.ENCRYPTION_KEY,
                );
            } catch {
                throw new Error('ENCRYPTION_KEY cannot decrypt the stored ingress signing secret');
            }
            if (existing.signing_key_hash !== buildSigningKeyHash(existingSecret)) {
                throw new Error('Stored ingress signing hash does not match its encrypted secret');
            }
        }

        const canReuseStoredSecret = Boolean(
            existing
            && existing.signing_key_hash === signingKeyHash
            && existing.signing_secret_encrypted,
        );
        if (!canReuseStoredSecret && !env.ENCRYPTION_KEY) {
            throw new Error(
                'ENCRYPTION_KEY is required when creating an ingress endpoint or rotating its signing secret',
            );
        }
        const encryptedSecret = canReuseStoredSecret
            ? null
            : encryptIngressSecret(env.INGRESS_SIGNING_SECRET as string, env.ENCRYPTION_KEY as string);

        const updated = await transaction.ingressEndpoint.upsert({
            where: { keyId: options.keyId },
            create: {
                domainId: domain?.id ?? null,
                keyId: options.keyId,
                name: options.name,
                provider: options.provider,
                signingKeyHash,
                status: Status.ACTIVE,
            },
            update: {
                domainId: domain?.id ?? null,
                name: options.name,
                provider: options.provider,
                signingKeyHash,
                status: Status.ACTIVE,
            },
            select: {
                id: true,
                keyId: true,
                name: true,
                provider: true,
                status: true,
                domain: {
                    select: {
                        name: true,
                    },
                },
                signingKeyHash: true,
            },
        });

        if (encryptedSecret) {
            await transaction.$executeRaw`
                UPDATE ingress_endpoints
                SET signing_secret_encrypted = ${encryptedSecret},
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${updated.id}
            `;
        }
        return { endpoint: updated, reusedStoredSecret: canReuseStoredSecret };
    });

    console.log(JSON.stringify({
        ensured: true,
        encryptedSigningSecretConfigured: true,
        reusedStoredSecret: result.reusedStoredSecret,
        endpoint: result.endpoint,
    }, null, 2));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const minimalEnv = loadMinimalEnv();
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: minimalEnv.DATABASE_URL,
            },
        },
    });

    try {
        if (options.check) {
            const exitCode = await runCheck(prisma, minimalEnv, options);
            process.exitCode = exitCode;
            return;
        }

        await runEnsure(prisma, minimalEnv, options);
    } finally {
        await prisma.$disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
