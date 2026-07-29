import assert from 'node:assert/strict';
import test from 'node:test';
import { isApiOrAdminPath } from './http.js';

void test('recognizes every backend namespace', () => {
    for (const path of [
        '/admin/auth/login',
        '/api/mailboxes',
        '/mail/api/messages',
        '/ingress/domain-mail/receive',
        '/oauth/callback',
    ]) {
        assert.equal(isApiOrAdminPath(path), true, path);
    }
});

void test('does not classify frontend routes as backend namespaces', () => {
    for (const path of ['/', '/login', '/dashboard', '/assets/main.js']) {
        assert.equal(isApiOrAdminPath(path), false, path);
    }
});
