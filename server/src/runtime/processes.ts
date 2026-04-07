import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { startApiLogRetentionJob } from '../jobs/api-log-retention.js';
import { startForwardingWorker } from '../jobs/forwarding.worker.js';
import { logger } from '../lib/logger.js';
import prisma from '../lib/prisma.js';
import { authService } from '../modules/auth/auth.service.js';

type StopFn = () => void | Promise<void>;

interface RuntimeLogger {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

interface PrismaRuntimeClient {
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
}

interface ApiRuntimeDeps {
    authService: {
        ensureBootstrapAdmin(): Promise<{ username: string } | null>;
    };
    buildApp: () => Promise<FastifyInstance>;
    logger: RuntimeLogger;
    port: number;
    prisma: PrismaRuntimeClient;
}

interface JobsRuntimeDeps {
    logger: RuntimeLogger;
    prisma: PrismaRuntimeClient;
    startApiLogRetentionJob: () => StopFn;
    startForwardingWorker: () => StopFn;
}

const defaultApiRuntimeDeps: ApiRuntimeDeps = {
    authService,
    buildApp,
    logger,
    port: env.PORT,
    prisma,
};

const defaultJobsRuntimeDeps: JobsRuntimeDeps = {
    logger,
    prisma,
    startApiLogRetentionJob,
    startForwardingWorker,
};

export function createApiRuntime(deps: ApiRuntimeDeps = defaultApiRuntimeDeps) {
    let app: FastifyInstance | null = null;
    let started = false;

    return {
        async start(): Promise<void> {
            app = await deps.buildApp();

            try {
                await deps.prisma.$connect();
                deps.logger.info('Database connected');

                const bootstrapAdmin = await deps.authService.ensureBootstrapAdmin();
                if (bootstrapAdmin) {
                    deps.logger.info({ username: bootstrapAdmin.username }, 'Bootstrap admin initialized');
                }

                await app.listen({ port: deps.port, host: '0.0.0.0' });
                deps.logger.info(`Server running at http://localhost:${deps.port}`);
                started = true;
            } catch (error) {
                if (app) {
                    await app.close();
                }
                await deps.prisma.$disconnect();
                throw error;
            }
        },
        async stop(): Promise<void> {
            if (!started) {
                await deps.prisma.$disconnect();
                return;
            }

            deps.logger.info('Shutting down API runtime...');
            if (app) {
                await app.close();
            }
            await deps.prisma.$disconnect();
        },
    };
}

export function createJobsRuntime(deps: JobsRuntimeDeps = defaultJobsRuntimeDeps) {
    let stopApiLogRetentionJob: StopFn = () => undefined;
    let stopForwardingJob: StopFn = () => undefined;
    let started = false;

    return {
        async start(): Promise<void> {
            try {
                await deps.prisma.$connect();
                deps.logger.info('Database connected');

                stopApiLogRetentionJob = deps.startApiLogRetentionJob();
                stopForwardingJob = deps.startForwardingWorker();
                deps.logger.info('Background jobs runtime started');
                started = true;
            } catch (error) {
                await Promise.resolve(stopApiLogRetentionJob());
                await Promise.resolve(stopForwardingJob());
                await deps.prisma.$disconnect();
                throw error;
            }
        },
        async stop(): Promise<void> {
            if (!started) {
                await deps.prisma.$disconnect();
                return;
            }

            deps.logger.info('Shutting down background jobs runtime...');
            await Promise.resolve(stopApiLogRetentionJob());
            await Promise.resolve(stopForwardingJob());
            await deps.prisma.$disconnect();
        },
    };
}
