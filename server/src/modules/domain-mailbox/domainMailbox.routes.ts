import type { FastifyPluginAsync } from 'fastify';
import {
    batchCreateDomainMailboxSchema,
    batchDeleteDomainMailboxSchema,
    createDomainMailboxSchema,
    listDomainMailboxSchema,
    updateDomainMailboxSchema,
} from './domainMailbox.schema.js';
import { domainMailboxService } from './domainMailbox.service.js';

const domainMailboxRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticateJwt);

    fastify.get('/', async (request) => {
        const input = listDomainMailboxSchema.parse(request.query);
        const result = await domainMailboxService.list(input);
        return { success: true, data: result };
    });

    fastify.get('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const result = await domainMailboxService.getById(Number.parseInt(id, 10));
        return { success: true, data: result };
    });

    fastify.post('/', async (request) => {
        const input = createDomainMailboxSchema.parse(request.body);
        const result = await domainMailboxService.create(input);
        return { success: true, data: result };
    });

    fastify.post('/batch-create', async (request) => {
        const input = batchCreateDomainMailboxSchema.parse(request.body);
        const result = await domainMailboxService.batchCreate(input);
        return { success: true, data: result };
    });

    fastify.post('/batch-delete', async (request) => {
        const input = batchDeleteDomainMailboxSchema.parse(request.body);
        const result = await domainMailboxService.batchDelete(input);
        return { success: true, data: result };
    });

    fastify.patch('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const input = updateDomainMailboxSchema.parse(request.body);
        const result = await domainMailboxService.update(Number.parseInt(id, 10), input);
        return { success: true, data: result };
    });

    fastify.delete('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const result = await domainMailboxService.delete(Number.parseInt(id, 10));
        return { success: true, data: result };
    });
};

export default domainMailboxRoutes;
