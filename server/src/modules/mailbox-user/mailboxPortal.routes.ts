import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
    mailboxPortalChangePasswordSchema,
    mailboxPortalListForwardingJobsSchema,
    mailboxPortalLoginSchema,
    mailboxPortalListSentMessagesSchema,
    mailboxPortalSendMessageSchema,
    mailboxPortalUpdateForwardingSchema,
} from './mailboxUser.schema.js';
import { mailboxUserService } from './mailboxUser.service.js';
import { messageService } from '../message/message.service.js';
import { sendService } from '../send/send.service.js';
import { AppError } from '../../plugins/error.js';

const isSecureCookie = process.env.NODE_ENV === 'production';
const mailboxSessionCookieOptions = {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7200,
};

const mailboxClearCookieOptions = {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: 'lax' as const,
    path: '/',
};

function getMailboxAuthContext(request: FastifyRequest) {
    const mailboxUser = request.mailboxUser;
    if (!mailboxUser) {
        throw new AppError('UNAUTHORIZED', 'Mailbox session is required', 401);
    }
    return mailboxUser;
}

const mailboxPortalRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/login', async (request, reply) => {
        const input = mailboxPortalLoginSchema.parse(request.body);
        const result = await mailboxUserService.login(input, request.ip);
        reply.cookie('mailbox_token', result.token, mailboxSessionCookieOptions);
        return { success: true, data: { mailboxUser: result.mailboxUser } };
    });

    fastify.post('/logout', async (_request, reply) => {
        reply.clearCookie('mailbox_token', mailboxClearCookieOptions);
        return { success: true, data: { code: 'MAILBOX_PORTAL_LOGGED_OUT' } };
    });

    fastify.get('/session', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const result = await mailboxUserService.getSession(mailboxUser.id);
        return { success: true, data: result };
    });

    fastify.get('/mailboxes', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const mailboxes = await mailboxUserService.getAccessibleMailboxes(mailboxUser.id);
        return {
            success: true,
            data: mailboxes,
        };
    });

    fastify.get('/messages', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const input = z.object({
            mailboxId: z.coerce.number().int().positive().optional(),
            page: z.coerce.number().int().min(1).default(1),
            pageSize: z.coerce.number().int().min(1).max(100).default(20),
            unreadOnly: z.coerce.boolean().default(false),
        }).parse(request.query);

        const mailboxIds = mailboxUser.mailboxIds || [];
        if (input.mailboxId && !mailboxIds.includes(input.mailboxId)) {
            throw new AppError('FORBIDDEN_MAILBOX', 'You do not have access to this mailbox', 403);
        }

        const result = await messageService.list({
            page: input.page,
            pageSize: input.pageSize,
            mailboxId: input.mailboxId,
            unreadOnly: input.unreadOnly,
            allowedMailboxIds: mailboxIds,
        }, {
            portalVisibleOnly: true,
        });

        return {
            success: true,
            data: result,
        };
    });

    fastify.get('/messages/:id', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const { id } = request.params as { id: string };
        const result = await messageService.getById(id, { portalVisibleOnly: true });
        const mailboxIds = mailboxUser.mailboxIds || [];
        if (result.mailbox?.id && !mailboxIds.includes(result.mailbox.id)) {
            throw new AppError('FORBIDDEN_MAILBOX', 'You do not have access to this mailbox', 403);
        }
        await messageService.markRead(id, mailboxIds);
        return { success: true, data: { ...result, isRead: true } };
    });

    fastify.get('/sent-messages', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const input = mailboxPortalListSentMessagesSchema.parse(request.query);
        const mailboxIds = mailboxUser.mailboxIds || [];
        if (!mailboxIds.includes(input.mailboxId)) {
            throw new AppError('FORBIDDEN_MAILBOX', 'You do not have access to this mailbox', 403);
        }

        const result = await sendService.listMessages({
            page: input.page,
            pageSize: input.pageSize,
            mailboxId: input.mailboxId,
        });

        return {
            success: true,
            data: result,
        };
    });

    fastify.get('/forwarding-jobs', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const input = mailboxPortalListForwardingJobsSchema.parse(request.query);
        const mailboxIds = mailboxUser.mailboxIds || [];
        if (input.mailboxId && !mailboxIds.includes(input.mailboxId)) {
            throw new AppError('FORBIDDEN_MAILBOX', 'You do not have access to this mailbox', 403);
        }

        const result = await mailboxUserService.listForwardingJobs(mailboxUser.id, input);
        return {
            success: true,
            data: result,
        };
    });

    fastify.get('/sent-messages/:id', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const { id } = request.params as { id: string };
        const result = await sendService.getMessageById(id);
        const mailboxIds = mailboxUser.mailboxIds || [];
        if (result.mailbox?.id && !mailboxIds.includes(result.mailbox.id)) {
            throw new AppError('FORBIDDEN_MAILBOX', 'You do not have access to this mailbox', 403);
        }
        return { success: true, data: result };
    });

    fastify.post('/send', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const input = mailboxPortalSendMessageSchema.parse(request.body);
        const mailboxes = await mailboxUserService.getAccessibleMailboxes(mailboxUser.id);
        const mailbox = mailboxes.find((item) => item.id === input.mailboxId);
        if (!mailbox) {
            throw new AppError('FORBIDDEN_MAILBOX', 'You do not have access to this mailbox', 403);
        }
        if (!mailbox.domain?.canSend) {
            throw new AppError('DOMAIN_SEND_DISABLED', 'This mailbox belongs to a receive-only domain and cannot send mail', 400);
        }

        const result = await sendService.send({
            domainId: mailbox.domainId,
            mailboxId: mailbox.id,
            from: mailbox.address,
            to: input.to,
            subject: input.subject,
            html: input.html,
            text: input.text,
        });

        return { success: true, data: result };
    });

    fastify.post('/change-password', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const input = mailboxPortalChangePasswordSchema.parse(request.body);
        const result = await mailboxUserService.changePassword(mailboxUser.id, input);
        return { success: true, data: result };
    });

    fastify.post('/forwarding', {
        preHandler: [fastify.authenticateMailboxJwt],
    }, async (request) => {
        const mailboxUser = getMailboxAuthContext(request);
        const input = mailboxPortalUpdateForwardingSchema.parse(request.body);
        const result = await mailboxUserService.updateForwarding(mailboxUser.id, input);
        return { success: true, data: result };
    });
};

export default mailboxPortalRoutes;
