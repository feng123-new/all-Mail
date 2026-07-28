import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import prisma from '../lib/prisma.js';
import { authService } from '../modules/auth/auth.service.js';

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

const defaultApiRuntimeDeps: ApiRuntimeDeps = {
    authService,
    buildApp,
    logger,
    port: env.PORT,
    prisma,
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
