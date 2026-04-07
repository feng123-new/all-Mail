import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyToken } from '../lib/jwt.js';
import { hashApiKey } from '../lib/crypto.js';
import { env } from '../config/env.js';
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { getRedis } from '../lib/redis.js';
import { ADMIN_PASSWORD_CHANGE_ALLOWED_PATHS, MAILBOX_PASSWORD_CHANGE_ALLOWED_PATHS } from '../routes/prefixes.js';
import { AppError } from './error.js';
import { isApiPermissionAllowed, parseApiPermissions, type ApiPermissions } from './api-permissions.js';

declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            id: number;
            username: string;
            role: string;
            mustChangePassword: boolean;
        };
        apiKey?: {
            id: number;
            name: string;
            rateLimit: number;
            permissions?: ApiPermissions;
        };
        mailboxUser?: {
            id: number;
            username: string;
            role: string;
            mailboxIds: number[];
            mustChangePassword: boolean;
        };
        ingressEndpoint?: {
            id: number;
            domainId?: number | null;
            keyId: string;
            name: string;
        };
        ingressRawBody?: string;
    }
}

const MAILBOX_JWT_AUDIENCE = 'mailbox-portal';
const ADMIN_JWT_AUDIENCE = 'admin-console';

function isAdminPasswordChangeAllowedPath(request: FastifyRequest): boolean {
    const path = request.url.split('?')[0];
    return ADMIN_PASSWORD_CHANGE_ALLOWED_PATHS.includes(path);
}

function isMailboxPasswordChangeAllowedPath(request: FastifyRequest): boolean {
    const path = request.url.split('?')[0];
    return MAILBOX_PASSWORD_CHANGE_ALLOWED_PATHS.includes(path);
}

/**
 * 提取 Token（从 Header 或 Cookie）
 */
function extractToken(request: FastifyRequest): string | null {
    // Cookie
    const cookieToken = request.cookies?.token;
    if (cookieToken) {
        return cookieToken;
    }

    // Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    return null;
}

function extractMailboxToken(request: FastifyRequest): string | null {
    const cookieToken = request.cookies?.mailbox_token;
    if (cookieToken) {
        return cookieToken;
    }

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    return null;
}

/**
 * 提取 API Key
 */
function extractApiKey(request: FastifyRequest): string | null {
    // X-API-Key header
    const headerKey = request.headers['x-api-key'];
    if (typeof headerKey === 'string') {
        return headerKey;
    }

    // Authorization: Bearer sk_xxx
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer sk_')) {
        return authHeader.substring(7);
    }

    return null;
}

function extractHeaderValue(request: FastifyRequest, name: string): string | null {
    const value = request.headers[name.toLowerCase()];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasExpectedAudience(audience: unknown, expected: string): boolean {
    if (typeof audience === 'string') {
        return audience === expected;
    }
    if (Array.isArray(audience)) {
        return audience.includes(expected);
    }
    return false;
}

function buildIngressCanonicalString(request: FastifyRequest, timestamp: string): string {
    const bodySource = typeof request.ingressRawBody === 'string' ? request.ingressRawBody : '';
    const bodyHash = createHash('sha256').update(bodySource).digest('hex');
    const path = request.url.split('?')[0];
    return `${timestamp}\n${request.method.toUpperCase()}\n${path}\n${bodyHash}`;
}

function signaturesMatch(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (actualBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return timingSafeEqual(actualBuffer, expectedBuffer);
}

function extractIngressBodyDomain(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
        return null;
    }
    const routing = (body as Record<string, unknown>).routing;
    if (!routing || typeof routing !== 'object') {
        return null;
    }
    const domain = (routing as Record<string, unknown>).domain;
    return typeof domain === 'string' && domain.trim() ? domain.trim() : null;
}

function extractIngressDeliveryKey(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
        return null;
    }

    const deliveryKey = (body as Record<string, unknown>).deliveryKey;
    return typeof deliveryKey === 'string' && deliveryKey.trim() ? deliveryKey.trim() : null;
}

const localRateLimitStore = new Map<number, { count: number; resetAt: number }>();
const localIngressReplayStore = new Map<string, number>();

export function shouldAllowLocalRateLimitFallback(): boolean {
    return env.NODE_ENV !== 'production' || env.ALLOW_LOCAL_RATE_LIMIT_FALLBACK;
}

