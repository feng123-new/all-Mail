import { type FastifyPluginAsync } from 'fastify';
import { deleteDomainMessageSchema, listDomainMessageSchema } from './message.schema.js';
import { messageService } from './message.service.js';

const messageRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticateJwt);

    fastify.get('/', async (request) => {
        const input = listDomainMessageSchema.parse(request.query);
        const result = await messageService.list(input);
        return { success: true, data: result };
    });

    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const result = await messageService.getById(id);
        return { success: true, data: result };
    });

    fastify.delete('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const result = await messageService.deleteByIds({ ids: [id] });
        return { success: true, data: result };
    });

    fastify.post('/batch-delete', async (request) => {
        const input = deleteDomainMessageSchema.parse(request.body);
        const result = await messageService.deleteByIds(input);
        return { success: true, data: result };
    });
};

export default messageRoutes;
