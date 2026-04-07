export const ROUTE_PREFIXES = {
    admin: '/admin',
    adminAuth: '/admin/auth',
    adminAdmins: '/admin/admins',
    adminApiKeys: '/admin/api-keys',
    adminEmails: '/admin/emails',
    adminOauth: '/admin/oauth',
    adminEmailGroups: '/admin/email-groups',
    adminDashboard: '/admin/dashboard',
    adminDomains: '/admin/domains',
    adminDomainMailboxes: '/admin/domain-mailboxes',
    adminDomainMessages: '/admin/domain-messages',
    adminForwardingJobs: '/admin/forwarding-jobs',
    adminMailboxUsers: '/admin/mailbox-users',
    adminSend: '/admin/send',
    externalApi: '/api',
    externalDomainMailApi: '/api/domain-mail',
    mailboxPortalApi: '/mail/api',
    ingressNamespace: '/ingress',
    ingressDomainMail: '/ingress/domain-mail',
    legacyOauth: '/oauth',
} as const;

export const BACKEND_NAMESPACE_PREFIXES: readonly string[] = [
    ROUTE_PREFIXES.externalApi,
    ROUTE_PREFIXES.admin,
    ROUTE_PREFIXES.mailboxPortalApi,
    ROUTE_PREFIXES.ingressNamespace,
] as const;

export const ADMIN_PASSWORD_CHANGE_ALLOWED_PATHS: readonly string[] = [
    `${ROUTE_PREFIXES.adminAuth}/me`,
    `${ROUTE_PREFIXES.adminAuth}/change-password`,
] as const;

export const MAILBOX_PASSWORD_CHANGE_ALLOWED_PATHS: readonly string[] = [
    `${ROUTE_PREFIXES.mailboxPortalApi}/session`,
    `${ROUTE_PREFIXES.mailboxPortalApi}/change-password`,
] as const;
