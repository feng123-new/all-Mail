import assert from 'node:assert/strict';
import test from 'node:test';

import { MailProvider, PrismaClient } from '@prisma/client';

const databaseUrl = process.env.ALLMAIL_BOOTSTRAP_ADMIN_TEST_DATABASE_URL?.trim();

void test(
    'legacy environment configuration imports once into durable state and rejects conflicts',
    { skip: !databaseUrl },
    async () => {
        const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const domainName = `import-${suffix}.example.com`;
        const keyId = `edge-${suffix}`;
        const username = `config-import-${suffix}`.slice(0, 50);
        const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

        const [{ importEnvironmentConfiguration }, { decrypt }] = await Promise.all([
            import('./importEnvironmentConfig.js'),
            import('../lib/crypto.js'),
        ]);

        try {
            const admin = await prisma.admin.create({
                data: {
                    username,
                    passwordHash: 'not-used-in-config-import-test',
                    role: 'SUPER_ADMIN',
                    status: 'ACTIVE',
                },
            });
            const domain = await prisma.domain.create({
                data: {
                    name: domainName,
                    displayName: 'environment import test',
                    canReceive: true,
                    canSend: false,
                    isCatchAllEnabled: false,
                    createdByAdminId: admin.id,
                },
            });

            const environment = {
                DATABASE_URL: databaseUrl,
                GOOGLE_OAUTH_CLIENT_ID: `gmail-client-${suffix}`,
                GOOGLE_OAUTH_CLIENT_SECRET: `gmail-secret-${suffix}`,
                GOOGLE_OAUTH_REDIRECT_URI: `https://mail.example.com/admin/oauth/google/callback`,
                GOOGLE_OAUTH_SCOPES: 'openid email profile',
                SEND_ENABLED_DOMAINS: domainName,
                INGRESS_SIGNING_SECRET: `ingress-secret-${suffix}`,
                INGRESS_IMPORT_KEY_ID: keyId,
            } as NodeJS.ProcessEnv;

            const first = await importEnvironmentConfiguration(prisma, environment);
            assert.deepEqual(first.oauthImported, [MailProvider.GMAIL]);
            assert.deepEqual(first.sendApproved, [domainName]);
            assert.deepEqual(first.ingressImported, [keyId]);

            const oauth = await prisma.providerOAuthConfig.findUniqueOrThrow({
                where: { provider: MailProvider.GMAIL },
            });
            assert.equal(oauth.clientId, environment.GOOGLE_OAUTH_CLIENT_ID);
            assert.equal(decrypt(oauth.clientSecret as string), environment.GOOGLE_OAUTH_CLIENT_SECRET);

            const approval = await prisma.$queryRaw<Array<{
                send_approved: boolean;
                send_approval_source: string | null;
            }>>`
                SELECT send_approved, send_approval_source
                FROM domains
                WHERE id = ${domain.id}
            `;
            assert.equal(approval[0].send_approved, true);
            assert.equal(approval[0].send_approval_source, 'environment-import');

            const ingress = await prisma.$queryRaw<Array<{
                signing_key_hash: string | null;
                signing_secret_encrypted: string | null;
            }>>`
                SELECT signing_key_hash, signing_secret_encrypted
                FROM ingress_endpoints
                WHERE key_id = ${keyId}
            `;
            assert.ok(ingress[0].signing_key_hash);
            assert.equal(decrypt(ingress[0].signing_secret_encrypted as string), environment.INGRESS_SIGNING_SECRET);

            const second = await importEnvironmentConfiguration(prisma, environment);
            assert.deepEqual(second.oauthUnchanged, [MailProvider.GMAIL]);
            assert.deepEqual(second.ingressUnchanged, [keyId]);

            await assert.rejects(
                importEnvironmentConfiguration(prisma, {
                    ...environment,
                    GOOGLE_OAUTH_CLIENT_SECRET: 'conflicting-secret',
                }),
                /conflicts with the legacy environment values/,
            );
        } finally {
            await prisma.ingressEndpoint.deleteMany({ where: { keyId } });
            await prisma.domain.deleteMany({ where: { name: domainName } });
            await prisma.providerOAuthConfig.deleteMany({ where: { provider: MailProvider.GMAIL } });
            await prisma.admin.deleteMany({ where: { username } });
            await prisma.$disconnect();
        }
    },
);

