import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
	'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

const {
	batchClearMailboxSchema,
	batchFetchMailboxesSchema,
	createEmailSchema,
	listEmailSchema,
	revealEmailSecretsSchema,
	revealEmailUnlockSchema,
} = await import('./email.schema.js');

void test('listEmailSchema accepts representativeProtocol filter', () => {
    const parsed = listEmailSchema.parse({ representativeProtocol: 'oauth_api' });

    assert.equal(parsed.representativeProtocol, 'oauth_api');
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 10);
});

void test('batch action schemas accept representativeProtocol filter', () => {
    const batchFetch = batchFetchMailboxesSchema.parse({ representativeProtocol: 'imap_smtp' });
    const batchClear = batchClearMailboxSchema.parse({ representativeProtocol: 'oauth_api', mailbox: 'Junk' });

    assert.equal(batchFetch.representativeProtocol, 'imap_smtp');
    assert.equal(batchFetch.mailboxes.length, 3);
    assert.equal(batchClear.representativeProtocol, 'oauth_api');
    assert.equal(batchClear.mailbox, 'Junk');
});

void test('createEmailSchema requires manual IMAP host config for custom profile', () => {
    assert.throws(() => createEmailSchema.parse({
        email: 'custom@example.com',
        provider: 'CUSTOM_IMAP_SMTP',
        authType: 'APP_PASSWORD',
        password: 'secret',
    }), /imapHost/);
});

void test('createEmailSchema accepts custom IMAP/SMTP host overrides', () => {
    const parsed = createEmailSchema.parse({
        email: 'custom@example.com',
        provider: 'CUSTOM_IMAP_SMTP',
        authType: 'APP_PASSWORD',
        password: 'secret',
        providerConfig: {
            imapHost: 'imap.custom.test',
            smtpHost: 'smtp.custom.test',
        },
    });

    assert.equal(parsed.providerConfig?.imapHost, 'imap.custom.test');
    assert.equal(parsed.providerConfig?.smtpHost, 'smtp.custom.test');
});

void test('revealEmailUnlockSchema requires a 6-digit OTP', () => {
	const parsed = revealEmailUnlockSchema.parse({ otp: '123456' });
	assert.equal(parsed.otp, '123456');
	assert.throws(() => revealEmailUnlockSchema.parse({ otp: '12345' }), /6 位验证码/);
});

void test('revealEmailSecretsSchema accepts either OTP or grant token', () => {
	const otpParsed = revealEmailSecretsSchema.parse({
		otp: '123456',
		fields: ['password'],
	});
	const grantParsed = revealEmailSecretsSchema.parse({
		grantToken: 'grant-token-123',
		fields: ['password'],
	});

	assert.equal(otpParsed.otp, '123456');
	assert.equal(grantParsed.grantToken, 'grant-token-123');
	assert.throws(
		() => revealEmailSecretsSchema.parse({ fields: ['password'] }),
		/验证码或提供临时授权令牌/,
	);
});
