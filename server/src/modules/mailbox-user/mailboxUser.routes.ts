import { type FastifyPluginAsync } from 'fastify';
import {
    addMailboxMembershipsSchema,
    createMailboxUserSchema,
    listMailboxUserSchema,
    updateMailboxUserSchema,
} from './mailboxUser.schema.js';
import { mailboxUserService } from './mailboxUser.service.js';

const mailboxUserRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticateJwt);

    fastify.get('/', async (request) => {
        const input = listMailboxUserSchema.parse(request.query);
        const result = await mailboxUserService.list(input);
        return { success: true, data: result };
    });

    fastify.get('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const result = await mailboxUserService.getById(Number.parseInt(id, 10));
        return { success: true, data: result };
    });

    fastify.post('/', async (request) => {
        const input = createMailboxUserSchema.parse(request.body);
        const result = await mailboxUserService.create(input);
        return { success: true, data: result };
    });

    fastify.patch('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const input = updateMailboxUserSchema.parse(request.body);
        const result = await mailboxUserService.update(Number.parseInt(id, 10), input);
        return { success: true, data: result };
    });

    fastify.post('/:id(^\\d+$)/mailboxes/batch-add', async (request) => {
        const { id } = request.params as { id: string };
        const input = addMailboxMembershipsSchema.parse(request.body);
        const result = await mailboxUserService.addMailboxes(Number.parseInt(id, 10), input);
        return { success: true, data: result };
    });

    fastify.delete('/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const result = await mailboxUserService.delete(Number.parseInt(id, 10));
        return { success: true, data: result };
    });
};

export default mailboxUserRoutes;
