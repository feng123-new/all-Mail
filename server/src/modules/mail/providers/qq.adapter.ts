import { AppError } from '../../../plugins/error.js';
import { createFamilyAwareProviderAdapter } from './family.helpers.js';
import { deleteMessagesViaImap, fetchMessagesViaImap, resolveImapMailboxCandidate, resolveImapMailboxName, sendMailViaSmtp, toImapAppError } from './shared.js';
import { type MailProfileDelegate, type MailProviderAdapter, mergeProviderConfigForCredentials, requireCredential } from './types.js';

export const qqImapSmtpProfileDelegate: MailProfileDelegate = {
    provider: 'QQ',
    profile: 'qq-imap-smtp',
    representativeProtocol: 'imap_smtp',
    getCapabilities() { return { readInbox: true, readJunk: true, readSent: true, clearMailbox: false, sendMail: true, modes: ['IMAP', 'SMTP'] }; },
    async getEmails(credentials, options) {
        const config = mergeProviderConfigForCredentials(credentials);
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
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                resolvedMailbox,
                count: messages.messages.length,
                messages: messages.messages,
                mailboxCheckpoint: messages.mailboxCheckpoint,
                method: 'qq_imap',
                provider: credentials.provider,
            };
        } catch (error) {
            throw toImapAppError(error, 'QQ');
        }
    },
    async processMailbox(credentials, options) {
        throw new AppError('MAILBOX_CLEAR_UNSUPPORTED', `Mailbox clear is not available for ${credentials.provider} provider in ${options.mailbox}`, 400);
    },
    async deleteMessages(credentials, options) {
        const config = mergeProviderConfigForCredentials(credentials);
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
                mailboxCheckpoint: options.mailboxCheckpoint,
                password,
            });
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                resolvedMailbox,
                deletedCount: deletedCount.deletedCount,
                message: `Deleted ${deletedCount.deletedCount} selected messages`,
                mailboxCheckpoint: deletedCount.mailboxCheckpoint,
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

export const qqMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('QQ', [
    qqImapSmtpProfileDelegate,
]);
