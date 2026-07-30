import assert from 'node:assert/strict';
import test from 'node:test';

import type { Prisma } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL = '';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';

function toPrismaPromise<T>(value: T): Prisma.PrismaPromise<T> {
    return Promise.resolve(value) as Prisma.PrismaPromise<T>;
}

void test('login fails closed when 2FA is enabled without a persisted secret', async () => {
    const [{ authService }, { default: prisma }, { hashPassword }] = await Promise.all([
        import('./auth.service.js'),
        import('../../lib/prisma.js'),
        import('../../lib/crypto.js'),
    ]);

    const originalFindUnique = prisma.admin.findUnique.bind(prisma.admin);
    const passwordHash = await hashPassword('correct-password');

    prisma.admin.findUnique = (() => toPrismaPromise({
        id: 7,
        username: 'broken-2fa-admin',
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        twoFactorEnabled: true,
        twoFactorSecret: null,
    })) as typeof prisma.admin.findUnique;
    try {
        await assert.rejects(
            () => authService.login({
                username: 'broken-2fa-admin',
                password: 'correct-password',
                otp: '123456',
            }, '127.0.0.1'),
            (error: unknown) => {
                const appError = error as { code?: string; statusCode?: number };
                assert.equal(appError.code, 'TWO_FACTOR_CONFIGURATION_INVALID');
                assert.equal(appError.statusCode, 500);
                return true;
            },
        );
    } finally {
        prisma.admin.findUnique = originalFindUnique;
    }
});
