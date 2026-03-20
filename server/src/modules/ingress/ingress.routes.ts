import { type FastifyPluginAsync } from 'fastify';
import { ingressReceiveSchema } from './ingress.schema.js';
import { ingressService } from './ingress.service.js';

const ingressRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/receive', {
        preHandler: [fastify.authenticateIngressSignature],
    }, async (request) => {
        const input = ingressReceiveSchema.parse(request.body);
        const result = await ingressService.receive(input, request.ingressEndpoint!);
        return { success: true, data: result };
    });
};

export default ingressRoutes;
