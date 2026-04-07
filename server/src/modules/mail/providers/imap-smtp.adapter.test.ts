import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMailboxAliases } from './imap-smtp.adapter.js';

void test('resolveMailboxAliases includes localized junk aliases for generic IMAP providers', () => {
    const aliases = resolveMailboxAliases('Junk', {});

    assert.deepEqual(aliases, ['Junk', 'Spam', 'Bulk Mail', '垃圾邮件', '垃圾邮件文件夹', '垃圾箱']);
});

void test('resolveMailboxAliases still returns sent aliases for sent mailbox', () => {
    const aliases = resolveMailboxAliases('SENT', {});

    assert.deepEqual(aliases, ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送']);
});

void test('resolveMailboxAliases returns undefined for inbox mailbox', () => {
    assert.equal(resolveMailboxAliases('INBOX', {}), undefined);
});
