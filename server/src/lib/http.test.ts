import assert from 'node:assert/strict';
import test from 'node:test';
import { isApiOrAdminPath, shouldServeSpaIndex } from './http.js';

void test('should serve SPA index for deep-link HTML request', () => {
    const result = shouldServeSpaIndex({
        method: 'GET',
        path: '/api-keys',
        accept: 'text/html',
    });
    assert.equal(result, true);
});

void test('should return JSON not-found for API namespace', () => {
    const result = shouldServeSpaIndex({
        method: 'GET',
        path: '/api/not-exists',
        accept: 'text/html',
    });
    assert.equal(result, false);
});

void test('should treat mailbox portal api namespace as backend path', () => {
    assert.equal(isApiOrAdminPath('/mail/api/messages'), true);
    assert.equal(shouldServeSpaIndex({
        method: 'GET',
        path: '/mail/api/messages',
        accept: 'text/html',
    }), false);
});

void test('should treat ingress namespace as backend path', () => {
    assert.equal(isApiOrAdminPath('/ingress/domain-mail/receive'), true);
    assert.equal(shouldServeSpaIndex({
        method: 'POST',
        path: '/ingress/domain-mail/receive',
        accept: 'application/json',
    }), false);
});

void test('should return JSON not-found for explicit JSON accept', () => {
    const result = shouldServeSpaIndex({
        method: 'GET',
        path: '/any-route',
        accept: 'application/json',
    });
    assert.equal(result, false);
});

void test('should return JSON not-found for static asset path', () => {
    const result = shouldServeSpaIndex({
        method: 'GET',
        path: '/assets/main.js',
        accept: '*/*',
    });
    assert.equal(result, false);
});
