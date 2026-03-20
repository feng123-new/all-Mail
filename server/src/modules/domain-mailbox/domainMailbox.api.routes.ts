import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../plugins/error.js';
import { mailService } from '../mail/mail.service.js';
import { MAIL_LOG_ACTIONS } from '../mail/mail.actions.js';
import { domainMailboxPoolService } from './domainMailbox.pool.service.js';

const domainMailboxSelectorSchema = z.object({
    domainId: z.coerce.number().int().positive().optional(),
    domain: z.string().trim().min(1).optional(),
    batchTag: z.string().trim().min(1).optional(),
});

const domainMailboxEmailSchema = z.object({
    email: z.string().trim().email(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const domainMailboxTextSchema = z.object({
    email: z.string().trim().email(),
    match: z.string().trim().optional(),
});

function getInputFromRequest<T>(request: { method: string; query: unknown; body: unknown }, schema: z.ZodType<T>): T {
    return schema.parse(request.method === 'GET' ? request.query : request.body);
}

function getErrorStatusCode(err: unknown): number {
    if (!err || typeof err !== 'object') {
        return 500;
    }
    const errorObj = err as { name?: unknown; statusCode?: unknown };
    if (errorObj.name === 'ZodError') {
        return 400;
    }
    return typeof errorObj.statusCode === 'number' ? errorObj.statusCode : 500;
}

function getErrorMessage(err: unknown): string {
    if (!err || typeof err !== 'object') {
        return 'Unknown error';
    }
    const message = (err as { message?: unknown }).message;
    return typeof message === 'string' && message.trim() ? message : 'Unknown error';
}

const domainMailboxApiRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticateApiKey);

    fastify.all('/get-mailbox', async (request) => {
        const startTime = Date.now();
        try {
            if (!request.apiKey?.id) {
                throw new AppError('AUTH_REQUIRED', 'API Key required', 401);
            }
            fastify.assertApiPermission(request, MAIL_LOG_ACTIONS.DOMAIN_GET_MAILBOX);
            const input = getInputFromRequest(request, domainMailboxSelectorSchema);
            const result = await domainMailboxPoolService.getUnusedMailbox(request.apiKey.id, input);
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_GET_MAILBOX, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
            return { success: true, data: result };
        } catch (err) {
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_GET_MAILBOX, request.apiKey?.id, undefined, request.ip, getErrorStatusCode(err), Date.now() - startTime, request.id);
            throw err;
        }
    });

    fastify.all('/mail_new', async (request) => {
        const startTime = Date.now();
        try {
            if (!request.apiKey?.id) {
                throw new AppError('AUTH_REQUIRED', 'API Key required', 401);
            }
            fastify.assertApiPermission(request, MAIL_LOG_ACTIONS.DOMAIN_MAIL_NEW);
            const input = getInputFromRequest(request, domainMailboxEmailSchema);
            const result = await domainMailboxPoolService.getLatestMessage(request.apiKey.id, input.email);
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_NEW, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
            return { success: true, data: result, email: input.email };
        } catch (err) {
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_NEW, request.apiKey?.id, undefined, request.ip, getErrorStatusCode(err), Date.now() - startTime, request.id);
            throw err;
        }
    });

    fastify.all('/mail_all', async (request) => {
        const startTime = Date.now();
        try {
            if (!request.apiKey?.id) {
                throw new AppError('AUTH_REQUIRED', 'API Key required', 401);
            }
            fastify.assertApiPermission(request, MAIL_LOG_ACTIONS.DOMAIN_MAIL_ALL);
            const input = getInputFromRequest(request, domainMailboxEmailSchema);
            const result = await domainMailboxPoolService.listMessages(request.apiKey.id, input);
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_ALL, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
            return { success: true, data: result, email: input.email };
        } catch (err) {
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_ALL, request.apiKey?.id, undefined, request.ip, getErrorStatusCode(err), Date.now() - startTime, request.id);
            throw err;
        }
    });

    fastify.all('/mail_text', async (request, reply) => {
        const startTime = Date.now();
        if (!request.apiKey?.id) {
            reply.code(401).type('text/plain').send('Error: API Key required');
            return;
        }

        try {
            fastify.assertApiPermission(request, MAIL_LOG_ACTIONS.DOMAIN_MAIL_TEXT);
            const input = getInputFromRequest(request, domainMailboxTextSchema);
            const result = await domainMailboxPoolService.getLatestMessage(request.apiKey.id, input.email);
            const latest = result.messages[0];
            if (!latest) {
                await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_TEXT, request.apiKey.id, undefined, request.ip, 404, Date.now() - startTime, request.id);
                reply.code(404).type('text/plain').send('Error: No messages found');
                return;
            }

            const content = latest.text || latest.html || '';
            if (input.match) {
                let regex: RegExp;
                try {
                    regex = new RegExp(input.match);
                } catch {
                    throw new AppError('INVALID_MATCH_REGEX', 'Invalid regular expression supplied in match', 400);
                }
                const match = content.match(regex);
                if (!match) {
                    await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_TEXT, request.apiKey.id, undefined, request.ip, 404, Date.now() - startTime, request.id);
                    reply.code(404).type('text/plain').send('Error: No match found');
                    return;
                }
                await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_TEXT, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
                reply.type('text/plain').send(match[0]);
                return;
            }

            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_TEXT, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
            reply.type('text/plain').send(content || '');
        } catch (err) {
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_MAIL_TEXT, request.apiKey?.id, undefined, request.ip, getErrorStatusCode(err), Date.now() - startTime, request.id);
            reply.code(getErrorStatusCode(err)).type('text/plain').send(`Error: ${getErrorMessage(err)}`);
        }
    });

    fastify.all('/list-mailboxes', async (request) => {
        const startTime = Date.now();
        try {
            if (!request.apiKey?.id) {
                throw new AppError('AUTH_REQUIRED', 'API Key required', 401);
            }
            fastify.assertApiPermission(request, MAIL_LOG_ACTIONS.DOMAIN_LIST_MAILBOXES);
            const input = getInputFromRequest(request, domainMailboxSelectorSchema);
            const result = await domainMailboxPoolService.listMailboxes(request.apiKey.id, input);
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_LIST_MAILBOXES, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
            return { success: true, data: result };
        } catch (err) {
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_LIST_MAILBOXES, request.apiKey?.id, undefined, request.ip, getErrorStatusCode(err), Date.now() - startTime, request.id);
            throw err;
        }
    });

    fastify.all('/pool-stats', async (request) => {
        const startTime = Date.now();
        try {
            if (!request.apiKey?.id) {
                throw new AppError('AUTH_REQUIRED', 'API Key required', 401);
            }
            fastify.assertApiPermission(request, MAIL_LOG_ACTIONS.DOMAIN_POOL_STATS);
            const input = getInputFromRequest(request, domainMailboxSelectorSchema);
            const result = await domainMailboxPoolService.getPoolStats(request.apiKey.id, input);
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_POOL_STATS, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
            return { success: true, data: result };
        } catch (err) {
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_POOL_STATS, request.apiKey?.id, undefined, request.ip, getErrorStatusCode(err), Date.now() - startTime, request.id);
            throw err;
        }
    });

    fastify.all('/reset-pool', async (request) => {
        const startTime = Date.now();
        try {
            if (!request.apiKey?.id) {
                throw new AppError('AUTH_REQUIRED', 'API Key required', 401);
            }
            fastify.assertApiPermission(request, MAIL_LOG_ACTIONS.DOMAIN_POOL_RESET);
            const input = getInputFromRequest(request, domainMailboxSelectorSchema);
            const result = await domainMailboxPoolService.resetPool(request.apiKey.id, input);
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_POOL_RESET, request.apiKey.id, undefined, request.ip, 200, Date.now() - startTime, request.id);
            return { success: true, data: result };
        } catch (err) {
            await mailService.logApiCall(MAIL_LOG_ACTIONS.DOMAIN_POOL_RESET, request.apiKey?.id, undefined, request.ip, getErrorStatusCode(err), Date.now() - startTime, request.id);
            throw err;
        }
    });
};

export default domainMailboxApiRoutes;
