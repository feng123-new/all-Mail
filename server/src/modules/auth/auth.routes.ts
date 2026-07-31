import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { signToken } from '../../lib/jwt.js';
import { ADMIN_JWT_AUDIENCE } from '../../lib/session-version.js';
import { authService } from './auth.service.js';
import { loginSchema, changePasswordSchema, verify2FaSchema, disable2FaSchema } from './auth.schema.js';

const isSecureCookie = process.env.NODE_ENV === 'production';
const adminSessionCookieOptions = {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7200,
};

const adminClearCookieOptions = {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: 'lax' as const,
    path: '/',
};

async function rotateAdminSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const admin = request.user;
    if (!admin) {
        return;
    }
    const token = await signToken({
        sub: String(admin.id),
        username: admin.username,
        role: admin.role,
    }, { audience: ADMIN_JWT_AUDIENCE });
    reply.cookie('token', token, adminSessionCookieOptions);
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/login', async (request, reply) => {
        const input = loginSchema.parse(request.body);
        const result = await authService.login(input, request.ip);
        reply.cookie('token', result.token, adminSessionCookieOptions);
        return { success: true, data: { admin: result.admin } };
    });

    fastify.post('/logout', async (_request, reply) => {
        reply.clearCookie('token', adminClearCookieOptions);
        return { success: true, data: { code: 'AUTH_LOGGED_OUT' } };
    });

    fastify.get('/me', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const admin = await authService.getMe(request.user!.id);
        return { success: true, data: admin };
    });

    fastify.post('/change-password', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, reply) => {
        const input = changePasswordSchema.parse(request.body);
        await authService.changePassword(request.user!.id, input);
        await rotateAdminSession(request, reply);
        return { success: true, data: { code: 'AUTH_PASSWORD_CHANGED' } };
    });

    fastify.get('/2fa/status', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const result = await authService.getTwoFactorStatus(request.user!.id);
        return { success: true, data: result };
    });

    fastify.post('/2fa/setup', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const result = await authService.setupTwoFactor(request.user!.id);
        return { success: true, data: result };
    });

    fastify.post('/2fa/enable', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, reply) => {
        const input = verify2FaSchema.parse(request.body);
        const result = await authService.enableTwoFactor(request.user!.id, input);
        await rotateAdminSession(request, reply);
        return { success: true, data: result };
    });

    fastify.post('/2fa/disable', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, reply) => {
        const input = disable2FaSchema.parse(request.body);
        const result = await authService.disableTwoFactor(request.user!.id, input);
        await rotateAdminSession(request, reply);
        return { success: true, data: result };
    });
};

export default authRoutes;