interface RateLimitRedisClient {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
}

interface IngressReplayRedisClient {
    set(key: string, value: string, mode: 'EX', seconds: number, condition: 'NX'): Promise<'OK' | null>;
}

interface ApiKeyRateLimitEnforcerOptions {
    allowLocalFallback?: boolean;
    getRedisClient?: () => RateLimitRedisClient | null;
    localStore?: Map<number, { count: number; resetAt: number }>;
    now?: () => number;
}

export function createApiKeyRateLimitEnforcer(options: ApiKeyRateLimitEnforcerOptions = {}) {
    const allowLocalFallback = options.allowLocalFallback ?? shouldAllowLocalRateLimitFallback();
    const getRedisClient = options.getRedisClient ?? (() => getRedis());
    const localStore = options.localStore ?? localRateLimitStore;
    const nowSource = options.now ?? Date.now;

    return async function enforceApiKeyRateLimit(apiKeyId: number, maxPerMinute: number): Promise<void> {
        if (maxPerMinute <= 0) {
            return;
        }

        const now = nowSource();
        const redis = getRedisClient();

        if (redis) {
            try {
                const minuteBucket = Math.floor(now / 60000);
                const key = `rate_limit:api_key:${apiKeyId}:${minuteBucket}`;
                const count = await redis.incr(key);

                if (count === 1) {
                    await redis.expire(key, 60);
                }

                if (count > maxPerMinute) {
                    throw new AppError('RATE_LIMIT_EXCEEDED', `Rate limit exceeded: ${maxPerMinute} requests/minute`, 429);
                }
                return;
            } catch (error) {
                if (!allowLocalFallback) {
                    throw new AppError('RATE_LIMIT_BACKEND_UNAVAILABLE', 'Rate limit backend is unavailable', 503);
                }

                logger.warn({ err: error }, 'Redis rate limit backend unavailable; falling back to local in-memory limits');
            }
        } else if (!allowLocalFallback) {
            throw new AppError('RATE_LIMIT_BACKEND_UNAVAILABLE', 'Rate limit backend is unavailable', 503);
        }

        const existing = localStore.get(apiKeyId);
        if (!existing || now >= existing.resetAt) {
            localStore.set(apiKeyId, {
                count: 1,
                resetAt: now + 60000,
            });
            return;
        }

        existing.count += 1;
        if (existing.count > maxPerMinute) {
            throw new AppError('RATE_LIMIT_EXCEEDED', `Rate limit exceeded: ${maxPerMinute} requests/minute`, 429);
        }
    };
}

const enforceApiKeyRateLimit = createApiKeyRateLimitEnforcer();

