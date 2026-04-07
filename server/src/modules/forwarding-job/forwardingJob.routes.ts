import type { FastifyPluginAsync } from 'fastify';
import { forwardingJobDetailSchema, listForwardingJobSchema, requeueForwardingJobSchema } from './forwardingJob.schema.js';
import { forwardingJobService } from './forwardingJob.service.js';

const forwardingJobRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticateJwt);

    fastify.get('/', async (request) => {
        const input = listForwardingJobSchema.parse(request.query);
        const result = await forwardingJobService.list(input);
        return { success: true, data: result };
    });

    fastify.get('/:id', async (request) => {
        const { id } = forwardingJobDetailSchema.parse(request.params);
        const result = await forwardingJobService.getById(id);
        return { success: true, data: result };
    });

    fastify.post('/:id/requeue', async (request) => {
        const { id } = requeueForwardingJobSchema.parse(request.params);
        const result = await forwardingJobService.requeue(id);
        return { success: true, data: result };
    });
};

export default forwardingJobRoutes;
