import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { signToken } from '../../lib/jwt.js';
import { ADMIN_JWT_AUDIENCE } from '../../lib/session-version.js';
import { AppError } from '../../plugins/error.js';
import { changePasswordSchema, disable2FaSchema, loginSchema, verify2FaSchema } from './auth.schema.js';
import { authService } from './auth.service.js';

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

function getAdminAuthContext(request: FastifyRequest) {
    const admin = request.user;
    if (!admin) {
        throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    }
    return admin;
}

async function rotateAdminSession(
    request: FastifyRequest,
    reply: FastifyReply,
    sessionVersion: number,
): Promise<void> {
    const admin = getAdminAuthContext(request);
    const token = await signToken({
        sub: String(admin.id),
        username: admin.username,
        role: admin.role,
    }, { audience: ADMIN_JWT_AUDIENCE, sessionVersion });
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
        const context = getAdminAuthContext(request);
        const admin = await authService.getMe(context.id, context.sessionVersion);
        return { success: true, data: admin };
    });

    fastify.post('/change-password', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, reply) => {
        const admin = getAdminAuthContext(request);
        const input = changePasswordSchema.parse(request.body);
        const result = await authService.changePassword(admin.id, admin.sessionVersion, input);
        await rotateAdminSession(request, reply, result.sessionVersion);
        return { success: true, data: { code: 'AUTH_PASSWORD_CHANGED' } };
    });

    fastify.get('/2fa/status', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const admin = getAdminAuthContext(request);
        const result = await authService.getTwoFactorStatus(admin.id, admin.sessionVersion);
        return { success: true, data: result };
    });

    fastify.post('/2fa/setup', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const admin = getAdminAuthContext(request);
        const { sessionVersion: _sessionVersion, ...result } = await authService.setupTwoFactor(
            admin.id,
            admin.sessionVersion,
        );
        return { success: true, data: result };
    });

    fastify.post('/2fa/enable', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, reply) => {
        const admin = getAdminAuthContext(request);
        const input = verify2FaSchema.parse(request.body);
        const { sessionVersion, ...result } = await authService.enableTwoFactor(
            admin.id,
            admin.sessionVersion,
            input,
        );
        if (sessionVersion !== admin.sessionVersion) {
            await rotateAdminSession(request, reply, sessionVersion);
        }
        return { success: true, data: result };
    });

    fastify.post('/2fa/disable', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, reply) => {
        const admin = getAdminAuthContext(request);
        const input = disable2FaSchema.parse(request.body);
        const { sessionVersion, ...result } = await authService.disableTwoFactor(
            admin.id,
            admin.sessionVersion,
            input,
        );
        if (sessionVersion !== admin.sessionVersion) {
            await rotateAdminSession(request, reply, sessionVersion);
        }
        return { success: true, data: result };
    });
};

export default authRoutes;
