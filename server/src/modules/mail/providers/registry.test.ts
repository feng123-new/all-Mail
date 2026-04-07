import assert from 'node:assert/strict';
import test from 'node:test';

import { mailProviderRegistry } from './registry.js';

void test('mail provider registry resolves newly added imap_smtp providers', () => {
    const adapter = mailProviderRegistry.resolve({
        id: 1,
        email: 'example@icloud.com',
        provider: 'ICLOUD',
        authType: 'APP_PASSWORD',
        password: 'app-password',
        autoAssigned: false,
    });

    assert.equal(adapter.provider, 'ICLOUD');
    assert.deepEqual(adapter.getCapabilities({
        id: 1,
        email: 'example@icloud.com',
        provider: 'ICLOUD',
        authType: 'APP_PASSWORD',
        password: 'app-password',
        autoAssigned: false,
    }), {
        readInbox: true,
        readJunk: true,
        readSent: true,
        clearMailbox: false,
        sendMail: true,
        modes: ['IMAP', 'SMTP'],
    });
});

void test('mail provider registry resolves custom imap_smtp provider', () => {
    const adapter = mailProviderRegistry.resolve({
        id: 2,
        email: 'example@custom.test',
        provider: 'CUSTOM_IMAP_SMTP',
        authType: 'APP_PASSWORD',
        password: 'secret',
        autoAssigned: false,
        providerConfig: {
            imapHost: 'imap.custom.test',
            smtpHost: 'smtp.custom.test',
        },
    });

    assert.equal(adapter.provider, 'CUSTOM_IMAP_SMTP');
    assert.deepEqual(adapter.getCapabilities({
        id: 2,
        email: 'example@custom.test',
        provider: 'CUSTOM_IMAP_SMTP',
        authType: 'APP_PASSWORD',
        password: 'secret',
        autoAssigned: false,
        providerConfig: {
            imapHost: 'imap.custom.test',
            smtpHost: 'smtp.custom.test',
        },
    }), {
        readInbox: true,
        readJunk: true,
        readSent: true,
        clearMailbox: false,
        sendMail: true,
        modes: ['IMAP', 'SMTP'],
    });
});
