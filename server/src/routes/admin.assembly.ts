import type { FastifyInstance } from 'fastify';
import adminRoutes from '../modules/admin/admin.routes.js';
import apiKeyRoutes from '../modules/api-key/apiKey.routes.js';
import authRoutes from '../modules/auth/auth.routes.js';
import dashboardRoutes from '../modules/dashboard/dashboard.routes.js';
import domainRoutes from '../modules/domain/domain.routes.js';
import domainMailboxRoutes from '../modules/domain-mailbox/domainMailbox.routes.js';
import emailOAuthRoutes from '../modules/email/email.oauth.routes.js';
import emailRoutes from '../modules/email/email.routes.js';
import groupRoutes from '../modules/email/group.routes.js';
import forwardingJobRoutes from '../modules/forwarding-job/forwardingJob.routes.js';
import mailboxUserRoutes from '../modules/mailbox-user/mailboxUser.routes.js';
import messageRoutes from '../modules/message/message.routes.js';
import sendRoutes from '../modules/send/send.routes.js';
import { ROUTE_PREFIXES } from './prefixes.js';

export async function registerAdminRoutes(fastify: FastifyInstance): Promise<void> {
    await fastify.register(authRoutes, { prefix: ROUTE_PREFIXES.adminAuth });
    await fastify.register(adminRoutes, { prefix: ROUTE_PREFIXES.adminAdmins });
    await fastify.register(apiKeyRoutes, { prefix: ROUTE_PREFIXES.adminApiKeys });
    await fastify.register(emailRoutes, { prefix: ROUTE_PREFIXES.adminEmails });
    await fastify.register(emailOAuthRoutes, { prefix: ROUTE_PREFIXES.adminOauth });
    await fastify.register(groupRoutes, { prefix: ROUTE_PREFIXES.adminEmailGroups });
    await fastify.register(dashboardRoutes, { prefix: ROUTE_PREFIXES.adminDashboard });
    await fastify.register(domainRoutes, { prefix: ROUTE_PREFIXES.adminDomains });
    await fastify.register(domainMailboxRoutes, { prefix: ROUTE_PREFIXES.adminDomainMailboxes });
    await fastify.register(messageRoutes, { prefix: ROUTE_PREFIXES.adminDomainMessages });
    await fastify.register(forwardingJobRoutes, { prefix: ROUTE_PREFIXES.adminForwardingJobs });
    await fastify.register(mailboxUserRoutes, { prefix: ROUTE_PREFIXES.adminMailboxUsers });
    await fastify.register(sendRoutes, { prefix: ROUTE_PREFIXES.adminSend });
}
