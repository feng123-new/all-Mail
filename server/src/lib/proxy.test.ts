import assert from 'node:assert/strict';
import test from 'node:test';
import { ProxyAgent } from 'undici';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

async function loadProxyModule() {
    return import('./proxy.js');
}

async function closeDispatcher(dispatcher: unknown) {
    if (!dispatcher || typeof dispatcher !== 'object') {
        return;
    }
    const maybeClose = (dispatcher as { close?: () => Promise<void> }).close;
    if (typeof maybeClose === 'function') {
        await maybeClose.call(dispatcher);
    }
}

void test('createSocksAgent normalizes shorthand SOCKS5 URLs into ProxyAgent dispatchers', async () => {
    const { createSocksAgent } = await loadProxyModule();
    const dispatcher = createSocksAgent('127.0.0.1:1080');
    try {
        assert.ok(dispatcher);
        assert.ok(dispatcher instanceof ProxyAgent);
    } finally {
        await closeDispatcher(dispatcher);
    }
});

void test('createSocksAgent rejects non-SOCKS protocols', () => {
    return loadProxyModule().then(({ createSocksAgent }) => {
        assert.equal(createSocksAgent('http://127.0.0.1:3128'), null);
    });
});

void test('createHttpAgent returns ProxyAgent dispatchers for HTTP proxies', async () => {
    const { createHttpAgent } = await loadProxyModule();
    const dispatcher = createHttpAgent('http://127.0.0.1:3128');
    try {
        assert.ok(dispatcher);
        assert.ok(dispatcher instanceof ProxyAgent);
    } finally {
        await closeDispatcher(dispatcher);
    }
});

void test('autoProxy prefers SOCKS5 when both SOCKS5 and HTTP proxies are provided', async () => {
    const { autoProxy } = await loadProxyModule();
    const proxy = autoProxy('127.0.0.1:1080', 'http://127.0.0.1:3128');
    try {
        assert.equal(proxy.type, 'socks5');
        assert.ok(proxy.dispatcher instanceof ProxyAgent);
    } finally {
        await closeDispatcher(proxy.dispatcher);
    }
});

void test('autoProxy falls back to direct mode when no proxies are configured', () => {
    return loadProxyModule().then(({ autoProxy }) => {
        const proxy = autoProxy();
        assert.equal(proxy.type, 'none');
        assert.equal(proxy.dispatcher, undefined);
    });
});
