import { constants as fsConstants } from 'node:fs';
import { access, readFile, rm } from 'node:fs/promises';

import { env } from '../../config/env.js';
import { decrypt, encrypt, hashPassword, verifyPassword } from '../../lib/crypto.js';
import { signToken, verifyToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import type { ChangePasswordInput, Disable2FaInput, LoginInput, Verify2FaInput } from './auth.schema.js';
import { adminLoginAttempts, buildLoginAttemptCacheKey } from './login-attempts.js';
import { buildTotpUri, generateBase32Secret, verifyTotpCode } from './totp.js';

const ADMIN_JWT_AUDIENCE = 'admin-console';
const EXTERNAL_SECRET_REVEAL_GRANT_AUDIENCE = 'admin-email-secret-reveal';
const EXTERNAL_SECRET_REVEAL_GRANT_PURPOSE = 'external_password_reveal';
const EXTERNAL_SECRET_REVEAL_GRANT_TTL_MINUTES = 10;

function formatLockMessage(lockSeconds: number): string {
    const minutes = Math.max(1, Math.ceil(lockSeconds / 60));
    return `Too many failed attempts. Please try again in ${minutes} minute(s)`;
}

function decryptAdmin2FaSecret(encryptedSecret: string | null | undefined): string | null {
    if (!encryptedSecret) {
        return null;
    }

    try {
        return decrypt(encryptedSecret);
    } catch {
        throw new AppError('TWO_FACTOR_SECRET_INVALID', 'Invalid two-factor configuration', 500);
    }
}

function invalidAdminSession(): AppError {
    return new AppError('INVALID_TOKEN', 'Admin session is no longer valid', 401);
}

function parseBootstrapAdminUsername(content: string): string | null {
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }
        if (line.slice(0, separatorIndex).trim() === 'ADMIN_USERNAME') {
            return line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        }
    }
    return null;
}

async function removeBootstrapAdminSecret(username: string): Promise<void> {
    const file = env.BOOTSTRAP_ADMIN_SECRET_FILE;
    try {
        await access(file, fsConstants.R_OK);
        const storedUsername = parseBootstrapAdminUsername(await readFile(file, 'utf8'));
        if (storedUsername !== username) {
            return;
        }
        await rm(file, { force: true });
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (code === 'ENOENT') {
            return;
        }
        logger.error({ err: error, file, username }, 'Failed to remove consumed bootstrap admin credential');
    }
}

