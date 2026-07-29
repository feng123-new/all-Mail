import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBootstrapCredential } from './bootstrapAdmin.js';

void test('persisted bootstrap credential wins for crash-safe retries', () => {
    const credential = resolveBootstrapCredential(
        {
            ADMIN_USERNAME: 'persisted-admin',
            ADMIN_PASSWORD: 'persisted-password',
        },
        {
            ADMIN_USERNAME: 'environment-admin',
            ADMIN_PASSWORD: 'environment-password',
        },
    );

    assert.deepEqual(credential, {
        username: 'persisted-admin',
        password: 'persisted-password',
        source: 'file',
    });
});

void test('explicit initializer environment is used before generation', () => {
    const credential = resolveBootstrapCredential({}, {
        ADMIN_USERNAME: 'operator-admin',
        ADMIN_PASSWORD: 'operator-password',
    });

    assert.deepEqual(credential, {
        username: 'operator-admin',
        password: 'operator-password',
        source: 'environment',
    });
});

void test('missing initializer password produces a strong generated credential', () => {
    const credential = resolveBootstrapCredential({}, {
        ADMIN_USERNAME: 'generated-admin',
        ADMIN_PASSWORD: '',
    });

    assert.equal(credential.username, 'generated-admin');
    assert.equal(credential.source, 'generated');
    assert.ok(credential.password.length >= 24);
});

void test('invalid explicit credentials fail instead of being silently rewritten', () => {
    assert.throws(
        () => resolveBootstrapCredential({}, {
            ADMIN_USERNAME: 'admin',
            ADMIN_PASSWORD: 'short',
        }),
        /at least 8 characters/,
    );
});
