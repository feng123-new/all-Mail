import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
	'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

function overrideMethod<T extends object, K extends keyof T>(
	target: T,
	key: K,
	replacement: T[K],
) {
	const original = target[key];
	Object.assign(target, { [key]: replacement });
	return () => {
		Object.assign(target, { [key]: original });
	};
}

void test('mailboxUserService.getAccessibleMailboxes exposes sendReady only when an active sending config exists', async () => {
	const [{ default: prisma }, { mailboxUserService }] = await Promise.all([
		import('../../lib/prisma.js'),
		import('./mailboxUser.service.js'),
	]);

	const restores = [
		overrideMethod(
			prisma.domainMailbox,
			'findMany',
			(async () => [
				{
					id: 1,
					domainId: 10,
					localPart: 'ready',
					address: 'ready@example.com',
					displayName: null,
					status: 'ACTIVE',
					provisioningMode: 'MANUAL',
					canLogin: true,
					isCatchAllTarget: false,
					forwardMode: 'DISABLED',
					forwardTo: null,
					domain: {
						id: 10,
						name: 'example.com',
						canSend: true,
						canReceive: true,
						sendingConfigs: [{ id: 99 }],
					},
				},
				{
					id: 2,
					domainId: 10,
					localPart: 'pending',
					address: 'pending@example.com',
					displayName: null,
					status: 'ACTIVE',
					provisioningMode: 'MANUAL',
					canLogin: true,
					isCatchAllTarget: false,
					forwardMode: 'DISABLED',
					forwardTo: null,
					domain: {
						id: 10,
						name: 'example.com',
						canSend: true,
						canReceive: true,
						sendingConfigs: [],
					},
				},
				{
					id: 3,
					domainId: 11,
					localPart: 'receive-only',
					address: 'receive-only@example.net',
					displayName: null,
					status: 'ACTIVE',
					provisioningMode: 'API_POOL',
					canLogin: true,
					isCatchAllTarget: false,
					forwardMode: 'DISABLED',
					forwardTo: null,
					domain: {
						id: 11,
						name: 'example.net',
						canSend: false,
						canReceive: true,
						sendingConfigs: [{ id: 100 }],
					},
				},
			]) as never,
		),
	];

	try {
		const result = await mailboxUserService.getAccessibleMailboxes(1);
		assert.equal(result[0]?.sendReady, true);
		assert.equal(result[1]?.sendReady, false);
		assert.equal(result[2]?.sendReady, false);
		assert.equal('sendingConfigs' in (result[0]?.domain ?? {}), false);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});
