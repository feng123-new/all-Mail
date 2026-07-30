import { createHash } from 'node:crypto';

import { MailProvider, type Prisma, type PrismaClient } from '@prisma/client';

import { decrypt, encrypt } from '../lib/crypto.js';
import prisma from '../lib/prisma.js';

interface OAuthImportConfig {
    provider: MailProvider;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string | null;
    tenant: string | null;
}

interface IngressSecretRow {
    id: number;
    key_id: string;
    signing_key_hash: string | null;
    signing_secret_encrypted: string | null;
}

type EnvironmentConfigClient = Pick<
    Prisma.TransactionClient,
    'providerOAuthConfig' | 'domain' | 'ingressEndpoint' | '$queryRaw' | '$executeRaw'
>;

export interface EnvironmentConfigImportSummary {
    oauthImported: string[];
    oauthUnchanged: string[];
    sendApproved: string[];
    sendApprovalMissing: string[];
    ingressImported: string[];
    ingressUnchanged: string[];
}

function normalized(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function normalizedScopes(value: string | undefined): string | null {
    const scopes = normalized(value);
    return scopes ? Array.from(new Set(scopes.split(/\s+/).filter(Boolean))).join(' ') : null;
}

function validateAbsoluteUrl(name: string, value: string): void {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${name} must be an absolute URL`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error(`${name} must be an absolute HTTP(S) URL`);
    }
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

function buildOAuthImportConfig(
    provider: MailProvider,
    environment: NodeJS.ProcessEnv,
): OAuthImportConfig | null {
    const prefix = provider === MailProvider.GMAIL ? 'GOOGLE' : 'MICROSOFT';
    const clientId = normalized(environment[`${prefix}_OAUTH_CLIENT_ID`]);
    const clientSecret = normalized(environment[`${prefix}_OAUTH_CLIENT_SECRET`]);
    const redirectUri = normalized(environment[`${prefix}_OAUTH_REDIRECT_URI`]);
    const scopes = normalizedScopes(environment[`${prefix}_OAUTH_SCOPES`]);
    const tenant = provider === MailProvider.OUTLOOK
        ? normalized(environment.MICROSOFT_OAUTH_TENANT)
        : null;

    if (!clientId && !clientSecret) {
        return null;
    }
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error(`${provider} OAuth environment import requires client id, client secret, and redirect URI`);
    }
    validateAbsoluteUrl(`${provider} OAuth redirect URI`, redirectUri);

    return { provider, clientId, clientSecret, redirectUri, scopes, tenant };
}

async function importOAuthConfig(
    client: EnvironmentConfigClient,
    desired: OAuthImportConfig,
    summary: EnvironmentConfigImportSummary,
): Promise<void> {
    const current = await client.providerOAuthConfig.findUnique({
        where: { provider: desired.provider },
        select: {
            clientId: true,
            clientSecret: true,
            redirectUri: true,
            scopes: true,
            tenant: true,
        },
    });

    const currentSecret = current?.clientSecret ? decrypt(current.clientSecret) : null;
    const currentScopes = normalizedScopes(current?.scopes || undefined);
    const currentTenant = normalized(current?.tenant || undefined);
    if (current) {
        const hasConflict = (current.clientId !== null && current.clientId !== desired.clientId)
            || (currentSecret !== null && currentSecret !== desired.clientSecret)
            || (current.redirectUri !== null && current.redirectUri !== desired.redirectUri)
            || (desired.scopes !== null && currentScopes !== null && currentScopes !== desired.scopes)
            || (desired.tenant !== null && currentTenant !== null && currentTenant !== desired.tenant);
        if (hasConflict) {
            throw new Error(`${desired.provider} OAuth database configuration conflicts with the legacy environment values`);
        }

        const isComplete = current.clientId === desired.clientId
            && currentSecret === desired.clientSecret
            && current.redirectUri === desired.redirectUri
            && (desired.scopes === null || currentScopes === desired.scopes)
            && (desired.tenant === null || currentTenant === desired.tenant);
        if (isComplete) {
            summary.oauthUnchanged.push(desired.provider);
            return;
        }
    }

    const clientSecret = current?.clientSecret || encrypt(desired.clientSecret);
    const clientId = current?.clientId || desired.clientId;
    const redirectUri = current?.redirectUri || desired.redirectUri;
    const scopes = currentScopes || desired.scopes;
    const tenant = currentTenant || desired.tenant;

    await client.providerOAuthConfig.upsert({
        where: { provider: desired.provider },
        update: {
            clientId,
            clientSecret,
            redirectUri,
            scopes,
            tenant,
        },
        create: {
            provider: desired.provider,
            clientId,
            clientSecret,
            redirectUri,
            scopes,
            tenant,
        },
    });
    summary.oauthImported.push(desired.provider);
}

async function importSendApprovals(
    client: EnvironmentConfigClient,
    environment: NodeJS.ProcessEnv,
    summary: EnvironmentConfigImportSummary,
): Promise<void> {
    const names = Array.from(new Set(
        String(environment.SEND_ENABLED_DOMAINS || '')
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean),
    ));

    for (const name of names) {
        const domain = await client.domain.findUnique({
            where: { name },
            select: { id: true },
        });
        if (!domain) {
            summary.sendApprovalMissing.push(name);
            continue;
        }
        await client.$executeRaw`
            UPDATE "domains"
            SET "send_approved" = true,
                "send_approved_at" = COALESCE("send_approved_at", CURRENT_TIMESTAMP),
                "send_approval_source" = COALESCE("send_approval_source", 'environment-import'),
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = ${domain.id}
              AND "send_approved" = false
        `;
        summary.sendApproved.push(name);
    }

    if (summary.sendApprovalMissing.length > 0) {
        throw new Error(
            `SEND_ENABLED_DOMAINS contains unknown domains: ${summary.sendApprovalMissing.join(', ')}`,
        );
    }
}

async function importIngressSecret(
    client: EnvironmentConfigClient,
    environment: NodeJS.ProcessEnv,
    summary: EnvironmentConfigImportSummary,
): Promise<void> {
    const secret = normalized(environment.INGRESS_SIGNING_SECRET);
    if (!secret) {
        return;
    }
    validateIngressSecret(secret);

    const keyId = normalized(environment.INGRESS_IMPORT_KEY_ID) || 'allmail-edge-main';
    const signingKeyHash = createHash('sha256').update(secret).digest('hex');
    let rows = await client.$queryRaw<IngressSecretRow[]>`
        SELECT id, key_id, signing_key_hash, signing_secret_encrypted
        FROM ingress_endpoints
        WHERE key_id = ${keyId}
    `;

    if (rows.length === 0) {
        await client.ingressEndpoint.create({
            data: {
                keyId,
                name: 'environment-imported ingress endpoint',
                provider: 'CLOUDFLARE_WORKER',
                signingKeyHash,
                status: 'ACTIVE',
            },
        });
        rows = await client.$queryRaw<IngressSecretRow[]>`
            SELECT id, key_id, signing_key_hash, signing_secret_encrypted
            FROM ingress_endpoints
            WHERE key_id = ${keyId}
        `;
    }

    const row = rows[0];
    if (row.signing_key_hash && row.signing_key_hash !== signingKeyHash) {
        throw new Error(`Ingress endpoint ${keyId} conflicts with the legacy environment signing secret`);
    }
    if (row.signing_secret_encrypted) {
        if (decrypt(row.signing_secret_encrypted) !== secret) {
            throw new Error(`Ingress endpoint ${keyId} contains a different encrypted signing secret`);
        }
        summary.ingressUnchanged.push(keyId);
        return;
    }

    const encrypted = encrypt(secret);
    await client.$executeRaw`
        UPDATE ingress_endpoints
        SET signing_key_hash = ${signingKeyHash},
            signing_secret_encrypted = ${encrypted},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${row.id}
    `;
    summary.ingressImported.push(keyId);
}

export async function importEnvironmentConfiguration(
    client: PrismaClient = prisma,
    environment: NodeJS.ProcessEnv = process.env,
): Promise<EnvironmentConfigImportSummary> {
    return client.$transaction(async (transaction) => {
        const summary: EnvironmentConfigImportSummary = {
            oauthImported: [],
            oauthUnchanged: [],
            sendApproved: [],
            sendApprovalMissing: [],
            ingressImported: [],
            ingressUnchanged: [],
        };

        for (const provider of [MailProvider.GMAIL, MailProvider.OUTLOOK]) {
            const desired = buildOAuthImportConfig(provider, environment);
            if (desired) {
                await importOAuthConfig(transaction, desired, summary);
            }
        }
        await importSendApprovals(transaction, environment, summary);
        await importIngressSecret(transaction, environment, summary);
        return summary;
    });
}

async function main(): Promise<void> {
    const summary = await importEnvironmentConfiguration();
    console.log(JSON.stringify({ importedEnvironmentConfiguration: summary }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
        .finally(() => prisma.$disconnect())
        .catch((error) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        });
}
