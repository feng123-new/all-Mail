import { createHash } from 'node:crypto';

import { MailProvider, PrismaClient } from '@prisma/client';

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

    // The shipped template includes callback and scope defaults. They are not
    // an import request unless at least one credential field is populated.
    if (!clientId && !clientSecret) {
        return null;
    }
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error(`${provider} OAuth environment import requires client id, client secret, and redirect URI`);
    }

    return { provider, clientId, clientSecret, redirectUri, scopes, tenant };
}

function sameOAuthConfig(
    current: {
        clientId: string | null;
        clientSecret: string | null;
        redirectUri: string | null;
        scopes: string | null;
        tenant: string | null;
    },
    desired: OAuthImportConfig,
): boolean {
    const currentSecret = current.clientSecret ? decrypt(current.clientSecret) : null;
    return current.clientId === desired.clientId
        && currentSecret === desired.clientSecret
        && current.redirectUri === desired.redirectUri
        && normalizedScopes(current.scopes || undefined) === desired.scopes
        && normalized(current.tenant || undefined) === desired.tenant;
}

async function importOAuthConfig(
    client: PrismaClient,
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

    if (current && current.clientId && current.clientSecret && current.redirectUri) {
        if (!sameOAuthConfig(current, desired)) {
            throw new Error(`${desired.provider} OAuth database configuration conflicts with the legacy environment values`);
        }
        summary.oauthUnchanged.push(desired.provider);
        return;
    }

    await client.providerOAuthConfig.upsert({
        where: { provider: desired.provider },
        update: {
            clientId: desired.clientId,
            clientSecret: encrypt(desired.clientSecret),
            redirectUri: desired.redirectUri,
            scopes: desired.scopes,
            tenant: desired.tenant,
        },
        create: {
            provider: desired.provider,
            clientId: desired.clientId,
            clientSecret: encrypt(desired.clientSecret),
            redirectUri: desired.redirectUri,
            scopes: desired.scopes,
            tenant: desired.tenant,
        },
    });
    summary.oauthImported.push(desired.provider);
}

async function importSendApprovals(
    client: PrismaClient,
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
        const updated = await client.$executeRaw`
            UPDATE "domains"
            SET "send_approved" = true,
                "send_approved_at" = COALESCE("send_approved_at", CURRENT_TIMESTAMP),
                "send_approval_source" = COALESCE("send_approval_source", 'environment-import'),
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "name" = ${name}
        `;
        if (updated === 1) {
            summary.sendApproved.push(name);
        } else {
            summary.sendApprovalMissing.push(name);
        }
    }

    if (summary.sendApprovalMissing.length > 0) {
        throw new Error(
            `SEND_ENABLED_DOMAINS contains unknown domains: ${summary.sendApprovalMissing.join(', ')}`,
        );
    }
}

async function importIngressSecret(
    client: PrismaClient,
    environment: NodeJS.ProcessEnv,
    summary: EnvironmentConfigImportSummary,
): Promise<void> {
    const secret = normalized(environment.INGRESS_SIGNING_SECRET);
    if (!secret) {
        return;
    }

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
            await importOAuthConfig(client, desired, summary);
        }
    }
    await importSendApprovals(client, environment, summary);
    await importIngressSecret(client, environment, summary);
    return summary;
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
