import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../plugins/error.js';
import { createMailFacade } from './mail.facade.js';
import type { EmailMessage, MailCredentials, MailDeleteOptions, MailFetchOptions, MailProcessOptions, MailProviderAdapter, MailProviderRegistryLike, MailSendOptions } from './providers/types.js';

function createMessage(id: string, subject: string): EmailMessage {
    return { id, from: 'sender@example.com', to: 'receiver@example.com', subject, text: `${subject} text`, html: `<p>${subject}</p>`, date: '2026-03-15T00:00:00.000Z' };
}

function createAdapter(provider: MailCredentials['provider'], method: string, canClear: boolean): MailProviderAdapter {
    return {
        provider,
        getCapabilities() { return { readInbox: true, readJunk: true, readSent: true, clearMailbox: canClear, sendMail: true, modes: canClear ? ['API', 'IMAP'] : ['IMAP'] }; },
        async getEmails(credentials: MailCredentials, options: MailFetchOptions) {
            const base = `${provider}-${options.mailbox}-${method}`;
            const messages = options.limit === 1 ? [createMessage(`${provider}-latest`, base)] : [createMessage(`${provider}-1`, `${base}-1`), createMessage(`${provider}-2`, `${base}-2`)];
            return { email: credentials.email, mailbox: options.mailbox, count: messages.length, messages, method, provider };
        },
        async processMailbox(credentials: MailCredentials, options: MailProcessOptions) {
            if (!canClear) throw new AppError('MAILBOX_CLEAR_UNSUPPORTED', `${provider} does not support mailbox clear`, 400);
            return { email: credentials.email, mailbox: options.mailbox, message: `${provider} cleared ${options.mailbox}`, status: 'success' as const, deletedCount: 2, method, provider };
        },
        async deleteMessages(credentials: MailCredentials, options: MailDeleteOptions) {
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                deletedCount: options.messageIds.length,
                message: `${provider} deleted ${options.messageIds.length} messages`,
                method,
                provider,
            };
        },
        async sendEmail(_credentials: MailCredentials, options: MailSendOptions) {
            return { provider, method: `${method}_send`, providerMessageId: `${provider}-send-id`, accepted: options.to };
        },
    };
}

const mockRegistry: MailProviderRegistryLike = {
    resolve(credentials: MailCredentials) {
        switch (credentials.provider) {
            case 'OUTLOOK': return createAdapter('OUTLOOK', 'outlook_graph_api', true);
            case 'GMAIL': return createAdapter('GMAIL', 'gmail_api', true);
            case 'QQ': return createAdapter('QQ', 'qq_imap', false);
            default:
                return createAdapter(credentials.provider, `${credentials.provider.toLowerCase()}_imap`, false);
        }
    },
};

const facade = createMailFacade(mockRegistry);
const outlook: MailCredentials = { id: 1, email: 'outlook@example.com', provider: 'OUTLOOK', authType: 'MICROSOFT_OAUTH', clientId: 'a', refreshToken: 'b', autoAssigned: false };
const gmail: MailCredentials = { id: 2, email: 'gmail@example.com', provider: 'GMAIL', authType: 'GOOGLE_OAUTH', clientId: 'a', refreshToken: 'b', autoAssigned: false };
const qq: MailCredentials = { id: 3, email: 'qq@example.com', provider: 'QQ', authType: 'APP_PASSWORD', password: 'auth', autoAssigned: false };

void test('closed loop: outlook latest', async () => { const result = await facade.getEmails(outlook, { mailbox: 'inbox', limit: 1 }); assert.equal(result.provider, 'OUTLOOK'); assert.equal(result.count, 1); });
void test('closed loop: outlook text', async () => { const result = await facade.getEmails(outlook, { mailbox: 'inbox', limit: 1 }); assert.match(result.messages[0].text, /OUTLOOK-inbox-outlook_graph_api/); });
void test('closed loop: outlook all', async () => { const result = await facade.getEmails(outlook, { mailbox: 'junk' }); assert.equal(result.count, 2); });
void test('closed loop: outlook clear', async () => { const result = await facade.processMailbox(outlook, { mailbox: 'inbox' }); assert.equal(result.deletedCount, 2); });
void test('closed loop: gmail latest', async () => { const result = await facade.getEmails(gmail, { mailbox: 'inbox', limit: 1 }); assert.equal(result.provider, 'GMAIL'); });
void test('closed loop: gmail text', async () => { const result = await facade.getEmails(gmail, { mailbox: 'inbox', limit: 1 }); assert.match(result.messages[0].text, /GMAIL-inbox-gmail_api/); });
void test('closed loop: gmail all', async () => { const result = await facade.getEmails(gmail, { mailbox: 'junk' }); assert.equal(result.count, 2); });
void test('closed loop: gmail clear', async () => { const result = await facade.processMailbox(gmail, { mailbox: 'inbox' }); assert.equal(result.provider, 'GMAIL'); });
void test('closed loop: gmail delete selected', async () => { const result = await facade.deleteMessages(gmail, { mailbox: 'inbox', messageIds: ['gmail-1', 'gmail-2'] }); assert.equal(result.deletedCount, 2); });
void test('closed loop: qq latest', async () => { const result = await facade.getEmails(qq, { mailbox: 'inbox', limit: 1 }); assert.equal(result.provider, 'QQ'); });
void test('closed loop: qq text', async () => { const result = await facade.getEmails(qq, { mailbox: 'inbox', limit: 1 }); assert.match(result.messages[0].text, /QQ-inbox-qq_imap/); });
void test('closed loop: qq all', async () => { const result = await facade.getEmails(qq, { mailbox: 'junk' }); assert.equal(result.count, 2); });
void test('closed loop: qq clear unsupported', async () => { await assert.rejects(() => facade.processMailbox(qq, { mailbox: 'inbox' }), (error: unknown) => error instanceof AppError && error.code === 'MAILBOX_CLEAR_UNSUPPORTED'); });
