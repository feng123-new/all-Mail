export const MAIL_LOG_ACTIONS = {
    GET_EMAIL: 'get_email',
    MAIL_NEW: 'mail_new',
    MAIL_TEXT: 'mail_text',
    MAIL_ALL: 'mail_all',
    PROCESS_MAILBOX: 'process_mailbox',
    LIST_EMAILS: 'list_emails',
    POOL_STATS: 'pool_stats',
    POOL_RESET: 'pool_reset',
    DOMAIN_GET_MAILBOX: 'domain_get_mailbox',
    DOMAIN_MAIL_NEW: 'domain_mail_new',
    DOMAIN_MAIL_TEXT: 'domain_mail_text',
    DOMAIN_MAIL_ALL: 'domain_mail_all',
    DOMAIN_LIST_MAILBOXES: 'domain_list_mailboxes',
    DOMAIN_POOL_STATS: 'domain_pool_stats',
    DOMAIN_POOL_RESET: 'domain_pool_reset',
} as const;

export type MailLogAction = typeof MAIL_LOG_ACTIONS[keyof typeof MAIL_LOG_ACTIONS];
