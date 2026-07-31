import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiKeySchema, updateApiKeySchema } from './apiKey.schema.js';

void test('API key creation requires an explicitly enabled permission', () => {
    for (const input of [
        { name: 'missing' },
        { name: 'empty', permissions: {} },
        { name: 'disabled', permissions: { all: false } },
    ]) {
        assert.equal(createApiKeySchema.safeParse(input).success, false, JSON.stringify(input));
    }
    assert.equal(createApiKeySchema.safeParse({
        name: 'explicit',
        permissions: { list_emails: true },
    }).success, true);
});

void test('API key updates may omit permissions but may not clear them', () => {
    assert.equal(updateApiKeySchema.safeParse({ status: 'DISABLED' }).success, true);
    assert.equal(updateApiKeySchema.safeParse({ permissions: {} }).success, false);
    assert.equal(updateApiKeySchema.safeParse({ permissions: { all: false } }).success, false);
    assert.equal(updateApiKeySchema.safeParse({ permissions: { all: true } }).success, true);
});
