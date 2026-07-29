import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getRedis } from '../../lib/redis.js';
import { allowLocalSecurityState, securityStateUnavailable } from '../../lib/security-state.js';

interface LocalLoginAttemptState {
    count: number;
    resetAt: number;
    lockedUntil: number;
}

interface LoginAttemptRedisClient {
    ttl(key: string): Promise<number>;
    del(...keys: string[]): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

interface LoginAttemptControllerOptions {
    allowLocalFallback?: boolean;
    getRedisClient?: () => LoginAttemptRedisClient | null;
    localStore?: Map<string, LocalLoginAttemptState>;
    maxAttempts?: number;
    lockSeconds?: number;
    now?: () => number;
}

function redisAttemptKey(cacheKey: string): string {
    return `auth:admin:login:attempt:${cacheKey}`;
}

function redisLockKey(cacheKey: string): string {
    return `auth:admin:login:lock:${cacheKey}`;
}

export function buildLoginAttemptCacheKey(username: string, ip?: string): string {
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedIp = ip?.trim() || 'unknown';
    return `admin-login:${normalizedUsername}:${normalizedIp}`;
}

export function createLoginAttemptController(options: LoginAttemptControllerOptions = {}) {
    const allowLocalFallback = options.allowLocalFallback ?? allowLocalSecurityState();
    const getRedisClient = options.getRedisClient ?? (() => getRedis());
    const localStore = options.localStore ?? new Map<string, LocalLoginAttemptState>();
    const maxAttempts = options.maxAttempts ?? env.ADMIN_LOGIN_MAX_ATTEMPTS;
    const lockSeconds = options.lockSeconds ?? env.ADMIN_LOGIN_LOCK_MINUTES * 60;
    const nowSource = options.now ?? Date.now;

    function requireFallback(operation: string, cause?: unknown): void {
        if (!allowLocalFallback) {
            throw securityStateUnavailable(
                'LOGIN_SECURITY_BACKEND_UNAVAILABLE',
                'Login protection backend is unavailable',
                cause,
            );
        }
        logger.warn({ err: cause, operation }, 'Redis login protection unavailable; using local development state');
    }

    return {
        async getLockRemainingSeconds(cacheKey: string): Promise<number> {
            const redis = getRedisClient();
            if (redis) {
                try {
                    const ttl = await redis.ttl(redisLockKey(cacheKey));
                    if (ttl > 0) {
                        return ttl;
                    }
                    return 0;
                } catch (error) {
                    requireFallback('get-lock', error);
                }
            } else {
                requireFallback('get-lock');
            }

            const state = localStore.get(cacheKey);
            if (!state) {
                return 0;
            }
            const now = nowSource();
            if (state.lockedUntil > now) {
                return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
            }
            if (state.resetAt <= now) {
                localStore.delete(cacheKey);
            } else {
                state.lockedUntil = 0;
            }
            return 0;
        },

        async clear(cacheKey: string): Promise<void> {
            const redis = getRedisClient();
            if (redis) {
                try {
                    await redis.del(redisAttemptKey(cacheKey), redisLockKey(cacheKey));
                    localStore.delete(cacheKey);
                    return;
                } catch (error) {
                    requireFallback('clear', error);
                }
            } else {
                requireFallback('clear');
            }
            localStore.delete(cacheKey);
        },

        async recordFailure(cacheKey: string): Promise<number> {
            const redis = getRedisClient();
            if (redis) {
                try {
                    const attemptKey = redisAttemptKey(cacheKey);
                    const lockKey = redisLockKey(cacheKey);
                    const count = await redis.incr(attemptKey);
                    if (count === 1) {
                        await redis.expire(attemptKey, lockSeconds);
                    }
                    if (count >= maxAttempts) {
                        await redis.set(lockKey, '1', 'EX', lockSeconds);
                        await redis.del(attemptKey);
                        return lockSeconds;
                    }
                    return 0;
                } catch (error) {
                    requireFallback('record-failure', error);
                }
            } else {
                requireFallback('record-failure');
            }

            const now = nowSource();
            const state = localStore.get(cacheKey);
            if (!state || state.resetAt <= now) {
                localStore.set(cacheKey, {
                    count: 1,
                    resetAt: now + lockSeconds * 1000,
                    lockedUntil: 0,
                });
                return 0;
            }
            if (state.lockedUntil > now) {
                return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
            }
            state.count += 1;
            if (state.count >= maxAttempts) {
                state.count = 0;
                state.lockedUntil = now + lockSeconds * 1000;
                return lockSeconds;
            }
            localStore.set(cacheKey, state);
            return 0;
        },
    };
}

export const adminLoginAttempts = createLoginAttemptController();
