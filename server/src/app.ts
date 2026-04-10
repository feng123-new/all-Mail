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

    // 插件
    await fastify.register(fastifyCors, {
        origin: corsOrigin,
        credentials: true,
    });

    await fastify.register(fastifyHelmet, {
        contentSecurityPolicy: false, // 允许前端加载
    });

    await fastify.register(fastifyCookie);

    // 自定义插件
    await fastify.register(errorPlugin);
    await fastify.register(authPlugin);

    fastify.addHook('onRequest', async (request, reply) => {
        reply.header('x-request-id', request.id);
    });

    fastify.addHook('onSend', async (request, reply, payload) => {
        const path = request.url.split('?')[0];
        if (path === '/health' || isApiOrAdminPath(path)) {
            reply.header('Cache-Control', 'no-store');
        }
        return payload;
    });

    // 健康检查
    fastify.get('/health', async () => {
        return {
            success: true,
            data: {
                status: 'ok',
            },
        };
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

    // 静态文件（前端）- 禁用 fastify-static 的默认 404 处理
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
            wildcard: false, // 禁用通配符，让我们自定义处理 SPA
            preCompressed: true,
        });
    }

    await registerAdminRoutes(fastify);
    await registerExternalApiRoutes(fastify);
    await registerPortalRoutes(fastify);
    await registerIngressRoutes(fastify);

    // SPA fallback - 现在可以安全使用 setNotFoundHandler
    fastify.setNotFoundHandler(async (request, reply) => {
        const path = request.url.split('?')[0];
        const accepts = request.headers.accept;

        // 如果是 API 路由，返回 404 JSON
        if (isApiOrAdminPath(path)) {
            return reply.status(404).send({
                success: false,
                requestId: request.id,
                error: { code: 'NOT_FOUND' },
            });
        }

        // 非页面请求，返回 404 JSON
        if (!shouldServeSpaIndex({ method: request.method, path, accept: accepts })) {
            return reply.status(404).send({
                success: false,
                requestId: request.id,
                error: { code: 'NOT_FOUND' },
            });
        }

        // 否则返回 index.html（SPA）
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