void test(
    'environment configuration import rejects unsafe values and rolls back partial durable state',
    { skip: !databaseUrl },
    async () => {
        const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const domainName = `rollback-${suffix}.example.com`;
        const missingDomainName = `missing-${suffix}.example.com`;
        const username = `config-rollback-${suffix}`.slice(0, 50);
        const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        const [{ importEnvironmentConfiguration }, { domainService }, { decrypt }] = await Promise.all([
            import('./importEnvironmentConfig.js'),
            import('../modules/domain/domain.service.js'),
            import('../lib/crypto.js'),
        ]);

        try {
            const admin = await prisma.admin.create({
                data: {
                    username,
                    passwordHash: 'not-used-in-config-rollback-test',
                    role: 'SUPER_ADMIN',
                    status: 'ACTIVE',
                },
            });
            const domain = await prisma.domain.create({
                data: {
                    name: domainName,
                    displayName: 'environment import rollback test',
                    canReceive: true,
                    canSend: false,
                    isCatchAllEnabled: false,
                    createdByAdminId: admin.id,
                },
            });

            await prisma.providerOAuthConfig.create({
                data: {
                    provider: MailProvider.OUTLOOK,
                    clientId: `database-client-${suffix}`,
                },
            });
            await assert.rejects(
                importEnvironmentConfiguration(prisma, {
                    MICROSOFT_OAUTH_CLIENT_ID: `environment-client-${suffix}`,
                    MICROSOFT_OAUTH_CLIENT_SECRET: `environment-secret-${suffix}`,
                    MICROSOFT_OAUTH_REDIRECT_URI: 'https://mail.example.com/admin/oauth/microsoft/callback',
                }),
                /conflicts with the legacy environment values/,
            );
            const preserved = await prisma.providerOAuthConfig.findUniqueOrThrow({
                where: { provider: MailProvider.OUTLOOK },
            });
            assert.equal(preserved.clientId, `database-client-${suffix}`);
            assert.equal(preserved.clientSecret, null);
            assert.equal(preserved.redirectUri, null);

            await prisma.providerOAuthConfig.delete({ where: { provider: MailProvider.OUTLOOK } });
            const partialClientId = `partial-client-${suffix}`;
            await prisma.providerOAuthConfig.create({
                data: {
                    provider: MailProvider.OUTLOOK,
                    clientId: partialClientId,
                    scopes: 'offline_access custom.scope',
                },
            });
            const completedPartial = await importEnvironmentConfiguration(prisma, {
                MICROSOFT_OAUTH_CLIENT_ID: partialClientId,
                MICROSOFT_OAUTH_CLIENT_SECRET: `partial-secret-${suffix}`,
                MICROSOFT_OAUTH_REDIRECT_URI: 'https://mail.example.com/admin/oauth/microsoft/callback',
                MICROSOFT_OAUTH_TENANT: 'common',
            });
            assert.deepEqual(completedPartial.oauthImported, [MailProvider.OUTLOOK]);
            const completed = await prisma.providerOAuthConfig.findUniqueOrThrow({
                where: { provider: MailProvider.OUTLOOK },
            });
            assert.equal(completed.clientId, partialClientId);
            assert.equal(decrypt(completed.clientSecret as string), `partial-secret-${suffix}`);
            assert.equal(completed.scopes, 'offline_access custom.scope');
            assert.equal(completed.tenant, 'common');

            await prisma.providerOAuthConfig.delete({ where: { provider: MailProvider.OUTLOOK } });
            await assert.rejects(
                importEnvironmentConfiguration(prisma, {
                    MICROSOFT_OAUTH_CLIENT_ID: `environment-client-${suffix}`,
                    MICROSOFT_OAUTH_CLIENT_SECRET: `environment-secret-${suffix}`,
                    MICROSOFT_OAUTH_REDIRECT_URI: 'https://mail.example.com/admin/oauth/microsoft/callback',
                    SEND_ENABLED_DOMAINS: `${domainName},${missingDomainName}`,
                }),
                /contains unknown domains/,
            );
            assert.equal(
                await prisma.providerOAuthConfig.findUnique({
                    where: { provider: MailProvider.OUTLOOK },
                }),
                null,
            );
            const approval = await prisma.$queryRaw<Array<{ send_approved: boolean }>>`
                SELECT send_approved
                FROM domains
                WHERE id = ${domain.id}
            `;
            assert.equal(approval[0].send_approved, false);

            await assert.rejects(
                domainService.update(domain.id, { canSend: true }),
                /Only a super administrator can approve outbound sending/,
            );
            const approved = await domainService.update(domain.id, { canSend: true }, true);
            assert.equal(approved.canSend, true);
            const regularAdminEdit = await domainService.update(domain.id, {
                displayName: 'approved domain edited by regular admin',
                canSend: true,
            });
            assert.equal(regularAdminEdit.displayName, 'approved domain edited by regular admin');

            await assert.rejects(
                importEnvironmentConfiguration(prisma, {
                    GOOGLE_OAUTH_CLIENT_ID: `google-client-${suffix}`,
                    GOOGLE_OAUTH_CLIENT_SECRET: `google-secret-${suffix}`,
                    GOOGLE_OAUTH_REDIRECT_URI: 'not-an-absolute-url',
                }),
                /must be an absolute URL/,
            );
            await assert.rejects(
                importEnvironmentConfiguration(prisma, {
                    INGRESS_SIGNING_SECRET: 'too-short',
                }),
                /must contain at least 16 characters/,
            );
        } finally {
            await prisma.providerOAuthConfig.deleteMany({ where: { provider: MailProvider.OUTLOOK } });
            await prisma.domain.deleteMany({ where: { name: domainName } });
            await prisma.admin.deleteMany({ where: { username } });
            await prisma.$disconnect();
        }
    },
);
