import { constants as fsConstants } from 'node:fs';
import { access, readFile, rm } from 'node:fs/promises';

import prisma from '../../lib/prisma.js';
import { signToken, verifyToken } from '../../lib/jwt.js';
import { decrypt, encrypt, hashPassword, verifyPassword } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getRedis } from '../../lib/redis.js';
import { AppError } from '../../plugins/error.js';
import type { LoginInput, ChangePasswordInput, Verify2FaInput, Disable2FaInput } from './auth.schema.js';
import { buildTotpUri, generateBase32Secret, verifyTotpCode } from './totp.js';

interface LocalLoginAttemptState {
    count: number;
    resetAt: number;
    lockedUntil: number;
}

const localLoginAttemptStore = new Map<string, LocalLoginAttemptState>();

function buildLoginAttemptCacheKey(username: string, ip?: string): string {
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedIp = ip?.trim() || 'unknown';
    return `admin-login:${normalizedUsername}:${normalizedIp}`;
}

function buildRedisLoginAttemptKey(cacheKey: string): string {
    return `auth:admin:login:attempt:${cacheKey}`;
}

function buildRedisLoginLockKey(cacheKey: string): string {
    return `auth:admin:login:lock:${cacheKey}`;
}

const LOCK_SECONDS = env.ADMIN_LOGIN_LOCK_MINUTES * 60;
const ATTEMPT_WINDOW_SECONDS = LOCK_SECONDS;
const ADMIN_JWT_AUDIENCE = 'admin-console';
const EXTERNAL_SECRET_REVEAL_GRANT_AUDIENCE = 'admin-email-secret-reveal';
const EXTERNAL_SECRET_REVEAL_GRANT_PURPOSE = 'external_password_reveal';
const EXTERNAL_SECRET_REVEAL_GRANT_TTL_MINUTES = 10;

function formatLockMessage(lockSeconds: number): string {
    const minutes = Math.max(1, Math.ceil(lockSeconds / 60));
    return `Too many failed attempts. Please try again in ${minutes} minute(s)`;
}

async function getLockRemainingSeconds(cacheKey: string): Promise<number> {
    const redis = getRedis();
    if (redis) {
        try {
            const ttl = await redis.ttl(buildRedisLoginLockKey(cacheKey));
            if (ttl > 0) {
                return ttl;
            }
        } catch {
            // Redis failure currently falls back to local state. A later hardening
            // slice makes this fail closed in production.
        }
    }

    const state = localLoginAttemptStore.get(cacheKey);
    if (!state) {
        return 0;
    }

    const now = Date.now();
    if (state.lockedUntil > now) {
        return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
    }

    if (state.resetAt <= now) {
        localLoginAttemptStore.delete(cacheKey);
    } else {
        state.lockedUntil = 0;
    }

    return 0;
}

async function clearLoginAttempts(cacheKey: string): Promise<void> {
    const redis = getRedis();
    if (redis) {
        try {
            await redis.del(buildRedisLoginAttemptKey(cacheKey), buildRedisLoginLockKey(cacheKey));
        } catch {
            // Continue clearing local compatibility state.
        }
    }

    localLoginAttemptStore.delete(cacheKey);
}

