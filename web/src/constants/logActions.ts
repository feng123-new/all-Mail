export const LOG_ACTIONS = {
    GET_EMAIL: 'external_allocate_mailbox',
    MAIL_NEW: 'external_read_latest_message',
    MAIL_TEXT: 'external_read_message_text',
    MAIL_ALL: 'external_list_messages',
    PROCESS_MAILBOX: 'external_clear_mailbox',
    LIST_EMAILS: 'external_list_mailboxes',
    ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK: 'admin_reveal_external_secret_unlock',
    ADMIN_REVEAL_EXTERNAL_SECRET: 'admin_reveal_external_secret',
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

export type LogAction = typeof LOG_ACTIONS[keyof typeof LOG_ACTIONS];

const LEGACY_ACTION_ALIASES: Record<string, LogAction> = {
    get_email: LOG_ACTIONS.GET_EMAIL,
    mail_new: LOG_ACTIONS.MAIL_NEW,
    mail_text: LOG_ACTIONS.MAIL_TEXT,
    mail_all: LOG_ACTIONS.MAIL_ALL,
    process_mailbox: LOG_ACTIONS.PROCESS_MAILBOX,
    list_emails: LOG_ACTIONS.LIST_EMAILS,
    admin_reveal_external_secret_unlock: LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK,
    admin_reveal_external_secret: LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET,
    pool_stats: LOG_ACTIONS.POOL_STATS,
    pool_reset: LOG_ACTIONS.POOL_RESET,
    domain_get_mailbox: LOG_ACTIONS.DOMAIN_GET_MAILBOX,
    domain_mail_new: LOG_ACTIONS.DOMAIN_MAIL_NEW,
    domain_mail_text: LOG_ACTIONS.DOMAIN_MAIL_TEXT,
    domain_mail_all: LOG_ACTIONS.DOMAIN_MAIL_ALL,
    domain_list_mailboxes: LOG_ACTIONS.DOMAIN_LIST_MAILBOXES,
    domain_pool_stats: LOG_ACTIONS.DOMAIN_POOL_STATS,
    domain_pool_reset: LOG_ACTIONS.DOMAIN_POOL_RESET,
    'process-mailbox': LOG_ACTIONS.PROCESS_MAILBOX,
    emails: LOG_ACTIONS.LIST_EMAILS,
};

export const LOG_ACTION_LABELS: Record<LogAction, string> = {
    [LOG_ACTIONS.GET_EMAIL]: '分配外部邮箱',
    [LOG_ACTIONS.MAIL_NEW]: '读取外部最新邮件',
    [LOG_ACTIONS.MAIL_TEXT]: '提取外部邮件文本',
    [LOG_ACTIONS.MAIL_ALL]: '列出外部邮件',
    [LOG_ACTIONS.PROCESS_MAILBOX]: '清理外部邮箱',
    [LOG_ACTIONS.LIST_EMAILS]: '列出外部邮箱',
    [LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK]: '验证外部邮箱密钥查看授权',
    [LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET]: '受控查看外部邮箱密钥',
    [LOG_ACTIONS.POOL_STATS]: '外部分配统计',
    [LOG_ACTIONS.POOL_RESET]: '重置外部分配',
    [LOG_ACTIONS.DOMAIN_GET_MAILBOX]: '分配域名邮箱',
    [LOG_ACTIONS.DOMAIN_MAIL_NEW]: '读取域名最新邮件',
    [LOG_ACTIONS.DOMAIN_MAIL_TEXT]: '提取域名邮件文本',
    [LOG_ACTIONS.DOMAIN_MAIL_ALL]: '列出域名邮件',
    [LOG_ACTIONS.DOMAIN_LIST_MAILBOXES]: '列出域名邮箱',
    [LOG_ACTIONS.DOMAIN_POOL_STATS]: '域名分配统计',
    [LOG_ACTIONS.DOMAIN_POOL_RESET]: '重置域名分配',
};

export const LOG_ACTION_COLORS: Record<LogAction, string> = {
    [LOG_ACTIONS.GET_EMAIL]: 'cyan',
    [LOG_ACTIONS.MAIL_NEW]: 'processing',
    [LOG_ACTIONS.MAIL_TEXT]: 'geekblue',
    [LOG_ACTIONS.MAIL_ALL]: 'processing',
    [LOG_ACTIONS.PROCESS_MAILBOX]: 'error',
    [LOG_ACTIONS.LIST_EMAILS]: 'default',
    [LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK]: 'gold',
    [LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET]: 'volcano',
    [LOG_ACTIONS.POOL_STATS]: 'default',
    [LOG_ACTIONS.POOL_RESET]: 'warning',
    [LOG_ACTIONS.DOMAIN_GET_MAILBOX]: 'cyan',
    [LOG_ACTIONS.DOMAIN_MAIL_NEW]: 'processing',
    [LOG_ACTIONS.DOMAIN_MAIL_TEXT]: 'geekblue',
    [LOG_ACTIONS.DOMAIN_MAIL_ALL]: 'processing',
    [LOG_ACTIONS.DOMAIN_LIST_MAILBOXES]: 'default',
    [LOG_ACTIONS.DOMAIN_POOL_STATS]: 'default',
    [LOG_ACTIONS.DOMAIN_POOL_RESET]: 'warning',
};

export const LOG_ACTION_OPTIONS: Array<{ value: LogAction; label: string }> = [
    { value: LOG_ACTIONS.GET_EMAIL, label: LOG_ACTION_LABELS[LOG_ACTIONS.GET_EMAIL] },
    { value: LOG_ACTIONS.MAIL_NEW, label: LOG_ACTION_LABELS[LOG_ACTIONS.MAIL_NEW] },
    { value: LOG_ACTIONS.MAIL_TEXT, label: LOG_ACTION_LABELS[LOG_ACTIONS.MAIL_TEXT] },
    { value: LOG_ACTIONS.MAIL_ALL, label: LOG_ACTION_LABELS[LOG_ACTIONS.MAIL_ALL] },
    { value: LOG_ACTIONS.PROCESS_MAILBOX, label: LOG_ACTION_LABELS[LOG_ACTIONS.PROCESS_MAILBOX] },
    { value: LOG_ACTIONS.LIST_EMAILS, label: LOG_ACTION_LABELS[LOG_ACTIONS.LIST_EMAILS] },
    { value: LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK, label: LOG_ACTION_LABELS[LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK] },
    { value: LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET, label: LOG_ACTION_LABELS[LOG_ACTIONS.ADMIN_REVEAL_EXTERNAL_SECRET] },
    { value: LOG_ACTIONS.POOL_STATS, label: LOG_ACTION_LABELS[LOG_ACTIONS.POOL_STATS] },
    { value: LOG_ACTIONS.POOL_RESET, label: LOG_ACTION_LABELS[LOG_ACTIONS.POOL_RESET] },
    { value: LOG_ACTIONS.DOMAIN_GET_MAILBOX, label: LOG_ACTION_LABELS[LOG_ACTIONS.DOMAIN_GET_MAILBOX] },
    { value: LOG_ACTIONS.DOMAIN_MAIL_NEW, label: LOG_ACTION_LABELS[LOG_ACTIONS.DOMAIN_MAIL_NEW] },
    { value: LOG_ACTIONS.DOMAIN_MAIL_TEXT, label: LOG_ACTION_LABELS[LOG_ACTIONS.DOMAIN_MAIL_TEXT] },
    { value: LOG_ACTIONS.DOMAIN_MAIL_ALL, label: LOG_ACTION_LABELS[LOG_ACTIONS.DOMAIN_MAIL_ALL] },
    { value: LOG_ACTIONS.DOMAIN_LIST_MAILBOXES, label: LOG_ACTION_LABELS[LOG_ACTIONS.DOMAIN_LIST_MAILBOXES] },
    { value: LOG_ACTIONS.DOMAIN_POOL_STATS, label: LOG_ACTION_LABELS[LOG_ACTIONS.DOMAIN_POOL_STATS] },
    { value: LOG_ACTIONS.DOMAIN_POOL_RESET, label: LOG_ACTION_LABELS[LOG_ACTIONS.DOMAIN_POOL_RESET] },
];

export function normalizeLogAction(action: string): LogAction | undefined {
    if (action in LOG_ACTION_LABELS) {
        return action as LogAction;
    }
    return LEGACY_ACTION_ALIASES[action];
}

export function getLogActionLabel(action: string): string {
    const normalizedAction = normalizeLogAction(action);
    if (!normalizedAction) {
        return action;
    }
    return LOG_ACTION_LABELS[normalizedAction];
}

export function getLogActionColor(action: string): string {
    const normalizedAction = normalizeLogAction(action);
    if (!normalizedAction) {
        return 'default';
    }
    return LOG_ACTION_COLORS[normalizedAction];
}
