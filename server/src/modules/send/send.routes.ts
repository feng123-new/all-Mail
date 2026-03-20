import { type FastifyPluginAsync } from 'fastify';
import { deleteOutboundMessageSchema, listOutboundMessageSchema, listSendConfigSchema, sendMessageSchema } from './send.schema.js';
import { sendService } from './send.service.js';

const sendRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticateJwt);

    fastify.get('/configs', async (request) => {
        const input = listSendConfigSchema.parse(request.query);
        const result = await sendService.listConfigs(input);
        return { success: true, data: result };
    });

    fastify.get('/messages', async (request) => {
        const input = listOutboundMessageSchema.parse(request.query);
        const result = await sendService.listMessages(input);
        return { success: true, data: result };
    });

    fastify.delete('/configs/:id(^\\d+$)', async (request) => {
        const { id } = request.params as { id: string };
        const result = await sendService.deleteConfig(Number.parseInt(id, 10));
        return { success: true, data: result };
    });

    fastify.delete('/messages/:id', async (request) => {
        const { id } = request.params as { id: string };
        const result = await sendService.deleteMessages({ ids: [id] });
        return { success: true, data: result };
    });

    fastify.post('/messages/batch-delete', async (request) => {
        const input = deleteOutboundMessageSchema.parse(request.body);
        const result = await sendService.deleteMessages(input);
        return { success: true, data: result };
    });

    fastify.post('/messages', async (request) => {
        const input = sendMessageSchema.parse(request.body);
        const result = await sendService.send(input);
        return { success: true, data: result };
    });
};

export default sendRoutes;
