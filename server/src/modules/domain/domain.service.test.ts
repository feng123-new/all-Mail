import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??=
	"postgresql://tester:tester@127.0.0.1:15433/all_mail_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6380/0";
process.env.JWT_SECRET ??= "test-jwt-secret-1234567890abcdef";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-1234567890ab";
process.env.ADMIN_PASSWORD ??= "test-admin-password";

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

void test(
	"domainService.delete ignores soft-deleted inbound messages when checking blockers",
	async () => {
		const [{ default: prisma }, { domainService }] = await Promise.all([
			import("../../lib/prisma.js"),
			import("./domain.service.js"),
		]);

		let deleteCalled = false;
		const restores = [
			overrideMethod(
				prisma.domain,
				"findUnique",
				(async () => ({ id: 9 })) as never,
			),
			overrideMethod(
				prisma.domainMailbox,
				"count",
				(async () => 0) as never,
			),
			overrideMethod(
				prisma.inboundMessage,
				"count",
				(async ({ where }: { where: { isDeleted?: boolean } }) => {
					assert.equal(where.isDeleted, false);
					return 0;
				}) as never,
			),
			overrideMethod(
				prisma.outboundMessage,
				"count",
				(async () => 0) as never,
			),
			overrideMethod(
				prisma.domain,
				"delete",
				(async () => {
					deleteCalled = true;
					return {};
				}) as never,
			),
		];

		try {
			const result = await domainService.delete(9);
			assert.equal(deleteCalled, true);
			assert.deepEqual(result, { success: true });
		} finally {
			while (restores.length > 0) {
				restores.pop()?.();
			}
		}
	},
);
