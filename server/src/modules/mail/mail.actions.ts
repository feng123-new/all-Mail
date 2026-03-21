export const MAIL_LOG_ACTIONS = {
    GET_EMAIL: 'external_allocate_mailbox',
    MAIL_NEW: 'external_read_latest_message',
    MAIL_TEXT: 'external_read_message_text',
    MAIL_ALL: 'external_list_messages',
    PROCESS_MAILBOX: 'external_clear_mailbox',
    LIST_EMAILS: 'external_list_mailboxes',
    POOL_STATS: 'external_mailbox_allocation_stats',
    POOL_RESET: 'external_mailbox_allocation_reset',
    DOMAIN_GET_MAILBOX: 'domain_allocate_mailbox',
    DOMAIN_MAIL_NEW: 'domain_read_latest_message',
    DOMAIN_MAIL_TEXT: 'domain_read_message_text',
    DOMAIN_MAIL_ALL: 'domain_list_messages',
    DOMAIN_LIST_MAILBOXES: 'domain_list_mailboxes',
    DOMAIN_POOL_STATS: 'domain_mailbox_allocation_stats',
    DOMAIN_POOL_RESET: 'domain_mailbox_allocation_reset',
} as const;

export type MailLogAction = typeof MAIL_LOG_ACTIONS[keyof typeof MAIL_LOG_ACTIONS];