export const authService = {
    async login(input: LoginInput, ip?: string) {
        const { username, password, otp } = input;
        const loginAttemptCacheKey = buildLoginAttemptCacheKey(username, ip);
        const lockSeconds = await adminLoginAttempts.getLockRemainingSeconds(loginAttemptCacheKey);
        if (lockSeconds > 0) {
            throw new AppError('ACCOUNT_LOCKED', formatLockMessage(lockSeconds), 429);
        }

        const admin = await prisma.admin.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                passwordHash: true,
                role: true,
                status: true,
                mustChangePassword: true,
                twoFactorEnabled: true,
                twoFactorSecret: true,
                sessionVersion: true,
            },
        });

        if (!admin) {
            const newLockSeconds = await adminLoginAttempts.recordFailure(loginAttemptCacheKey);
            if (newLockSeconds > 0) {
                throw new AppError('ACCOUNT_LOCKED', formatLockMessage(newLockSeconds), 429);
            }
            throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
        }

        if (admin.status !== 'ACTIVE') {
            throw new AppError('ACCOUNT_DISABLED', 'Account is disabled', 403);
        }

        const isValid = await verifyPassword(password, admin.passwordHash);
        if (!isValid) {
            const newLockSeconds = await adminLoginAttempts.recordFailure(loginAttemptCacheKey);
            if (newLockSeconds > 0) {
                throw new AppError('ACCOUNT_LOCKED', formatLockMessage(newLockSeconds), 429);
            }
            throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
        }

        if (admin.twoFactorEnabled) {
            if (otp === undefined) {
                throw new AppError('OTP_REQUIRED', 'Two-factor code is required', 401);
            }
            const adminTwoFactorSecret = decryptAdmin2FaSecret(admin.twoFactorSecret);
            if (!adminTwoFactorSecret) {
                throw new AppError(
                    'TWO_FACTOR_CONFIGURATION_INVALID',
                    'Invalid two-factor configuration',
                    500,
                );
            }
            if (!verifyTotpCode(adminTwoFactorSecret, otp, env.ADMIN_2FA_WINDOW)) {
                const newLockSeconds = await adminLoginAttempts.recordFailure(loginAttemptCacheKey);
                if (newLockSeconds > 0) {
                    throw new AppError('ACCOUNT_LOCKED', formatLockMessage(newLockSeconds), 429);
                }
                throw new AppError('INVALID_OTP', 'Invalid two-factor code', 401);
            }
        }

        await adminLoginAttempts.clear(loginAttemptCacheKey);
        const loginUpdate = await prisma.admin.updateMany({
            where: {
                id: admin.id,
                sessionVersion: admin.sessionVersion,
                status: 'ACTIVE',
            },
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ip,
            },
        });
        if (loginUpdate.count !== 1) {
            throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
        }

        const token = await signToken({
            sub: admin.id.toString(),
            username: admin.username,
            role: admin.role,
        }, {
            audience: ADMIN_JWT_AUDIENCE,
            sessionVersion: admin.sessionVersion,
        });

        return {
            token,
            admin: {
                id: admin.id,
                username: admin.username,
                role: admin.role,
                mustChangePassword: admin.mustChangePassword,
                twoFactorEnabled: admin.twoFactorEnabled,
            },
        };
    },

    async changePassword(adminId: number, authenticatedVersion: number, input: ChangePasswordInput) {
        const { oldPassword, newPassword } = input;
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                username: true,
                passwordHash: true,
                mustChangePassword: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }

        const isValid = await verifyPassword(oldPassword, admin.passwordHash);
        if (!isValid) {
            throw new AppError('INVALID_PASSWORD', 'Invalid old password', 400);
        }

        const newHash = await hashPassword(newPassword);
        const result = await prisma.admin.updateMany({
            where: {
                id: adminId,
                sessionVersion: authenticatedVersion,
                passwordHash: admin.passwordHash,
                status: 'ACTIVE',
            },
            data: {
                passwordHash: newHash,
                mustChangePassword: false,
            },
        });
        if (result.count !== 1) {
            throw invalidAdminSession();
        }

        if (admin.mustChangePassword) {
            await removeBootstrapAdminSecret(admin.username);
        }

        return {
            success: true,
            mustChangePassword: false,
            sessionVersion: authenticatedVersion + 1,
        };
    },

    async getMe(adminId: number, authenticatedVersion: number) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                mustChangePassword: true,
                twoFactorEnabled: true,
                lastLoginAt: true,
                createdAt: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }

        return admin;
    },

    async getTwoFactorStatus(adminId: number, authenticatedVersion: number) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                twoFactorEnabled: true,
                twoFactorTempSecret: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }

        return {
            enabled: admin.twoFactorEnabled,
            pending: Boolean(admin.twoFactorTempSecret),
        };
    },

    async setupTwoFactor(adminId: number, authenticatedVersion: number) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                username: true,
                twoFactorEnabled: true,
                twoFactorTempSecret: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }
        if (admin.twoFactorEnabled) {
            throw new AppError('TWO_FACTOR_ENABLED', 'Two-factor already enabled', 400);
        }

        const secret = generateBase32Secret();
        const result = await prisma.admin.updateMany({
            where: {
                id: admin.id,
                sessionVersion: authenticatedVersion,
                twoFactorEnabled: false,
                twoFactorTempSecret: admin.twoFactorTempSecret,
                status: 'ACTIVE',
            },
            data: { twoFactorTempSecret: encrypt(secret) },
        });
        if (result.count !== 1) {
            throw invalidAdminSession();
        }

        return {
            secret,
            otpauthUrl: buildTotpUri(secret, admin.username, 'all-Mail'),
            sessionVersion: authenticatedVersion,
        };
    },

    async enableTwoFactor(adminId: number, authenticatedVersion: number, input: Verify2FaInput) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                twoFactorEnabled: true,
                twoFactorTempSecret: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }
        if (admin.twoFactorEnabled) {
            return { enabled: true, sessionVersion: authenticatedVersion };
        }

        const tempSecret = decryptAdmin2FaSecret(admin.twoFactorTempSecret);
        if (!tempSecret) {
            throw new AppError('TWO_FACTOR_SETUP_REQUIRED', 'Please generate setup secret first', 400);
        }
        if (!verifyTotpCode(tempSecret, input.otp, env.ADMIN_2FA_WINDOW)) {
            throw new AppError('INVALID_OTP', 'Invalid two-factor code', 401);
        }

        const result = await prisma.admin.updateMany({
            where: {
                id: admin.id,
                sessionVersion: authenticatedVersion,
                twoFactorEnabled: false,
                twoFactorTempSecret: admin.twoFactorTempSecret,
                status: 'ACTIVE',
            },
            data: {
                twoFactorEnabled: true,
                twoFactorSecret: admin.twoFactorTempSecret,
                twoFactorTempSecret: null,
            },
        });
        if (result.count !== 1) {
            throw invalidAdminSession();
        }

        return { enabled: true, sessionVersion: authenticatedVersion + 1 };
    },

    async disableTwoFactor(adminId: number, authenticatedVersion: number, input: Disable2FaInput) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                passwordHash: true,
                twoFactorEnabled: true,
                twoFactorSecret: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }
        if (!admin.twoFactorEnabled) {
            return { enabled: false, sessionVersion: authenticatedVersion };
        }

        const isPasswordValid = await verifyPassword(input.password, admin.passwordHash);
        if (!isPasswordValid) {
            throw new AppError('INVALID_PASSWORD', 'Invalid password', 400);
        }

        const secret = decryptAdmin2FaSecret(admin.twoFactorSecret);
        if (!secret || !verifyTotpCode(secret, input.otp, env.ADMIN_2FA_WINDOW)) {
            throw new AppError('INVALID_OTP', 'Invalid two-factor code', 401);
        }

        const result = await prisma.admin.updateMany({
            where: {
                id: admin.id,
                sessionVersion: authenticatedVersion,
                passwordHash: admin.passwordHash,
                twoFactorEnabled: true,
                twoFactorSecret: admin.twoFactorSecret,
                status: 'ACTIVE',
            },
            data: {
                twoFactorEnabled: false,
                twoFactorSecret: null,
                twoFactorTempSecret: null,
            },
        });
        if (result.count !== 1) {
            throw invalidAdminSession();
        }

        return { enabled: false, sessionVersion: authenticatedVersion + 1 };
    },

    async verifyStepUpTwoFactor(adminId: number, authenticatedVersion: number, input: Verify2FaInput) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                twoFactorEnabled: true,
                twoFactorSecret: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }
        if (!admin.twoFactorEnabled) {
            throw new AppError(
                'TWO_FACTOR_REQUIRED',
                'Enable two-factor authentication before revealing secrets',
                403,
            );
        }

        const secret = decryptAdmin2FaSecret(admin.twoFactorSecret);
        if (!secret || !verifyTotpCode(secret, input.otp, env.ADMIN_2FA_WINDOW)) {
            throw new AppError('INVALID_OTP', 'Invalid two-factor code', 401);
        }

        return { verified: true };
    },

    async createExternalSecretRevealGrant(adminId: number, authenticatedVersion: number) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                username: true,
                role: true,
                twoFactorEnabled: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }
        if (!admin.twoFactorEnabled) {
            throw new AppError(
                'TWO_FACTOR_REQUIRED',
                'Enable two-factor authentication before revealing secrets',
                403,
            );
        }

        const expiresAtMs = Date.now() + EXTERNAL_SECRET_REVEAL_GRANT_TTL_MINUTES * 60 * 1000;
        const grantToken = await signToken(
            {
                sub: String(admin.id),
                role: admin.role,
                username: admin.username,
                purpose: EXTERNAL_SECRET_REVEAL_GRANT_PURPOSE,
            },
            {
                audience: EXTERNAL_SECRET_REVEAL_GRANT_AUDIENCE,
                expiresIn: `${EXTERNAL_SECRET_REVEAL_GRANT_TTL_MINUTES}m`,
                sessionVersion: authenticatedVersion,
            },
        );

        return {
            grantToken,
            expiresAt: new Date(expiresAtMs).toISOString(),
        };
    },

    async verifyExternalSecretRevealGrant(adminId: number, authenticatedVersion: number, grantToken: string) {
        const admin = await prisma.admin.findFirst({
            where: { id: adminId, sessionVersion: authenticatedVersion },
            select: {
                id: true,
                twoFactorEnabled: true,
            },
        });

        if (!admin) {
            throw invalidAdminSession();
        }
        if (!admin.twoFactorEnabled) {
            throw new AppError(
                'TWO_FACTOR_REQUIRED',
                'Enable two-factor authentication before revealing secrets',
                403,
            );
        }

        const payload = await verifyToken(grantToken);
        const audience = Array.isArray(payload?.aud)
            ? payload.aud.map(String)
            : payload?.aud
                ? [String(payload.aud)]
                : [];

        if (
            !payload
            || payload.sub !== String(admin.id)
            || !audience.includes(EXTERNAL_SECRET_REVEAL_GRANT_AUDIENCE)
            || payload.purpose !== EXTERNAL_SECRET_REVEAL_GRANT_PURPOSE
        ) {
            throw new AppError(
                'REVEAL_UNLOCK_EXPIRED',
                'Reveal unlock expired or invalid',
                401,
            );
        }

        return { verified: true };
    },
};
