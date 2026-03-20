import { AppError } from '../../../plugins/error.js';
import { deleteMessagesViaImap, fetchMessagesViaImap, resolveImapMailboxCandidate, resolveImapMailboxName, sendMailViaSmtp, toImapAppError } from './shared.js';
import { type MailProviderAdapter, mergeProviderConfig, requireCredential } from './types.js';

export const qqMailAdapter: MailProviderAdapter = {
    provider: 'QQ',
    getCapabilities() { return { readInbox: true, readJunk: true, readSent: true, clearMailbox: false, sendMail: true, modes: ['IMAP'] }; },
    async getEmails(credentials, options) {
        const config = mergeProviderConfig(credentials.provider, credentials.providerConfig);
        const password = requireCredential(credentials.password, 'password', credentials.provider);
        const mailboxName = resolveImapMailboxName(options.mailbox, config.folders || {}, {
            inbox: 'INBOX',
            junk: 'Junk',
            sent: 'Sent Messages',
        });
        const normalizedMailboxName = mailboxName === 'Spam' ? 'Junk' : mailboxName;
        const mailboxAliases = options.mailbox.toLowerCase() === 'sent'
            ? ['Sent Messages', 'Sent', 'Sent Mail', '已发送']
            : undefined;
        try {
            const resolvedMailbox = await resolveImapMailboxCandidate({
                email: credentials.email,
                host: config.imapHost || 'imap.qq.com',
                port: config.imapPort || 993,
                tls: config.imapTls !== false,
                mailbox: normalizedMailboxName,
                mailboxAliases,
                password,
            });
            const messages = await fetchMessagesViaImap({
                email: credentials.email,
                host: config.imapHost || 'imap.qq.com',
                port: config.imapPort || 993,
                tls: config.imapTls !== false,
                mailbox: resolvedMailbox,
                limit: options.limit || 100,
                password,
            });
            return { email: credentials.email, mailbox: options.mailbox, resolvedMailbox, count: messages.length, messages, method: 'qq_imap', provider: credentials.provider };
        } catch (error) {
            throw toImapAppError(error, 'QQ');
        }
    },
    async processMailbox(credentials, options) {
        throw new AppError('MAILBOX_CLEAR_UNSUPPORTED', `Mailbox clear is not available for ${credentials.provider} provider in ${options.mailbox}`, 400);
    },
    async deleteMessages(credentials, options) {
        const config = mergeProviderConfig(credentials.provider, credentials.providerConfig);
        const password = requireCredential(credentials.password, 'password', credentials.provider);
        const mailboxName = resolveImapMailboxName(options.mailbox, config.folders || {}, {
            inbox: 'INBOX',
            junk: 'Junk',
            sent: 'Sent Messages',
        });
        const normalizedMailboxName = mailboxName === 'Spam' ? 'Junk' : mailboxName;
        const mailboxAliases = options.mailbox.toLowerCase() === 'sent'
            ? ['Sent Messages', 'Sent', 'Sent Mail', '已发送']
            : undefined;
        try {
            const resolvedMailbox = await resolveImapMailboxCandidate({
                email: credentials.email,
                host: config.imapHost || 'imap.qq.com',
                port: config.imapPort || 993,
                tls: config.imapTls !== false,
                mailbox: normalizedMailboxName,
                mailboxAliases,
                password,
            });
            const deletedCount = await deleteMessagesViaImap({
                email: credentials.email,
                host: config.imapHost || 'imap.qq.com',
                port: config.imapPort || 993,
                tls: config.imapTls !== false,
                mailbox: resolvedMailbox,
                messageIds: options.messageIds,
                password,
            });
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                resolvedMailbox,
                deletedCount,
                message: `Deleted ${deletedCount} selected messages`,
                method: 'qq_imap',
                provider: credentials.provider,
            };
        } catch (error) {
            throw toImapAppError(error, 'QQ');
        }
    },
    async sendEmail(credentials, options) {
        const password = requireCredential(credentials.password, 'password', credentials.provider);
        const result = await sendMailViaSmtp({
            host: 'smtp.qq.com',
            port: 465,
            secure: true,
            user: credentials.email,
            password,
            message: options,
        });
        return {
            provider: credentials.provider,
            method: 'qq_smtp',
            providerMessageId: result.id,
            accepted: options.to,
        };
    },
};
