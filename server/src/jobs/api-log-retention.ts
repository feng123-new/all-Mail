import prisma from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let running = false;

export function isLegacyApiLogRetentionOwner(owner: 'legacy' | 'go' = env.API_LOG_RETENTION_OWNER): boolean {
    return owner === 'legacy';
}

async function runApiLogRetentionOnce() {
    if (running) {
        return;
    }

    running = true;
    try {
        const cutoff = new Date(Date.now() - env.API_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const result = await prisma.apiLog.deleteMany({
            where: {
                createdAt: { lt: cutoff },
            },
        });

        if (result.count > 0) {
            logger.info({
                deleted: result.count,
                retentionDays: env.API_LOG_RETENTION_DAYS,
                cutoff: cutoff.toISOString(),
            }, 'API log retention cleanup completed');
        }
    } catch (err) {
        logger.error({ err }, 'API log retention cleanup failed');
    } finally {
        running = false;
    }
}

export function startApiLogRetentionJob(): () => void {
    if (!isLegacyApiLogRetentionOwner()) {
        logger.info({ owner: env.API_LOG_RETENTION_OWNER }, 'Legacy API log retention job disabled');
        return () => undefined;
    }

    const intervalMs = env.API_LOG_CLEANUP_INTERVAL_MINUTES * 60 * 1000;
    logger.info({
        owner: env.API_LOG_RETENTION_OWNER,
        retentionDays: env.API_LOG_RETENTION_DAYS,
        intervalMinutes: env.API_LOG_CLEANUP_INTERVAL_MINUTES,
    }, 'API log retention job started');

    void runApiLogRetentionOnce();
    const timer = setInterval(() => {
        void runApiLogRetentionOnce();
    }, intervalMs);

    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    return () => {
        clearInterval(timer);
    };
}
