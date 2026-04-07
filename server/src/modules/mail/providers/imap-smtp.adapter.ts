import { AppError } from '../../../plugins/error.js';
import { deleteMessagesViaImap, fetchMessagesViaImap, resolveImapMailboxCandidate, resolveImapMailboxName, sendMailViaSmtp, toImapAppError } from './shared.js';
import { createFamilyAwareProviderAdapter } from './family.helpers.js';
import { mergeProviderConfigForCredentials, requireCredential, type EmailProvider, type MailProfileDelegate, type MailProviderAdapter, type ProviderProfile } from './types.js';

interface ImapSmtpDelegateOptions {
    provider: EmailProvider;
    profile: ProviderProfile;
    methodPrefix: string;
    sentAliases?: string[];
    junkAliases?: string[];
}

const DEFAULT_FOLDERS = {
    inbox: 'INBOX',
    junk: 'Junk',
    sent: 'Sent',
};

const DEFAULT_SENT_ALIASES = ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送'];
const DEFAULT_JUNK_ALIASES = ['Junk', 'Spam', 'Bulk Mail', '垃圾邮件', '垃圾邮件文件夹', '垃圾箱'];

export function resolveMailboxAliases(mailbox: string, options: Pick<ImapSmtpDelegateOptions, 'sentAliases' | 'junkAliases'>): string[] | undefined {
    const normalized = mailbox.toLowerCase();
    if (normalized === 'sent') {
        return options.sentAliases || DEFAULT_SENT_ALIASES;
    }

    if (normalized === 'junk' || normalized === 'spam') {
        return options.junkAliases || DEFAULT_JUNK_ALIASES;
    }

    return undefined;
}

function createImapSmtpProfileDelegate(options: ImapSmtpDelegateOptions): MailProfileDelegate {
    return {
        provider: options.provider,
        profile: options.profile,
        representativeProtocol: 'imap_smtp',
        getCapabilities() {
            return {
                readInbox: true,
                readJunk: true,
                readSent: true,
                clearMailbox: false,
                sendMail: true,
                modes: ['IMAP', 'SMTP'],
            };
        },
        async getEmails(credentials, requestOptions) {
            const config = mergeProviderConfigForCredentials(credentials);
            const password = requireCredential(credentials.password, 'password', credentials.provider);
            const mailboxName = resolveImapMailboxName(requestOptions.mailbox, config.folders || {}, DEFAULT_FOLDERS);
            const mailboxAliases = resolveMailboxAliases(requestOptions.mailbox, options);

            try {
                const resolvedMailbox = await resolveImapMailboxCandidate({
                    email: credentials.email,
                    host: requireCredential(typeof config.imapHost === 'string' ? config.imapHost : null, 'imapHost', credentials.provider),
                    port: typeof config.imapPort === 'number' ? config.imapPort : 993,
                    tls: config.imapTls !== false,
                    mailbox: mailboxName,
                    mailboxAliases,
                    password,
                });
                const result = await fetchMessagesViaImap({
                    email: credentials.email,
                    host: requireCredential(typeof config.imapHost === 'string' ? config.imapHost : null, 'imapHost', credentials.provider),
                    port: typeof config.imapPort === 'number' ? config.imapPort : 993,
                    tls: config.imapTls !== false,
                    mailbox: resolvedMailbox,
                    limit: requestOptions.limit || 100,
                    mailboxCheckpoint: requestOptions.mailboxCheckpoint,
                    password,
                    mailboxAliases,
                });
                return {
                    email: credentials.email,
                    mailbox: requestOptions.mailbox,
                    resolvedMailbox,
                    count: result.messages.length,
                    messages: result.messages,
                    mailboxCheckpoint: result.mailboxCheckpoint,
                    method: `${options.methodPrefix}_imap`,
                    provider: credentials.provider,
                };
            } catch (error) {
                throw toImapAppError(error, credentials.provider);
            }
        },
        async processMailbox(credentials, requestOptions) {
            throw new AppError('MAILBOX_CLEAR_UNSUPPORTED', `Mailbox clear is not available for ${credentials.provider} provider in ${requestOptions.mailbox}`, 400);
        },
        async deleteMessages(credentials, requestOptions) {
            const config = mergeProviderConfigForCredentials(credentials);
            const password = requireCredential(credentials.password, 'password', credentials.provider);
            const mailboxName = resolveImapMailboxName(requestOptions.mailbox, config.folders || {}, DEFAULT_FOLDERS);
            const mailboxAliases = resolveMailboxAliases(requestOptions.mailbox, options);

            try {
                const resolvedMailbox = await resolveImapMailboxCandidate({
                    email: credentials.email,
                    host: requireCredential(typeof config.imapHost === 'string' ? config.imapHost : null, 'imapHost', credentials.provider),
                    port: typeof config.imapPort === 'number' ? config.imapPort : 993,
                    tls: config.imapTls !== false,
                    mailbox: mailboxName,
                    mailboxAliases,
                    password,
                });
                const result = await deleteMessagesViaImap({
                    email: credentials.email,
                    host: requireCredential(typeof config.imapHost === 'string' ? config.imapHost : null, 'imapHost', credentials.provider),
                    port: typeof config.imapPort === 'number' ? config.imapPort : 993,
                    tls: config.imapTls !== false,
                    mailbox: resolvedMailbox,
                    messageIds: requestOptions.messageIds,
                    mailboxCheckpoint: requestOptions.mailboxCheckpoint,
                    password,
                });
                return {
                    email: credentials.email,
                    mailbox: requestOptions.mailbox,
                    resolvedMailbox,
                    deletedCount: result.deletedCount,
                    message: `Deleted ${result.deletedCount} selected messages`,
                    mailboxCheckpoint: result.mailboxCheckpoint,
                    method: `${options.methodPrefix}_imap`,
                    provider: credentials.provider,
                };
            } catch (error) {
                throw toImapAppError(error, credentials.provider);
            }
        },
        async sendEmail(credentials, requestOptions) {
            const config = mergeProviderConfigForCredentials(credentials);
            const password = requireCredential(credentials.password, 'password', credentials.provider);
            const result = await sendMailViaSmtp({
                host: requireCredential(typeof config.smtpHost === 'string' ? config.smtpHost : null, 'smtpHost', credentials.provider),
                port: typeof config.smtpPort === 'number' ? config.smtpPort : 465,
                secure: config.smtpSecure !== false,
                user: credentials.email,
                password,
                message: requestOptions,
            });
            return {
                provider: credentials.provider,
                method: `${options.methodPrefix}_smtp`,
                providerMessageId: result.id,
                accepted: requestOptions.to,
            };
        },
    };
}

