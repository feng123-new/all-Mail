import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../plugins/error.js';
import { ingressReceiveSchema } from './ingress.schema.js';
import { ingressService } from './ingress.service.js';

const ingressRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.decorateRequest('ingressRawBody', '');

    const parseJson = fastify.getDefaultJsonParser('error', 'error');
    fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
        const rawBody = typeof body === 'string' ? body : body.toString('utf8');
        request.ingressRawBody = rawBody;
        void parseJson(request, rawBody, done);
    });

    fastify.post('/receive', {
        preHandler: [fastify.authenticateIngressSignature],
    }, async (request) => {
        const input = ingressReceiveSchema.parse(request.body);
        const endpoint = request.ingressEndpoint;
        if (!endpoint) {
            throw new AppError('INGRESS_ENDPOINT_MISSING', 'Ingress authentication context is missing', 401);
        }

        const result = await ingressService.receive(input, endpoint);
        return { success: true, data: result };
    });
};

export default ingressRoutes;
