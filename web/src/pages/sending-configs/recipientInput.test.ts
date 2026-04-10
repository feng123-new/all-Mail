import { describe, expect, it } from 'vitest';
import { hasOnlyValidRecipients, parseRecipientInput } from './recipientInput';

describe('sending-config recipient input helpers', () => {
  it('parses multiple separators into recipient addresses', () => {
    expect(parseRecipientInput('alice@example.com, bob@example.com；carol@example.com\ndave@example.com'))
      .toEqual([
        'alice@example.com',
        'bob@example.com',
        'carol@example.com',
        'dave@example.com',
      ]);
  });

  it('rejects invalid recipient lists', () => {
    expect(hasOnlyValidRecipients('not-an-email')).toBe(false);
    expect(hasOnlyValidRecipients('alice@example.com; bad-address')).toBe(false);
  });

  it('accepts valid recipient lists', () => {
    expect(hasOnlyValidRecipients('alice@example.com; bob@example.com')).toBe(true);
  });
});
