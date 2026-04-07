import { type FastifyPluginAsync } from 'fastify';
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

const authRoutes: FastifyPluginAsync = async (fastify) => {
    // 登录
    fastify.post('/login', async (request, reply) => {
        const input = loginSchema.parse(request.body);
        const result = await authService.login(input, request.ip);

        // 设置 Cookie
        reply.cookie('token', result.token, adminSessionCookieOptions);

        return { success: true, data: { admin: result.admin } };
    });

    // 登出
    fastify.post('/logout', async (request, reply) => {
        reply.clearCookie('token', adminClearCookieOptions);
        return { success: true, data: { message: 'Logged out' } };
    });

    // 获取当前用户
    fastify.get('/me', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, _reply) => {
        const admin = await authService.getMe(request.user!.id);
        return { success: true, data: admin };
    });

    // 修改密码
    fastify.post('/change-password', {
        preHandler: [fastify.authenticateJwt],
    }, async (request, _reply) => {
        const input = changePasswordSchema.parse(request.body);
        await authService.changePassword(request.user!.id, input);
        return { success: true, data: { message: 'Password changed' } };
    });

    // 2FA 状态
    fastify.get('/2fa/status', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const result = await authService.getTwoFactorStatus(request.user!.id);
        return { success: true, data: result };
    });

    // 生成 2FA 绑定信息
    fastify.post('/2fa/setup', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const result = await authService.setupTwoFactor(request.user!.id);
        return { success: true, data: result };
    });

    // 启用 2FA
    fastify.post('/2fa/enable', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const input = verify2FaSchema.parse(request.body);
        const result = await authService.enableTwoFactor(request.user!.id, input);
        return { success: true, data: result };
    });

    // 禁用 2FA
    fastify.post('/2fa/disable', {
        preHandler: [fastify.authenticateJwt],
    }, async (request) => {
        const input = disable2FaSchema.parse(request.body);
        const result = await authService.disableTwoFactor(request.user!.id, input);
        return { success: true, data: result };
    });
};

export default authRoutes;
