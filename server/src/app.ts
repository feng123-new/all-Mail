import Fastify from 'fastify';
import { z } from 'zod';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

import { env } from './config/env.js';
import errorPlugin from './plugins/error.js';
import authPlugin from './plugins/auth.js';
import { isApiOrAdminPath, shouldServeSpaIndex } from './lib/http.js';
import { ensurePrecompressedAssets } from './lib/static-compression.js';

// Routes
import authRoutes from './modules/auth/auth.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import apiKeyRoutes from './modules/api-key/apiKey.routes.js';
import emailRoutes from './modules/email/email.routes.js';
import { emailOAuthService } from './modules/email/email.oauth.service.js';
import emailOAuthRoutes from './modules/email/email.oauth.routes.js';
import groupRoutes from './modules/email/group.routes.js';
import mailRoutes from './modules/mail/mail.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import domainRoutes from './modules/domain/domain.routes.js';
import domainMailboxApiRoutes from './modules/domain-mailbox/domainMailbox.api.routes.js';
import domainMailboxRoutes from './modules/domain-mailbox/domainMailbox.routes.js';
import mailboxUserRoutes from './modules/mailbox-user/mailboxUser.routes.js';
import mailboxPortalRoutes from './modules/mailbox-user/mailboxPortal.routes.js';
import messageRoutes from './modules/message/message.routes.js';
import ingressRoutes from './modules/ingress/ingress.routes.js';
import sendRoutes from './modules/send/send.routes.js';

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

    fastify.get('/oauth', async (request, reply) => {
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

    // API 路由
    await fastify.register(authRoutes, { prefix: '/admin/auth' });
    await fastify.register(adminRoutes, { prefix: '/admin/admins' });
    await fastify.register(apiKeyRoutes, { prefix: '/admin/api-keys' });
    await fastify.register(emailRoutes, { prefix: '/admin/emails' });
    await fastify.register(emailOAuthRoutes, { prefix: '/admin/oauth' });
    await fastify.register(groupRoutes, { prefix: '/admin/email-groups' });
    await fastify.register(dashboardRoutes, { prefix: '/admin/dashboard' });
    await fastify.register(domainRoutes, { prefix: '/admin/domains' });
    await fastify.register(domainMailboxRoutes, { prefix: '/admin/domain-mailboxes' });
    await fastify.register(messageRoutes, { prefix: '/admin/domain-messages' });
    await fastify.register(mailboxUserRoutes, { prefix: '/admin/mailbox-users' });
    await fastify.register(sendRoutes, { prefix: '/admin/send' });

    // 外部 API
    await fastify.register(mailRoutes, { prefix: '/api' });
    await fastify.register(domainMailboxApiRoutes, { prefix: '/api/domain-mail' });
    await fastify.register(mailboxPortalRoutes, { prefix: '/mail/api' });
    await fastify.register(ingressRoutes, { prefix: '/ingress/domain-mail' });

    // SPA fallback - 现在可以安全使用 setNotFoundHandler
    fastify.setNotFoundHandler(async (request, reply) => {
        const path = request.url.split('?')[0];
        const accepts = request.headers.accept;

        // 如果是 API 路由，返回 404 JSON
        if (isApiOrAdminPath(path)) {
            return reply.status(404).send({
                success: false,
                requestId: request.id,
                error: { code: 'NOT_FOUND', message: 'Route not found' },
            });
        }

        // 非页面请求，返回 404 JSON
        if (!shouldServeSpaIndex({ method: request.method, path, accept: accepts })) {
            return reply.status(404).send({
                success: false,
                requestId: request.id,
                error: { code: 'NOT_FOUND', message: 'Route not found' },
            });
        }

        // 否则返回 index.html（SPA）
        if (hasStaticRoot) {
            return reply.sendFile('index.html');
        }

        return reply.status(404).send({
            success: false,
            requestId: request.id,
            error: { code: 'NOT_FOUND', message: 'Static frontend assets are not available in this runtime' },
        });
    });

    return fastify;
}

export default buildApp;