export const netease163MailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('NETEASE_163', [
    createImapSmtpProfileDelegate({
        provider: 'NETEASE_163',
        profile: 'netease-163-imap-smtp',
        methodPrefix: 'netease163',
    }),
]);

export const netease126MailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('NETEASE_126', [
    createImapSmtpProfileDelegate({
        provider: 'NETEASE_126',
        profile: 'netease-126-imap-smtp',
        methodPrefix: 'netease126',
    }),
]);

export const icloudMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('ICLOUD', [
    createImapSmtpProfileDelegate({
        provider: 'ICLOUD',
        profile: 'icloud-imap-smtp',
        methodPrefix: 'icloud',
    }),
]);

export const yahooMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('YAHOO', [
    createImapSmtpProfileDelegate({
        provider: 'YAHOO',
        profile: 'yahoo-imap-smtp',
        methodPrefix: 'yahoo',
    }),
]);

export const zohoMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('ZOHO', [
    createImapSmtpProfileDelegate({
        provider: 'ZOHO',
        profile: 'zoho-imap-smtp',
        methodPrefix: 'zoho',
    }),
]);

export const aliyunMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('ALIYUN', [
    createImapSmtpProfileDelegate({
        provider: 'ALIYUN',
        profile: 'aliyun-imap-smtp',
        methodPrefix: 'aliyun',
    }),
]);

export const amazonWorkmailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('AMAZON_WORKMAIL', [
    createImapSmtpProfileDelegate({
        provider: 'AMAZON_WORKMAIL',
        profile: 'amazon-workmail-imap-smtp',
        methodPrefix: 'amazonworkmail',
        sentAliases: ['Sent Items', 'Sent', 'Sent Mail', 'Sent Messages', '已发送'],
    }),
]);

export const fastmailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('FASTMAIL', [
    createImapSmtpProfileDelegate({
        provider: 'FASTMAIL',
        profile: 'fastmail-imap-smtp',
        methodPrefix: 'fastmail',
        sentAliases: ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送'],
    }),
]);

export const aolMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('AOL', [
    createImapSmtpProfileDelegate({
        provider: 'AOL',
        profile: 'aol-imap-smtp',
        methodPrefix: 'aol',
        sentAliases: ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送'],
    }),
]);

export const gmxMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('GMX', [
    createImapSmtpProfileDelegate({
        provider: 'GMX',
        profile: 'gmx-imap-smtp',
        methodPrefix: 'gmx',
        sentAliases: ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送'],
    }),
]);

export const mailcomMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('MAILCOM', [
    createImapSmtpProfileDelegate({
        provider: 'MAILCOM',
        profile: 'mailcom-imap-smtp',
        methodPrefix: 'mailcom',
        sentAliases: ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送'],
    }),
]);

export const yandexMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('YANDEX', [
    createImapSmtpProfileDelegate({
        provider: 'YANDEX',
        profile: 'yandex-imap-smtp',
        methodPrefix: 'yandex',
        sentAliases: ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送'],
    }),
]);

export const customImapSmtpMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('CUSTOM_IMAP_SMTP', [
    createImapSmtpProfileDelegate({
        provider: 'CUSTOM_IMAP_SMTP',
        profile: 'custom-imap-smtp',
        methodPrefix: 'custom',
        sentAliases: ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送'],
    }),
]);
