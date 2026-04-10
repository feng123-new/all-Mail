import { type FastifyPluginAsync, type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

export class AppError extends Error {
    constructor(
        public code: string,
        message: string,
        public statusCode: number = 400,
        public details?: unknown
    ) {
        super(message);
        this.name = 'AppError';
    }
}

const errorPlugin: FastifyPluginAsync = async (fastify) => {
    fastify.setErrorHandler((error: FastifyError | AppError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
        logger.error({ err: error, path: request.url, method: request.method, requestId: request.id }, 'Request error');

        // Zod 验证错误
        if (error instanceof ZodError) {
            return reply.status(400).send({
                success: false,
                requestId: request.id,
                error: {
                    code: 'VALIDATION_ERROR',
                    details: error.errors.map((issue) => ({
                        code: issue.code,
                        path: issue.path,
                    })),
                },
            });
        }

        // 自定义应用错误
        if (error instanceof AppError) {
            return reply.status(error.statusCode).send({
                success: false,
                requestId: request.id,
                error: {
                    code: error.code,
                    details: error.details,
                },
            });
        }

        // Fastify 验证错误
        if (error.validation) {
            return reply.status(400).send({
                success: false,
                requestId: request.id,
                error: {
                    code: 'VALIDATION_ERROR',
                },
            });
        }

        // 未知错误
        const statusCode = error.statusCode || 500;
        return reply.status(statusCode).send({
            success: false,
            requestId: request.id,
            error: {
                code: 'INTERNAL_ERROR',
            },
        });
    });

    // 注意：404 处理已移至 app.ts 以支持 SPA 路由
};

export default fp(errorPlugin, { name: 'error' });
