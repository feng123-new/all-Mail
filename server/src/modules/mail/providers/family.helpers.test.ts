import assert from 'node:assert/strict';
import test from 'node:test';

import { createFamilyAwareProviderAdapter } from './family.helpers.js';
import { getProviderProfileSummary, type MailProfileDelegate } from './types.js';

function createDelegate(profile: MailProfileDelegate['profile'], method: string): MailProfileDelegate {
    const representativeProtocol = getProviderProfileSummary(profile).representativeProtocol;
    return {
        provider: 'GMAIL',
        profile,
        representativeProtocol,
        getCapabilities() {
            return {
                readInbox: true,
                readJunk: true,
                readSent: true,
                clearMailbox: representativeProtocol === 'oauth_api',
                sendMail: true,
                modes: representativeProtocol === 'oauth_api' ? ['GMAIL_API'] : ['IMAP', 'SMTP'],
            };
        },
        async getEmails(credentials, options) {
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                count: 1,
                messages: [],
                method,
                provider: credentials.provider,
            };
        },
        async processMailbox(credentials, options) {
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                message: method,
                status: 'success',
                deletedCount: 0,
                method,
                provider: credentials.provider,
            };
        },
        async deleteMessages(credentials, options) {
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                deletedCount: options.messageIds.length,
                message: method,
                method,
                provider: credentials.provider,
            };
        },
        async sendEmail(credentials, options) {
            return {
                provider: credentials.provider,
                method,
                providerMessageId: `${method}-id`,
                accepted: options.to,
            };
        },
    };
}

void test('createFamilyAwareProviderAdapter routes Gmail app password to IMAP/SMTP delegate', async () => {
    const adapter = createFamilyAwareProviderAdapter('GMAIL', [
        createDelegate('gmail-oauth', 'gmail_api_delegate'),
        createDelegate('gmail-app-password', 'gmail_imap_delegate'),
    ]);

    const result = await adapter.getEmails({
        id: 1,
        email: 'gmail@example.com',
        provider: 'GMAIL',
        authType: 'APP_PASSWORD',
        password: 'secret',
        autoAssigned: false,
    }, {
        mailbox: 'inbox',
    });

    assert.equal(result.method, 'gmail_imap_delegate');
    assert.equal(adapter.getCapabilities({
        id: 1,
        email: 'gmail@example.com',
        provider: 'GMAIL',
        authType: 'APP_PASSWORD',
        password: 'secret',
        autoAssigned: false,
    }).clearMailbox, false);
});

void test('createFamilyAwareProviderAdapter routes Gmail OAuth to OAuth delegate', async () => {
    const adapter = createFamilyAwareProviderAdapter('GMAIL', [
        createDelegate('gmail-oauth', 'gmail_api_delegate'),
        createDelegate('gmail-app-password', 'gmail_imap_delegate'),
    ]);

    const result = await adapter.getEmails({
        id: 2,
        email: 'gmail@example.com',
        provider: 'GMAIL',
        authType: 'GOOGLE_OAUTH',
        clientId: 'client',
        refreshToken: 'refresh',
        autoAssigned: false,
    }, {
        mailbox: 'inbox',
    });

    assert.equal(result.method, 'gmail_api_delegate');
    assert.equal(adapter.getCapabilities({
        id: 2,
        email: 'gmail@example.com',
        provider: 'GMAIL',
        authType: 'GOOGLE_OAUTH',
        clientId: 'client',
        refreshToken: 'refresh',
        autoAssigned: false,
    }).clearMailbox, true);
});
