import { env } from '../config/env.js';
import prisma from './prisma.js';
import { getRedis } from './redis.js';

export interface ReadinessReport {
    ready: boolean;
    checks: Record<string, string>;
}

interface ReadinessDependencies {
    checkPostgres: () => Promise<void>;
    checkRedis: () => Promise<void>;
    redisRequired: boolean;
    timeoutMs?: number;
}

export function createReadinessChecker(deps: ReadinessDependencies) {
    const timeoutMs = deps.timeoutMs ?? 3000;

    return async function checkReadiness(): Promise<ReadinessReport> {
        const checks: Record<string, string> = {};
        let ready = true;

        try {
            await withTimeout(deps.checkPostgres(), timeoutMs, 'PostgreSQL readiness probe timed out');
            checks.postgres = 'ok';
        } catch {
            ready = false;
            checks.postgres = 'query-failed';
        }

        if (deps.redisRequired) {
            try {
                await withTimeout(deps.checkRedis(), timeoutMs, 'Redis readiness probe timed out');
                checks.redis = 'ok';
            } catch {
                ready = false;
                checks.redis = 'ping-failed';
            }
        } else {
            checks.redis = 'not-configured';
        }

        return { ready, checks };
    };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export const checkReadiness = createReadinessChecker({
    async checkPostgres() {
        await prisma.$queryRaw`SELECT 1`;
    },
    async checkRedis() {
        const redis = getRedis();
        if (!redis) {
            throw new Error('Redis is not configured');
        }
        const response = String(await redis.ping()).toUpperCase();
        if (response !== 'PONG') {
            throw new Error('Unexpected Redis PING response');
        }
    },
    redisRequired: Boolean(env.REDIS_URL),
});
