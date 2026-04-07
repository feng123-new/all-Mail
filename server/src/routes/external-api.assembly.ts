import type { FastifyInstance } from 'fastify';
import domainMailboxApiRoutes from '../modules/domain-mailbox/domainMailbox.api.routes.js';
import mailRoutes from '../modules/mail/mail.routes.js';
import { ROUTE_PREFIXES } from './prefixes.js';

export async function registerExternalApiRoutes(fastify: FastifyInstance): Promise<void> {
    await fastify.register(mailRoutes, { prefix: ROUTE_PREFIXES.externalApi });
    await fastify.register(domainMailboxApiRoutes, { prefix: ROUTE_PREFIXES.externalDomainMailApi });
}
