import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { z } from 'zod';

import { env } from './config/env.js';
import { isApiOrAdminPath, shouldServeSpaIndex } from './lib/http.js';
import { checkReadiness } from './lib/readiness.js';
import { ensurePrecompressedAssets } from './lib/static-compression.js';
import { emailOAuthService } from './modules/email/email.oauth.service.js';
import authPlugin from './plugins/auth.js';
import errorPlugin from './plugins/error.js';
import { registerAdminRoutes } from './routes/admin.assembly.js';
import { registerExternalApiRoutes } from './routes/external-api.assembly.js';
import { registerIngressRoutes } from './routes/ingress.assembly.js';
import { registerPortalRoutes } from './routes/portal.assembly.js';
import { ROUTE_PREFIXES } from './routes/prefixes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const legacyOAuthCallbackQuerySchema = z.object({
    state: z.string().optional(),
    code: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
});

export async function buildApp() {
    const fastify = Fastify({
        requestIdHeader: 'x-request-id',
        requestIdLogLabel: 'requestId',
        logger: env.NODE_ENV === 'development' ? {
            transport: {
                target: 'pino-pretty',
                options: { colorize: true },
            },
        } : true,
    });

    const parsedCorsOrigins = (env.CORS_ORIGIN || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const corsOrigin = parsedCorsOrigins.length > 0
        ? parsedCorsOrigins
        : env.NODE_ENV === 'development';

    await fastify.register(fastifyCors, {
        origin: corsOrigin,
        credentials: true,
    });

    await fastify.register(fastifyHelmet, {
        contentSecurityPolicy: false,
    });

    await fastify.register(fastifyCookie);
    await fastify.register(errorPlugin);
    await fastify.register(authPlugin);

    fastify.addHook('onRequest', async (request, reply) => {
        reply.header('x-request-id', request.id);
    });

    fastify.addHook('onSend', async (request, reply, payload) => {
        const path = request.url.split('?')[0];
        if (path === '/health' || path === '/readyz' || isApiOrAdminPath(path)) {
            reply.header('Cache-Control', 'no-store');
        }
        return payload;
    });

    fastify.get('/health', async () => {
        return {
            success: true,
            data: {
                status: 'ok',
            },
        };
    });

    fastify.get('/readyz', async (_request, reply) => {
        const readiness = await checkReadiness();
        return reply
            .code(readiness.ready ? 200 : 503)
            .send({
                success: readiness.ready,
                data: {
                    status: readiness.ready ? 'ready' : 'not-ready',
                    checks: readiness.checks,
                },
            });
    });

    fastify.get(ROUTE_PREFIXES.legacyOauth, async (request, reply) => {
        const query = legacyOAuthCallbackQuerySchema.parse(request.query);
        const result = await emailOAuthService.completeAuthorization({
            provider: 'OUTLOOK',
            state: query.state,
            code: query.code,
            error: query.error,
            errorDescription: query.error_description,
        });
        return reply.redirect(emailOAuthService.buildRedirectUrl(result));
    });

    const staticRoot = join(__dirname, '../../public');
    let hasStaticRoot = false;
    try {
        await access(staticRoot);
        hasStaticRoot = true;
    } catch {
        fastify.log.info({ staticRoot }, 'Static asset directory not found; skipping SPA asset registration');
    }

    if (hasStaticRoot && env.NODE_ENV === 'production') {
        try {
            const compressionResult = await ensurePrecompressedAssets(staticRoot);
            fastify.log.info({
                staticFiles: compressionResult.files,
                generatedCompressedFiles: compressionResult.generated,
            }, 'Static precompression ready');
        } catch (err) {
            fastify.log.warn({ err }, 'Failed to precompress static assets');
        }
    }

    if (hasStaticRoot) {
        await fastify.register(fastifyStatic, {
            root: staticRoot,
            prefix: '/',
            wildcard: false,
            preCompressed: true,
        });
    }

    await registerAdminRoutes(fastify);
    await registerExternalApiRoutes(fastify);
    await registerPortalRoutes(fastify);
    await registerIngressRoutes(fastify);

    fastify.setNotFoundHandler(async (request, reply) => {
        const path = request.url.split('?')[0];
        const accepts = request.headers.accept;

        if (isApiOrAdminPath(path)) {
            return reply.status(404).send({
                success: false,
                requestId: request.id,
                error: { code: 'NOT_FOUND' },
            });
        }

        if (!shouldServeSpaIndex({ method: request.method, path, accept: accepts })) {
            return reply.status(404).send({
                success: false,
                requestId: request.id,
                error: { code: 'NOT_FOUND' },
            });
        }

        if (hasStaticRoot) {
            return reply.sendFile('index.html');
        }

        return reply.status(404).send({
            success: false,
            requestId: request.id,
            error: { code: 'NOT_FOUND' },
        });
    });

    return fastify;
}

export default buildApp;
