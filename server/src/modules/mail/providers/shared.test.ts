import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_IMAP_CLIENT_IDENTIFICATION,
    formatImapIdentificationCommand,
    identifyImapClient,
    installPreReadyImapIdHook,
    type ImapClientIdentificationConnection,
    type ImapPreReadyIdentificationConnection,
} from './imap-identification.js';

void test('identifyImapClient sends the default ID payload when supported', async () => {
    const calls: Array<Record<string, string>> = [];
    const imap: ImapClientIdentificationConnection = {
        serverSupports(capability) {
            return capability === 'ID';
        },
        id(identification, callback) {
            if (!identification) {
                throw new Error('Expected identification payload');
            }
            calls.push(identification);
            callback(null);
        },
    };

    await identifyImapClient(imap);

    assert.deepEqual(calls, [DEFAULT_IMAP_CLIENT_IDENTIFICATION]);
});

void test('identifyImapClient still attempts ID when the server capability flag is missing', async () => {
    let called = false;
    const imap: ImapClientIdentificationConnection = {
        serverSupports() {
            return false;
        },
        id(_identification, callback) {
            called = true;
            callback(null);
        },
    };

    await identifyImapClient(imap);

    assert.equal(called, true);
});

void test('identifyImapClient tolerates ID command failures to preserve existing IMAP compatibility', async () => {
    const imap: ImapClientIdentificationConnection = {
        serverSupports(capability) {
            return capability === 'ID';
        },
        id(_identification, callback) {
            callback(new Error('unsafe login gate'));
        },
    };

    await assert.doesNotReject(() => identifyImapClient(imap));
});

void test('installPreReadyImapIdHook injects ID before node-imap readiness LIST for NetEase hosts', () => {
    const calls: string[] = [];
    const imap: ImapPreReadyIdentificationConnection = {
        serverSupports() {
            return false;
        },
        _enqueue(fullcmd) {
            calls.push(fullcmd);
        },
    };

    installPreReadyImapIdHook(imap, 'imap.163.com');
    assert.equal(typeof imap._enqueue, 'function');

    imap._enqueue?.('LIST "" ""');

    assert.deepEqual(calls, [
        formatImapIdentificationCommand(DEFAULT_IMAP_CLIENT_IDENTIFICATION),
        'LIST "" ""',
    ]);
});

void test('installPreReadyImapIdHook leaves non-NetEase hosts untouched', () => {
    const calls: string[] = [];
    const imap: ImapPreReadyIdentificationConnection = {
        serverSupports() {
            return true;
        },
        _enqueue(fullcmd) {
            calls.push(fullcmd);
        },
    };

    installPreReadyImapIdHook(imap, 'imap.gmail.com');
    imap._enqueue?.('LIST "" ""');

    assert.deepEqual(calls, ['LIST "" ""']);
});
