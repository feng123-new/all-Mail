import assert from 'node:assert/strict';
import test from 'node:test';
import { isApiPermissionAllowed, parseApiPermissions } from './api-permissions.js';

void test('allows all actions when permissions not set', () => {
    assert.equal(isApiPermissionAllowed(undefined, 'external_read_latest_message'), true);
});

void test('supports wildcard allow', () => {
    assert.equal(isApiPermissionAllowed({ '*': true }, 'external_mailbox_allocation_stats'), true);
});

void test('allows explicit configured action', () => {
    assert.equal(isApiPermissionAllowed({ external_read_latest_message: true }, 'external_read_latest_message'), true);
});

void test('denies missing action when permission map present', () => {
    assert.equal(isApiPermissionAllowed({ external_read_latest_message: true }, 'external_list_messages'), false);
});

void test('normalizes kebab-case action keys', () => {
    assert.equal(isApiPermissionAllowed({ 'process-mailbox': true }, 'external_clear_mailbox'), false);
    assert.equal(isApiPermissionAllowed({ external_clear_mailbox: true }, 'external_clear_mailbox'), true);
});

void test('accepts legacy permission keys when parsing', () => {
    const parsed = parseApiPermissions({
        mail_new: true,
        unknown_action: true,
    });
    assert.deepEqual(parsed, { external_read_latest_message: true });
});
