import { type FastifyPluginAsync, type FastifyRequest } from 'fastify';
import { apiKeyService } from './apiKey.service.js';
import { poolService } from '../mail/pool.service.js';
import { createApiKeySchema, updateApiKeySchema, listApiKeySchema } from './apiKey.schema.js';
import { z } from 'zod';

const apiKeyRoutes: FastifyPluginAsync = async (fastify) => {
    // 所有路由需要 JWT 认证
    fastify.addHook('preHandler', fastify.authenticateJwt);

    const allocationStatsPaths = ['/:id/allocation-stats', '/:id/usage'];
    const allocationResetPaths = ['/:id/allocation-reset', '/:id/reset-pool'];
    const assignedMailboxPaths = ['/:id/assigned-mailboxes', '/:id/pool-emails'];

    // 列表
    fastify.get('/', async (request) => {
        const input = listApiKeySchema.parse(request.query);
        const result = await apiKeyService.list(input);
        return { success: true, data: result };
    });

    // 创建
    fastify.post('/', async (request) => {
        const input = createApiKeySchema.parse(request.body);
        const apiKey = await apiKeyService.create(input, request.user!.id);
        return { success: true, data: apiKey };
    });

    // 详情
    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const apiKey = await apiKeyService.getById(parseInt(id));
        return { success: true, data: apiKey };
    });

    // 使用统计（调用次数）
    const getAllocationStats = async (request: FastifyRequest) => {
        const { id } = request.params as { id: string };
        const { group } = request.query as { group?: string };
        const poolStats = await poolService.getStats(parseInt(id), group);
        return { success: true, data: poolStats };
    };
    for (const path of allocationStatsPaths) {
        fastify.get(path, getAllocationStats);
    }

    const resetAllocation = async (request: FastifyRequest) => {
        const { id } = request.params as { id: string };
        const { group } = request.body as { group?: string };
        await poolService.reset(parseInt(id), group);
        return { success: true, data: { message: '分配记录已重置' } };
    };
    for (const path of allocationResetPaths) {
        fastify.post(path, resetAllocation);
    }

    // 更新
    fastify.put('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const input = updateApiKeySchema.parse(request.body);
        const apiKey = await apiKeyService.update(parseInt(id), input);
        return { success: true, data: apiKey };
    });

    // 删除
    fastify.delete('/:id', async (request) => {
        const { id } = request.params as { id: string };
        await apiKeyService.delete(parseInt(id));
        return { success: true, data: { message: 'API Key deleted' } };
    });

    const getAssignedMailboxes = async (request: FastifyRequest) => {
        const { id } = request.params as { id: string };
        const { groupId } = request.query as { groupId?: string };
        const emails = await poolService.getEmailsWithUsage(parseInt(id), groupId ? parseInt(groupId) : undefined);
        return { success: true, data: emails };
    };
    for (const path of assignedMailboxPaths) {
        fastify.get(path, getAssignedMailboxes);
    }

    const updateAssignedMailboxes = async (request: FastifyRequest) => {
        const { id } = request.params as { id: string };
        const input = z.object({
            emailIds: z.array(z.number().int().positive()).default([]),
            groupId: z.number().int().positive().optional(),
        }).parse(request.body);
        const result = await poolService.updateEmailUsage(parseInt(id), input.emailIds, input.groupId);
        return { success: true, data: result };
    };
    for (const path of assignedMailboxPaths) {
        fastify.put(path, updateAssignedMailboxes);
    }
};

export default apiKeyRoutes;