async function recordLoginFailure(cacheKey: string): Promise<number> {
    const redis = getRedis();
    if (redis) {
        try {
            const attemptKey = buildRedisLoginAttemptKey(cacheKey);
            const lockKey = buildRedisLoginLockKey(cacheKey);
            const count = await redis.incr(attemptKey);
            if (count === 1) {
                await redis.expire(attemptKey, ATTEMPT_WINDOW_SECONDS);
            }

            if (count >= env.ADMIN_LOGIN_MAX_ATTEMPTS) {
                await redis.set(lockKey, '1', 'EX', LOCK_SECONDS);
                await redis.del(attemptKey);
                return LOCK_SECONDS;
            }
            return 0;
        } catch {
            // Continue with the current single-process compatibility fallback.
        }
    }

    const now = Date.now();
    const state = localLoginAttemptStore.get(cacheKey);
    if (!state || state.resetAt <= now) {
        localLoginAttemptStore.set(cacheKey, {
            count: 1,
            resetAt: now + ATTEMPT_WINDOW_SECONDS * 1000,
            lockedUntil: 0,
        });
        return 0;
    }

    if (state.lockedUntil > now) {
        return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
    }

    state.count += 1;
    if (state.count >= env.ADMIN_LOGIN_MAX_ATTEMPTS) {
        state.count = 0;
        state.lockedUntil = now + LOCK_SECONDS * 1000;
        return LOCK_SECONDS;
    }

    localLoginAttemptStore.set(cacheKey, state);
    return 0;
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
        const lockSeconds = await getLockRemainingSeconds(loginAttemptCacheKey);
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
            },
        });

        if (!admin) {
            const newLockSeconds = await recordLoginFailure(loginAttemptCacheKey);
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
            const newLockSeconds = await recordLoginFailure(loginAttemptCacheKey);
            if (newLockSeconds > 0) {
                throw new AppError('ACCOUNT_LOCKED', formatLockMessage(newLockSeconds), 429);
            }
            throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
        }

        const adminTwoFactorSecret = admin.twoFactorEnabled
            ? decryptAdmin2FaSecret(admin.twoFactorSecret)
            : null;
        if (admin.twoFactorEnabled && adminTwoFactorSecret && !verifyTotpCode(adminTwoFactorSecret, otp, env.ADMIN_2FA_WINDOW)) {
            const newLockSeconds = await recordLoginFailure(loginAttemptCacheKey);
            if (newLockSeconds > 0) {
                throw new AppError('ACCOUNT_LOCKED', formatLockMessage(newLockSeconds), 429);
            }
            throw new AppError('INVALID_OTP', 'Invalid two-factor code', 401);
        }

        await clearLoginAttempts(loginAttemptCacheKey);
        await prisma.admin.update({
            where: { id: admin.id },
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ip,
            },
        });

        const token = await signToken({
            sub: admin.id.toString(),
            username: admin.username,
            role: admin.role,
        }, {
            audience: ADMIN_JWT_AUDIENCE,
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

    async changePassword(adminId: number, input: ChangePasswordInput) {
        const { oldPassword, newPassword } = input;
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                username: true,
                passwordHash: true,
                mustChangePassword: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
        }

        const isValid = await verifyPassword(oldPassword, admin.passwordHash);
        if (!isValid) {
            throw new AppError('INVALID_PASSWORD', 'Invalid old password', 400);
        }

        const newHash = await hashPassword(newPassword);
        await prisma.admin.update({
            where: { id: adminId },
            data: {
                passwordHash: newHash,
                mustChangePassword: false,
            },
        });

        if (admin.mustChangePassword) {
            await removeBootstrapAdminSecret(admin.username);
        }

        return {
            success: true,
            mustChangePassword: false,
        };
    },

    async getMe(adminId: number) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
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
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
        }

        return admin;
    },

    async getTwoFactorStatus(adminId: number) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                twoFactorEnabled: true,
                twoFactorTempSecret: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
        }

        return {
            enabled: admin.twoFactorEnabled,
            pending: Boolean(admin.twoFactorTempSecret),
        };
    },

    async setupTwoFactor(adminId: number) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                username: true,
                twoFactorEnabled: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
        }
        if (admin.twoFactorEnabled) {
            throw new AppError('TWO_FACTOR_ENABLED', 'Two-factor already enabled', 400);
        }

        const secret = generateBase32Secret();
        await prisma.admin.update({
            where: { id: admin.id },
            data: { twoFactorTempSecret: encrypt(secret) },
        });

        return {
            secret,
            otpauthUrl: buildTotpUri(secret, admin.username, 'all-Mail'),
        };
    },

    async enableTwoFactor(adminId: number, input: Verify2FaInput) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                twoFactorEnabled: true,
                twoFactorTempSecret: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
        }
        if (admin.twoFactorEnabled) {
            return { enabled: true };
        }

        const tempSecret = decryptAdmin2FaSecret(admin.twoFactorTempSecret);
        if (!tempSecret) {
            throw new AppError('TWO_FACTOR_SETUP_REQUIRED', 'Please generate setup secret first', 400);
        }
        if (!verifyTotpCode(tempSecret, input.otp, env.ADMIN_2FA_WINDOW)) {
            throw new AppError('INVALID_OTP', 'Invalid two-factor code', 401);
        }

        await prisma.admin.update({
            where: { id: admin.id },
            data: {
                twoFactorEnabled: true,
                twoFactorSecret: admin.twoFactorTempSecret,
                twoFactorTempSecret: null,
            },
        });

        return { enabled: true };
    },

    async disableTwoFactor(adminId: number, input: Disable2FaInput) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                passwordHash: true,
                twoFactorEnabled: true,
                twoFactorSecret: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
        }
        if (!admin.twoFactorEnabled) {
            return { enabled: false };
        }

        const isPasswordValid = await verifyPassword(input.password, admin.passwordHash);
        if (!isPasswordValid) {
            throw new AppError('INVALID_PASSWORD', 'Invalid password', 400);
        }

        const secret = decryptAdmin2FaSecret(admin.twoFactorSecret);
        if (!secret || !verifyTotpCode(secret, input.otp, env.ADMIN_2FA_WINDOW)) {
            throw new AppError('INVALID_OTP', 'Invalid two-factor code', 401);
        }

        await prisma.admin.update({
            where: { id: admin.id },
            data: {
                twoFactorEnabled: false,
                twoFactorSecret: null,
                twoFactorTempSecret: null,
            },
        });

        return { enabled: false };
    },

    async verifyStepUpTwoFactor(adminId: number, input: Verify2FaInput) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                twoFactorEnabled: true,
                twoFactorSecret: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
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

    async createExternalSecretRevealGrant(adminId: number) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                username: true,
                role: true,
                twoFactorEnabled: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
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
            },
        );

        return {
            grantToken,
            expiresAt: new Date(expiresAtMs).toISOString(),
        };
    },

    async verifyExternalSecretRevealGrant(adminId: number, grantToken: string) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                twoFactorEnabled: true,
            },
        });

        if (!admin) {
            throw new AppError('NOT_FOUND', 'Admin not found', 404);
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
