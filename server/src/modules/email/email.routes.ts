import type { FastifyPluginAsync } from 'fastify';
import { emailService } from './email.service.js';
import { mailService } from '../mail/mail.service.js';
import { batchClearMailboxSchema, batchFetchMailboxesSchema, createEmailSchema, deleteSelectedMailsSchema, updateEmailSchema, listEmailSchema, importEmailSchema } from './email.schema.js';
import { z } from 'zod';

const emailRoutes: FastifyPluginAsync = async (fastify) => {
    // 所有路由需要 JWT 认证
    fastify.addHook('preHandler', fastify.authenticateJwt);

    const loadMailContext = async (emailId: number) => {
        const emailData = await emailService.getById(emailId, true);
        const credentials = mailService.buildCredentialsFromRecord({
            ...emailData,
            fetchStrategy: emailData.group?.fetchStrategy,
        }, false);

        return { emailData, credentials };
    };

    // 列表
    fastify.get('/', async (request) => {
        const input = listEmailSchema.parse(request.query);
        const result = await emailService.list(input);
        return { success: true, data: result };
    });

    fastify.get('/stats', async () => {
        const result = await emailService.getStats();
        return { success: true, data: result };
    });

    // 详情
    fastify.get('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const { secrets } = request.query as { secrets?: string };
        const email = await emailService.getById(parseInt(id, 10), secrets === 'true');
        return { success: true, data: email };
    });

    // 创建
    fastify.post('/', async (request) => {
        const input = createEmailSchema.parse(request.body);
        const email = await emailService.create(input);
        return { success: true, data: email };
    });

    // 更新
    fastify.put('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const input = updateEmailSchema.parse(request.body);
        const email = await emailService.update(parseInt(id, 10), input);
        return { success: true, data: email };
    });

    // 删除
    fastify.delete('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        await emailService.delete(parseInt(id, 10));
        return { success: true, data: { message: 'Email account deleted' } };
    });

    // 批量删除
    fastify.post('/batch-delete', async (request) => {
        const { ids } = z.object({ ids: z.array(z.number()) }).parse(request.body);
        const result = await emailService.batchDelete(ids);
        return { success: true, data: result };
    });

    fastify.post('/batch-fetch-mails', async (request) => {
        const input = batchFetchMailboxesSchema.parse(request.body);
        const targets = await emailService.getBatchTargets(input);
        const results: Array<{
            id: number;
            email: string;
            status: 'success' | 'partial' | 'error' | 'skipped';
            mailboxResults: Array<{ mailbox: string; status: 'success' | 'error'; count?: number; message?: string }>;
            message?: string;
        }> = [];

        for (const target of targets) {
            if (target.status === 'DISABLED') {
                results.push({
                    id: target.id,
                    email: target.email,
                    status: 'skipped',
                    mailboxResults: [],
                    message: '邮箱已禁用，跳过收取',
                });
                continue;
            }

            const credentials = mailService.buildCredentialsFromRecord({
                ...target,
                fetchStrategy: target.group?.fetchStrategy,
            }, false);
            const mailboxResults: Array<{ mailbox: string; status: 'success' | 'error'; count?: number; message?: string }> = [];
            let successCount = 0;
            let lastErrorMessage: string | undefined;

            for (const mailbox of input.mailboxes) {
                try {
                    const mails = await mailService.getEmails(credentials, { mailbox });
                    await emailService.updateMailboxStatus(target.id, mailbox, mails.messages, { markAsSeen: false });
                    mailboxResults.push({
                        mailbox,
                        status: 'success',
                        count: mails.count,
                    });
                    successCount += 1;
                } catch (error) {
                    const errorMessage = error instanceof Error && error.message ? error.message : `收取 ${mailbox} 失败`;
                    mailboxResults.push({
                        mailbox,
                        status: 'error',
                        message: errorMessage,
                    });
                    lastErrorMessage = errorMessage;
                }
            }

            const finalStatus = successCount === input.mailboxes.length
                ? 'success'
                : successCount > 0
                    ? 'partial'
                    : 'error';

            await mailService.updateEmailStatus(target.id, finalStatus !== 'error', finalStatus === 'error' ? lastErrorMessage : undefined);

            results.push({
                id: target.id,
                email: target.email,
                status: finalStatus,
                mailboxResults,
                message: finalStatus === 'success'
                    ? '邮箱收取完成'
                    : finalStatus === 'partial'
                        ? '部分邮箱夹收取成功'
                        : lastErrorMessage,
            });
        }

        const successCount = results.filter((item) => item.status === 'success').length;
        const partialCount = results.filter((item) => item.status === 'partial').length;
        const errorCount = results.filter((item) => item.status === 'error').length;
        const skippedCount = results.filter((item) => item.status === 'skipped').length;

        return {
            success: true,
            data: {
                targeted: targets.length,
                successCount,
                partialCount,
                errorCount,
                skippedCount,
                results,
            },
        };
    });

    fastify.post('/batch-clear-mailbox', async (request) => {
        const input = batchClearMailboxSchema.parse(request.body);
        const targets = await emailService.getBatchTargets(input);
        const results: Array<{
            id: number;
            email: string;
            status: 'success' | 'error' | 'skipped';
            deletedCount: number;
            message: string;
        }> = [];
        let deletedCount = 0;

        for (const target of targets) {
            if (target.status === 'DISABLED') {
                results.push({
                    id: target.id,
                    email: target.email,
                    status: 'skipped',
                    deletedCount: 0,
                    message: '邮箱已禁用，跳过删除',
                });
                continue;
            }

            if (target.provider === 'QQ' || target.authType === 'APP_PASSWORD') {
                results.push({
                    id: target.id,
                    email: target.email,
                    status: 'skipped',
                    deletedCount: 0,
                    message: '当前 Provider / 鉴权模式不支持批量清空邮箱',
                });
                continue;
            }

            const credentials = mailService.buildCredentialsFromRecord({
                ...target,
                fetchStrategy: target.group?.fetchStrategy,
            }, false);

            try {
                const result = await mailService.processMailbox(credentials, { mailbox: input.mailbox });
                await emailService.clearMailboxStatus(target.id, input.mailbox);
                await mailService.updateEmailStatus(target.id, true);
                deletedCount += result.deletedCount;
                results.push({
                    id: target.id,
                    email: target.email,
                    status: 'success',
                    deletedCount: result.deletedCount,
                    message: result.message,
                });
            } catch (error) {
                const errorMessage = error instanceof Error && error.message ? error.message : '批量清空邮箱失败';
                await mailService.updateEmailStatus(target.id, false, errorMessage);
                results.push({
                    id: target.id,
                    email: target.email,
                    status: 'error',
                    deletedCount: 0,
                    message: errorMessage,
                });
            }
        }

        return {
            success: true,
            data: {
                targeted: targets.length,
                deletedCount,
                successCount: results.filter((item) => item.status === 'success').length,
                errorCount: results.filter((item) => item.status === 'error').length,
                skippedCount: results.filter((item) => item.status === 'skipped').length,
                results,
            },
        };
    });

    // 批量导入
    fastify.post('/import', async (request) => {
        const input = importEmailSchema.parse(request.body);
        const result = await emailService.import(input);
        return { success: true, data: result };
    });

    // 导出
    fastify.get('/export', async (request) => {
        const query = z.object({
            ids: z.string().optional(),
            separator: z.string().optional(),
            groupId: z.coerce.number().int().positive().optional(),
        }).parse(request.query);

        const idArray = query.ids?.split(',').map(Number).filter((id: number) => Number.isFinite(id) && id > 0);
        const content = await emailService.export(idArray, query.separator, query.groupId);
        return { success: true, data: { content } };
    });

    // 查看邮件 (管理员专用)
    fastify.get('/:id(^\\d+$)/mails', async (request) => {
        const { id } = request.params as { id: string };
        const { mailbox, markAsSeen } = z.object({
            mailbox: z.enum(['INBOX', 'SENT', 'Junk']).default('INBOX'),
            markAsSeen: z.coerce.boolean().default(false),
        }).parse(request.query);
        const emailId = parseInt(id, 10);

        const { credentials } = await loadMailContext(emailId);

        try {
            const mails = await mailService.getEmails(credentials, { mailbox });
            if (mails.resolvedMailbox && mails.resolvedMailbox !== mailbox) {
                await emailService.updateResolvedMailboxFolder(emailId, mailbox, mails.resolvedMailbox);
            }
            await emailService.updateMailboxStatus(emailId, mailbox, mails.messages, { markAsSeen });
            await mailService.updateEmailStatus(emailId, true);
            return { success: true, data: mails };
        } catch (error) {
            const errorMessage = error instanceof Error && error.message ? error.message : '获取邮件失败';
            await mailService.updateEmailStatus(emailId, false, errorMessage);
            throw error;
        }
    });

    fastify.post('/:id(^\\d+$)/mails/delete', async (request) => {
        const { id } = request.params as { id: string };
        const input = deleteSelectedMailsSchema.parse(request.body);
        const emailId = parseInt(id, 10);
        const { credentials } = await loadMailContext(emailId);

        try {
            const result = await mailService.deleteMessages(credentials, {
                mailbox: input.mailbox,
                messageIds: input.messageIds,
            });
            if (result.resolvedMailbox && result.resolvedMailbox !== input.mailbox) {
                await emailService.updateResolvedMailboxFolder(emailId, input.mailbox, result.resolvedMailbox);
            }
            const remainingMails = await mailService.getEmails(credentials, { mailbox: input.mailbox });
            if (remainingMails.resolvedMailbox && remainingMails.resolvedMailbox !== input.mailbox) {
                await emailService.updateResolvedMailboxFolder(emailId, input.mailbox, remainingMails.resolvedMailbox);
            }
            await emailService.updateMailboxStatus(emailId, input.mailbox, remainingMails.messages, { markAsSeen: true });
            await mailService.updateEmailStatus(emailId, true);
            return {
                success: true,
                data: {
                    ...result,
                    messages: remainingMails.messages,
                    remainingCount: remainingMails.count,
                },
            };
        } catch (error) {
            const errorMessage = error instanceof Error && error.message ? error.message : '删除选中邮件失败';
            await mailService.updateEmailStatus(emailId, false, errorMessage);
            throw error;
        }
    });

    fastify.post('/:id(^\\d+$)/send', async (request) => {
        const { id } = request.params as { id: string };
        const input = z.object({
            fromName: z.string().trim().max(255).optional(),
            to: z.array(z.string().trim().email()).min(1),
            subject: z.string().trim().min(1).max(500),
            text: z.string().trim().optional(),
            html: z.string().trim().optional(),
            socks5: z.string().optional(),
            http: z.string().optional(),
        }).parse(request.body);

        const emailId = parseInt(id, 10);
        const { credentials } = await loadMailContext(emailId);

        const result = await mailService.sendEmail(credentials, {
            fromEmail: credentials.email,
            fromName: input.fromName,
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
            socks5: input.socks5,
            http: input.http,
        });

        await mailService.updateEmailStatus(emailId, true);
        return { success: true, data: result };
    });

    // 清空邮箱 (管理员专用)
    fastify.post('/:id(^\\d+$)/clear', async (request) => {
        const { id } = request.params as { id: string };
        const { mailbox } = z.object({
            mailbox: z.enum(['INBOX', 'Junk']).default('INBOX'),
        }).parse(request.body);
        const emailId = parseInt(id, 10);

        const { credentials } = await loadMailContext(emailId);

        try {
            const result = await mailService.processMailbox(credentials, { mailbox });
            await emailService.clearMailboxStatus(emailId, mailbox);
            await mailService.updateEmailStatus(emailId, true);
            return { success: true, data: result };
        } catch (error) {
            const errorMessage = error instanceof Error && error.message ? error.message : '清空邮箱失败';
            await mailService.updateEmailStatus(emailId, false, errorMessage);
            throw error;
        }
    });
};

export default emailRoutes;