async function reserveIngressReplayKey(replayKey: string, ttlSeconds: number): Promise<boolean> {
    const redis = getRedis() as IngressReplayRedisClient | null;
    if (redis) {
        try {
            const result = await redis.set(replayKey, '1', 'EX', ttlSeconds, 'NX');
            return result === 'OK';
        } catch (error) {
            logger.warn({ err: error }, 'Ingress replay backend unavailable; falling back to local in-memory replay protection');
        }
    }

    const now = Date.now();
    for (const [key, expiresAt] of localIngressReplayStore.entries()) {
        if (expiresAt <= now) {
            localIngressReplayStore.delete(key);
        }
    }

    const existing = localIngressReplayStore.get(replayKey);
    if (existing && existing > now) {
        return false;
    }

    localIngressReplayStore.set(replayKey, now + (ttlSeconds * 1000));
    return true;
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
    /**
     * JWT 认证 (管理后台)
     */
    fastify.decorate('authenticateJwt', async (request: FastifyRequest, _reply: FastifyReply) => {
        const token = extractToken(request);

        if (!token) {
            throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
        }

        const payload = await verifyToken(token);
        if (!payload || !hasExpectedAudience(payload.aud, ADMIN_JWT_AUDIENCE)) {
            throw new AppError('INVALID_TOKEN', 'Invalid or expired token', 401);
        }

        const adminId = Number.parseInt(payload.sub, 10);
        if (!Number.isInteger(adminId) || adminId <= 0) {
            throw new AppError('INVALID_TOKEN', 'Invalid or expired token', 401);
        }

        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                id: true,
                username: true,
                role: true,
                status: true,
                mustChangePassword: true,
            },
        });

        if (!admin) {
            throw new AppError('INVALID_TOKEN', 'Admin session is no longer valid', 401);
        }

        if (admin.status !== 'ACTIVE') {
            throw new AppError('ACCOUNT_DISABLED', 'Account is disabled', 403);
        }

        request.user = {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            mustChangePassword: admin.mustChangePassword,
        };

        if (admin.mustChangePassword && !isAdminPasswordChangeAllowedPath(request)) {
            throw new AppError('PASSWORD_CHANGE_REQUIRED', 'You must change the initial password before continuing.', 403);
        }
    });

    /**
     * API Key 认证 (外部 API)
     */
    fastify.decorate('authenticateApiKey', async (request: FastifyRequest, _reply: FastifyReply) => {
        const key = extractApiKey(request);

        if (!key) {
            throw new AppError('UNAUTHORIZED', 'API Key required', 401);
        }

        const keyHash = hashApiKey(key);
        const apiKey = await prisma.apiKey.findUnique({
            where: { keyHash },
            select: {
                id: true,
                name: true,
                rateLimit: true,
                status: true,
                expiresAt: true,
                permissions: true,
            },
        });

        if (!apiKey) {
            throw new AppError('INVALID_API_KEY', 'Invalid API Key', 401);
        }

        if (apiKey.status !== 'ACTIVE') {
            throw new AppError('API_KEY_DISABLED', 'API Key is disabled', 403);
        }

        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
            throw new AppError('API_KEY_EXPIRED', 'API Key has expired', 403);
        }

        // 限流检查（按 API Key）
        await enforceApiKeyRateLimit(apiKey.id, apiKey.rateLimit);

        // 更新使用统计
        await prisma.apiKey.update({
            where: { id: apiKey.id },
            data: {
                usageCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        request.apiKey = {
            id: apiKey.id,
            name: apiKey.name,
            rateLimit: apiKey.rateLimit,
            permissions: parseApiPermissions(apiKey.permissions),
        };
    });

    fastify.decorate('assertApiPermission', (request: FastifyRequest, action: string) => {
        if (!request.apiKey) {
            throw new AppError('UNAUTHORIZED', 'API Key required', 401);
        }

        if (!isApiPermissionAllowed(request.apiKey.permissions, action)) {
            throw new AppError('FORBIDDEN_PERMISSION', `API Key has no permission for action: ${action}`, 403);
        }
    });

    fastify.decorate('authenticateMailboxJwt', async (request: FastifyRequest, _reply: FastifyReply) => {
        const token = extractMailboxToken(request);
        if (!token) {
            throw new AppError('UNAUTHORIZED', 'Mailbox authentication required', 401);
        }

        const payload = await verifyToken(token);
        if (!payload || !hasExpectedAudience(payload.aud, MAILBOX_JWT_AUDIENCE)) {
            throw new AppError('INVALID_MAILBOX_TOKEN', 'Invalid or expired mailbox token', 401);
        }

        const rawId = payload.mailboxUserId ?? payload.sub;
        const id = Number.parseInt(String(rawId), 10);
        if (!Number.isFinite(id) || id <= 0) {
            throw new AppError('INVALID_MAILBOX_TOKEN', 'Mailbox token is missing a valid subject', 401);
        }

        const [mailboxUser, ownedMailboxes, memberships] = await Promise.all([
            prisma.mailboxUser.findUnique({
                where: { id },
                select: {
                    id: true,
                    username: true,
                    status: true,
                    mustChangePassword: true,
                },
            }),
            prisma.domainMailbox.findMany({
                where: {
                    ownerUserId: id,
                    status: 'ACTIVE',
                },
                select: { id: true },
            }),
            prisma.mailboxMembership.findMany({
                where: {
                    userId: id,
                    mailbox: {
                        status: 'ACTIVE',
                    },
                },
                select: { mailboxId: true },
            }),
        ]);

        if (!mailboxUser) {
            throw new AppError('INVALID_MAILBOX_TOKEN', 'Mailbox user no longer exists', 401);
        }

        if (mailboxUser.status !== 'ACTIVE') {
            throw new AppError('ACCOUNT_DISABLED', 'Mailbox user is disabled', 403);
        }

        const mailboxIds = Array.from(new Set([
            ...ownedMailboxes.map((item) => item.id),
            ...memberships.map((item) => item.mailboxId),
        ]));

        request.mailboxUser = {
            id,
            username: mailboxUser.username || payload.username,
            role: payload.role,
            mailboxIds,
            mustChangePassword: mailboxUser.mustChangePassword,
        };

        if (mailboxUser.mustChangePassword && !isMailboxPasswordChangeAllowedPath(request)) {
            throw new AppError('PASSWORD_CHANGE_REQUIRED', 'You must change the initial mailbox password before continuing.', 403);
        }
    });

    fastify.decorate('authenticateIngressSignature', async (request: FastifyRequest, _reply: FastifyReply) => {
        if (!env.INGRESS_SIGNING_SECRET) {
            throw new AppError('INGRESS_NOT_CONFIGURED', 'Ingress signing is not configured', 503);
        }

        const keyId = extractHeaderValue(request, 'x-ingress-key-id');
        const timestamp = extractHeaderValue(request, 'x-ingress-timestamp');
        const signature = extractHeaderValue(request, 'x-ingress-signature');

        if (!keyId || !timestamp || !signature) {
            throw new AppError('INGRESS_SIGNATURE_REQUIRED', 'Missing ingress signature headers', 401);
        }

        const timestampMs = Number.parseInt(timestamp, 10) * 1000;
        if (!Number.isFinite(timestampMs)) {
            throw new AppError('INGRESS_SIGNATURE_INVALID', 'Invalid ingress timestamp', 401);
        }

        const skewMs = env.INGRESS_ALLOWED_SKEW_SECONDS * 1000;
        if (Math.abs(Date.now() - timestampMs) > skewMs) {
            throw new AppError('INGRESS_SIGNATURE_EXPIRED', 'Ingress signature timestamp is outside the allowed window', 401);
        }

        const endpoint = await prisma.ingressEndpoint.findUnique({
            where: { keyId },
            select: {
                id: true,
                domainId: true,
                keyId: true,
                name: true,
                status: true,
                domain: {
                    select: {
                        name: true,
                    },
                },
            },
        });

        if (!endpoint || endpoint.status !== 'ACTIVE') {
            throw new AppError('INGRESS_ENDPOINT_DISABLED', 'Ingress endpoint is invalid or disabled', 403);
        }

        const expectedSignature = createHmac('sha256', env.INGRESS_SIGNING_SECRET)
            .update(buildIngressCanonicalString(request, timestamp))
            .digest('hex');

        if (!signaturesMatch(signature, expectedSignature)) {
            throw new AppError('INGRESS_SIGNATURE_INVALID', 'Ingress signature verification failed', 401);
        }

        const bodyDomain = extractIngressBodyDomain(request.body);
        if (endpoint.domain?.name && bodyDomain && endpoint.domain.name !== bodyDomain) {
            throw new AppError('INGRESS_ENDPOINT_DOMAIN_MISMATCH', 'Ingress endpoint is not allowed to submit for this domain', 403);
        }

        const replayTtlSeconds = Math.max(env.INGRESS_ALLOWED_SKEW_SECONDS * 2, 60);
        const deliveryKey = extractIngressDeliveryKey(request.body);
        const replayKey = deliveryKey
            ? `ingress:replay:${keyId}:${deliveryKey}`
            : `ingress:replay:${keyId}:${signature}`;
        const reserved = await reserveIngressReplayKey(replayKey, replayTtlSeconds);
        if (!reserved) {
            throw new AppError('INGRESS_REPLAY_DETECTED', 'Ingress request has already been processed', 409);
        }

        request.ingressEndpoint = {
            id: endpoint.id,
            domainId: endpoint.domainId,
            keyId: endpoint.keyId,
            name: endpoint.name,
        };
    });

    /**
     * 超级管理员权限检查
     */
    fastify.decorate('requireSuperAdmin', async (request: FastifyRequest, _reply: FastifyReply) => {
        if (!request.user) {
            throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
        }

        if (request.user.role !== 'SUPER_ADMIN') {
            throw new AppError('FORBIDDEN', 'Super admin access required', 403);
        }
    });
};

declare module 'fastify' {
    interface FastifyInstance {
        authenticateJwt: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        authenticateApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        authenticateMailboxJwt: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        authenticateIngressSignature: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        requireSuperAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        assertApiPermission: (request: FastifyRequest, action: string) => void;
    }
}

export default fp(authPlugin, { name: 'auth', dependencies: ['error'] });
