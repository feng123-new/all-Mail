import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.ALLMAIL_BOOTSTRAP_ADMIN_TEST_DATABASE_URL?.trim();

void test(
    'ingress endpoint checks support host-key-free verification and reject a supplied wrong key',
    { skip: !databaseUrl },
    async () => {
        const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const keyId = `ingress-check-${suffix}`;
        const encryptionKey = '0123456789abcdef0123456789abcdef';
        const signingSecret = `ingress-check-secret-${suffix}`;
        const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        const { runCheck, runEnsure } = await import('../../scripts/ensure-ingress-endpoint.js');
        const options = {
            check: false,
            global: true,
            keyId,
            name: 'ingress configuration integration test',
            provider: 'CLOUDFLARE_WORKER',
        };

        try {
            await runEnsure(prisma, {
                DATABASE_URL: databaseUrl,
                INGRESS_SIGNING_SECRET: signingSecret,
                ENCRYPTION_KEY: encryptionKey,
            }, options);

            assert.equal(await runCheck(prisma, {
                DATABASE_URL: databaseUrl,
                INGRESS_SIGNING_SECRET: signingSecret,
            }, options), 0);
            assert.equal(await runCheck(prisma, {
                DATABASE_URL: databaseUrl,
                ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210',
            }, options), 1);
            assert.equal(await runCheck(prisma, {
                DATABASE_URL: databaseUrl,
                ENCRYPTION_KEY: encryptionKey,
            }, options), 0);
        } finally {
            await prisma.ingressEndpoint.deleteMany({ where: { keyId } });
            await prisma.$disconnect();
        }
    },
);
