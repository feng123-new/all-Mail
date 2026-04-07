import type { FastifyInstance } from 'fastify';
import mailboxPortalRoutes from '../modules/mailbox-user/mailboxPortal.routes.js';
import { ROUTE_PREFIXES } from './prefixes.js';

export async function registerPortalRoutes(fastify: FastifyInstance): Promise<void> {
    await fastify.register(mailboxPortalRoutes, { prefix: ROUTE_PREFIXES.mailboxPortalApi });
}
