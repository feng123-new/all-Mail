import type { FastifyInstance } from 'fastify';
import ingressRoutes from '../modules/ingress/ingress.routes.js';
import { ROUTE_PREFIXES } from './prefixes.js';

export async function registerIngressRoutes(fastify: FastifyInstance): Promise<void> {
    await fastify.register(ingressRoutes, { prefix: ROUTE_PREFIXES.ingressDomainMail });
}
