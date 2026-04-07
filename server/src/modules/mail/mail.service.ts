import type { Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import { emailService } from '../email/email.service.js';
import { mailFacade } from './mail.facade.js';
import { poolService } from './pool.service.js';
import type { MailRequestInput } from './mail.schema.js';
import type { MailboxCheckpoint, MailCredentials } from './providers/types.js';

export const mailService = {
    async resolveCredentials(input: MailRequestInput, apiKeyId?: number): Promise<MailCredentials> {
        const { email, auto } = input;
        if (!email && auto) {
            if (!apiKeyId) {
                throw new AppError('AUTH_REQUIRED', 'Auto assignment requires API Key authentication', 400);
            }
            const account = await poolService.getUnusedEmail(apiKeyId);
            if (!account) {
                const stats = await poolService.getStats(apiKeyId);
                throw new AppError('NO_UNUSED_EMAIL', `No unused emails available. Used: ${stats.used}/${stats.total}`, 400);
            }
            return { ...account, autoAssigned: true };
        }
        if (!email) {
            throw new AppError('EMAIL_REQUIRED', 'Email is required. Set auto=true to auto-assign.', 400);
        }
        const account = await emailService.getByEmail(email);
        if (!account) {
            throw new AppError('EMAIL_NOT_FOUND', 'Email account not found', 404);
        }
        return emailService.toMailCredentials(account, false);
    },

    buildCredentialsFromRecord(account: Parameters<typeof emailService.toMailCredentials>[0], autoAssigned = false) {
        return emailService.toMailCredentials(account, autoAssigned);
    },

    async updateEmailStatus(emailId: number, success: boolean, errorMessage?: string) {
        await emailService.updateStatus(emailId, success ? 'ACTIVE' : 'ERROR', errorMessage);
    },

    async logApiCall(action: string, apiKeyId: number | undefined, emailAccountId: number | undefined, requestIp: string, responseCode: number, responseTimeMs: number, requestId?: string) {
        try {
            await prisma.apiLog.create({
                data: {
                    action,
                    apiKeyId,
                    emailAccountId,
                    requestIp,
                    responseCode,
                    responseTimeMs,
                    metadata: requestId ? { requestId } : undefined,
                },
            });
        } catch (error) {
            logger.error({ error }, 'Failed to log API call');
        }
    },

    async logAdminAction(
        action: string,
        emailAccountId: number | undefined,
        requestIp: string,
        responseCode: number,
        responseTimeMs: number,
        metadata?: Prisma.InputJsonValue,
    ) {
        try {
            await prisma.apiLog.create({
                data: {
                    action,
                    emailAccountId,
                    requestIp,
                    responseCode,
                    responseTimeMs,
                    metadata,
                },
            });
        } catch (error) {
            logger.error({ error }, 'Failed to log admin action');
        }
    },

    async getEmails(credentials: MailCredentials, options: { mailbox: string; limit?: number; mailboxCheckpoint?: MailboxCheckpoint | null; socks5?: string; http?: string }) {
        return mailFacade.getEmails(credentials, options);
    },

    async processMailbox(credentials: MailCredentials, options: { mailbox: string; socks5?: string; http?: string }) {
        return mailFacade.processMailbox(credentials, options);
    },

    async deleteMessages(credentials: MailCredentials, options: { mailbox: string; messageIds: string[]; mailboxCheckpoint?: MailboxCheckpoint | null; socks5?: string; http?: string }) {
        return mailFacade.deleteMessages(credentials, options);
    },

    async sendEmail(credentials: MailCredentials, options: { fromEmail: string; fromName?: string; to: string[]; subject: string; text?: string; html?: string; socks5?: string; http?: string }) {
        return mailFacade.sendEmail(credentials, options);
    },
};
