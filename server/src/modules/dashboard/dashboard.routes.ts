import { type FastifyPluginAsync } from 'fastify';
import { dashboardService } from './dashboard.service.js';
import { z } from 'zod';

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
    // 所有路由需要 JWT 认证
    fastify.addHook('preHandler', fastify.authenticateJwt);

    // 统计数据
    fastify.get('/stats', async () => {
        const stats = await dashboardService.getStats();
        return { success: true, data: stats };
    });

    // API 调用趋势
    fastify.get('/api-trend', async (request) => {
        const { days } = z.object({ days: z.coerce.number().default(7) }).parse(request.query);
        const trend = await dashboardService.getApiTrend(days);
        return { success: true, data: trend };
    });

    // 操作日志
    fastify.get('/logs', async (request) => {
        const input = z.object({
            page: z.coerce.number().default(1),
            pageSize: z.coerce.number().default(20),
            action: z.string().optional(),
        }).parse(request.query);

        const logs = await dashboardService.getLogs(input);
        return { success: true, data: logs };
    });

    fastify.delete('/logs/:id(^\\d+$)', async (request) => {
        const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
        const result = await dashboardService.deleteLog(id);
        return { success: true, data: result };
    });

    fastify.post('/logs/batch-delete', async (request) => {
        const { ids } = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1) }).parse(request.body);
        const result = await dashboardService.batchDeleteLogs(ids);
        return { success: true, data: result };
    });
};

export default dashboardRoutes;
