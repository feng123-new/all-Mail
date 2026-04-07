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

void test("emailService.updateMailboxStatus persists IMAP checkpoint metadata", async () => {
	const [{ default: prisma }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("./email.service.js"),
	]);

	let updatedMailboxStatus: unknown;
	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			mailboxStatus: {
				INBOX: {
					latestMessageId: "imap:9",
					latestMessageDate: "2026-03-29T11:50:00.000Z",
					messageCount: 1,
					hasNew: false,
					lastSyncedAt: "2026-03-29T11:50:00.000Z",
					lastViewedAt: "2026-03-29T11:50:00.000Z",
					uidValidity: 100,
					lastUid: 9,
				},
			},
		})) as never),
		overrideMethod(prisma.emailAccount, "update", (async ({
			data,
		}: {
			data: { mailboxStatus: unknown };
		}) => {
			updatedMailboxStatus = data.mailboxStatus;
			return {};
		}) as never),
	];

	try {
		await emailService.updateMailboxStatus(
			7,
			"INBOX",
			[{ id: "imap:11", date: "2026-03-29T12:00:00.000Z" }],
			{
				mailboxCheckpoint: {
					uidValidity: 100,
					lastUid: 11,
				},
			},
		);

		const mailboxStatus = updatedMailboxStatus as {
			INBOX: {
				latestMessageId: string | null;
				uidValidity: number | null;
				lastUid: number | null;
			};
		};

		assert.equal(mailboxStatus.INBOX.latestMessageId, "imap:11");
		assert.equal(mailboxStatus.INBOX.uidValidity, 100);
		assert.equal(mailboxStatus.INBOX.lastUid, 11);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.clearMailboxStatus clears IMAP checkpoint metadata", async () => {
	const [{ default: prisma }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("./email.service.js"),
	]);

	let updatedMailboxStatus: unknown;
	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			mailboxStatus: {
				INBOX: {
					latestMessageId: "imap:11",
					latestMessageDate: "2026-03-29T12:00:00.000Z",
					messageCount: 1,
					hasNew: true,
					lastSyncedAt: "2026-03-29T12:00:00.000Z",
					lastViewedAt: "2026-03-29T12:00:00.000Z",
					uidValidity: 100,
					lastUid: 11,
				},
			},
		})) as never),
		overrideMethod(prisma.emailAccount, "update", (async ({
			data,
		}: {
			data: { mailboxStatus: unknown };
		}) => {
			updatedMailboxStatus = data.mailboxStatus;
			return {};
		}) as never),
	];

	try {
		await emailService.clearMailboxStatus(7, "INBOX");

		const mailboxStatus = updatedMailboxStatus as {
			INBOX: {
				latestMessageId: string | null;
				uidValidity: number | null;
				lastUid: number | null;
			};
		};

		assert.equal(mailboxStatus.INBOX.latestMessageId, null);
		assert.equal(mailboxStatus.INBOX.uidValidity, null);
		assert.equal(mailboxStatus.INBOX.lastUid, null);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.getById hides stored secrets by default", async () => {
	const [{ default: prisma }, { encrypt }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("../../lib/crypto.js"),
		import("./email.service.js"),
	]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			id: 9,
			email: "hidden@example.com",
			provider: "QQ",
			authType: "APP_PASSWORD",
			clientId: null,
			clientSecret: encrypt("client-secret"),
			refreshToken: encrypt("refresh-token"),
			password: encrypt("mail-password"),
			accountLoginPassword: encrypt("portal-login-password"),
			providerConfig: null,
			capabilities: null,
			status: "ACTIVE",
			groupId: null,
			group: null,
			lastCheckAt: null,
			mailboxStatus: null,
			errorMessage: null,
			createdAt: new Date("2026-04-01T00:00:00.000Z"),
			updatedAt: new Date("2026-04-01T00:00:00.000Z"),
		})) as never),
	];

	try {
		const result = await emailService.getById(9);
		assert.equal(result.hasStoredPassword, true);
		assert.equal(result.hasStoredAccountLoginPassword, true);
		assert.equal(result.password, undefined);
		assert.equal(result.accountLoginPassword, undefined);
		assert.equal(result.refreshToken, undefined);
		assert.equal(result.clientSecret, undefined);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.list exposes hasStoredPassword without treating refreshToken as a password", async () => {
	const [{ default: prisma }, { encrypt }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("../../lib/crypto.js"),
		import("./email.service.js"),
	]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findMany", (async () => [
			{
				id: 11,
				email: "qq@example.com",
				provider: "QQ",
				authType: "APP_PASSWORD",
				clientId: null,
				providerConfig: null,
				status: "ACTIVE",
				groupId: null,
				group: null,
				lastCheckAt: null,
				mailboxStatus: null,
				errorMessage: null,
				createdAt: new Date("2026-04-02T00:00:00.000Z"),
				password: encrypt("qq-auth-code"),
				accountLoginPassword: null,
			},
			{
				id: 12,
				email: "oauth@example.com",
				provider: "OUTLOOK",
				authType: "MICROSOFT_OAUTH",
				clientId: "client-id",
				providerConfig: null,
				status: "ACTIVE",
				groupId: null,
				group: null,
				lastCheckAt: null,
				mailboxStatus: null,
				errorMessage: null,
				createdAt: new Date("2026-04-02T00:00:00.000Z"),
				password: null,
				accountLoginPassword: encrypt("portal-login-password"),
			},
		]) as never),
		overrideMethod(prisma.emailAccount, "count", (async () => 2) as never),
	];

	try {
		const result = await emailService.list({ page: 1, pageSize: 10 });
		assert.equal(result.total, 2);
		assert.equal(result.list[0]?.hasStoredPassword, true);
		assert.equal(result.list[0]?.hasStoredAccountLoginPassword, false);
		assert.equal(result.list[0]?.password, undefined);
		assert.equal(result.list[1]?.hasStoredPassword, false);
		assert.equal(result.list[1]?.hasStoredAccountLoginPassword, true);
		assert.equal(result.list[1]?.password, undefined);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.revealSecrets returns password for app-password mailboxes", async () => {
	const [{ default: prisma }, { encrypt }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("../../lib/crypto.js"),
		import("./email.service.js"),
	]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			id: 7,
			provider: "QQ",
			authType: "APP_PASSWORD",
			refreshToken: null,
			password: encrypt("qq-auth-code"),
		})) as never),
	];

	try {
		const result = await emailService.revealSecrets(7, ["password"]);
		assert.deepEqual(result, {
			secrets: { password: "qq-auth-code" },
			availableFields: ["password", "accountLoginPassword"],
		});
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.revealSecrets throws PASSWORD_NOT_PRESENT when password is missing", async () => {
	const [{ default: prisma }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("./email.service.js"),
	]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			id: 17,
			provider: "QQ",
			authType: "APP_PASSWORD",
			refreshToken: null,
			password: null,
		})) as never),
	];

	try {
		await assert.rejects(
			() => emailService.revealSecrets(17, ["password"]),
			(error: unknown) =>
				Boolean(
					error &&
						typeof error === "object" &&
						(error as { code?: unknown }).code === "PASSWORD_NOT_PRESENT",
				),
		);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.revealSecrets returns account login password for OAuth mailboxes", async () => {
	const [{ default: prisma }, { encrypt }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("../../lib/crypto.js"),
		import("./email.service.js"),
	]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			id: 27,
			provider: "OUTLOOK",
			authType: "MICROSOFT_OAUTH",
			refreshToken: encrypt("refresh-token"),
			password: null,
			accountLoginPassword: encrypt("portal-login-password"),
		})) as never),
	];

	try {
		const result = await emailService.revealSecrets(27, ["accountLoginPassword"]);
		assert.deepEqual(result, {
			secrets: { accountLoginPassword: "portal-login-password" },
			availableFields: ["refreshToken", "accountLoginPassword"],
		});
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.revealSecrets throws ACCOUNT_LOGIN_PASSWORD_NOT_PRESENT when account login password is missing", async () => {
	const [{ default: prisma }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("./email.service.js"),
	]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			id: 28,
			provider: "OUTLOOK",
			authType: "MICROSOFT_OAUTH",
			refreshToken: null,
			password: null,
			accountLoginPassword: null,
		})) as never),
	];

	try {
		await assert.rejects(
			() => emailService.revealSecrets(28, ["accountLoginPassword"]),
			(error: unknown) =>
				Boolean(
					error &&
						typeof error === "object" &&
						(error as { code?: unknown }).code ===
							"ACCOUNT_LOGIN_PASSWORD_NOT_PRESENT",
				),
		);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.revealSecrets rejects disallowed fields for current auth flow", async () => {
	const [{ default: prisma }, { encrypt }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("../../lib/crypto.js"),
		import("./email.service.js"),
	]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => ({
			id: 8,
			provider: "QQ",
			authType: "APP_PASSWORD",
			refreshToken: encrypt("should-not-show"),
			password: encrypt("qq-auth-code"),
		})) as never),
	];

	try {
		await assert.rejects(
			() => emailService.revealSecrets(8, ["refreshToken"]),
			(error: unknown) =>
				Boolean(
					error &&
						typeof error === "object" &&
						(error as { code?: unknown }).code === "SECRET_REVEAL_NOT_ALLOWED",
				),
		);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.export keeps default OAuth format but appends account login password when rawSecrets is enabled", async () => {
	const [{ default: prisma }, { encrypt }, { emailService }] =
		await Promise.all([
			import("../../lib/prisma.js"),
			import("../../lib/crypto.js"),
			import("./email.service.js"),
		]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findMany", (async () => [
			{
				email: "oauth@example.com",
				provider: "OUTLOOK",
				authType: "MICROSOFT_OAUTH",
				clientId: "client-id",
				clientSecret: encrypt("client-secret"),
				refreshToken: encrypt("refresh-token"),
				password: null,
				accountLoginPassword: encrypt("legacy-password"),
				providerConfig: null,
			},
		]) as never),
	];

	try {
		const defaultExport = await emailService.export();
		const rawSecretsExport = await emailService.export(
			undefined,
			"----",
			undefined,
			true,
		);

		assert.equal(
			defaultExport,
			"OUTLOOK_OAUTH----oauth@example.com----client-id----client-secret----refresh-token",
		);
		assert.equal(
			rawSecretsExport,
			"OUTLOOK_OAUTH----oauth@example.com----client-id----client-secret----refresh-token----legacy-password",
		);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.export leaves app-password exports unchanged when rawSecrets is enabled", async () => {
	const [{ default: prisma }, { encrypt }, { emailService }] =
		await Promise.all([
			import("../../lib/prisma.js"),
			import("../../lib/crypto.js"),
			import("./email.service.js"),
		]);

	const restores = [
		overrideMethod(prisma.emailAccount, "findMany", (async () => [
			{
				email: "qq@example.com",
				provider: "QQ",
				authType: "APP_PASSWORD",
				clientId: null,
				clientSecret: null,
				refreshToken: null,
				password: encrypt("qq-auth-code"),
				accountLoginPassword: null,
				providerConfig: null,
			},
		]) as never),
	];

	try {
		const defaultExport = await emailService.export();
		const rawSecretsExport = await emailService.export(
			undefined,
			"----",
			undefined,
			true,
		);

		assert.equal(
			defaultExport,
			"QQ_IMAP_SMTP----qq@example.com----qq-auth-code",
		);
		assert.equal(rawSecretsExport, defaultExport);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.import preserves appended OAuth account login password from rawSecrets exports", async () => {
	const [{ default: prisma }, { decrypt }, { emailService }] =
		await Promise.all([
			import("../../lib/prisma.js"),
			import("../../lib/crypto.js"),
			import("./email.service.js"),
		]);

	let createdData: {
		email: string;
		clientId: string | null;
		clientSecret: string | null;
		refreshToken: string | null;
		password: string | null;
		accountLoginPassword: string | null;
	} | null = null;
	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => null) as never),
		overrideMethod(
			prisma.emailAccount,
			"create",
			(async ({ data }: { data: typeof createdData }) => {
				createdData = data;
				return {};
			}) as never,
		),
	];

	try {
		const result = await emailService.import({
			content:
				"OUTLOOK_OAUTH----oauth@example.com----client-id----client-secret----refresh-token----legacy-password",
			separator: "----",
		});

		assert.deepEqual(result, { success: 1, failed: 0, errors: [] });
		assert.equal(createdData?.email, "oauth@example.com");
		assert.equal(createdData?.clientId, "client-id");
		assert.equal(
			createdData?.clientSecret ? decrypt(createdData.clientSecret) : null,
			"client-secret",
		);
		assert.equal(
			createdData?.refreshToken ? decrypt(createdData.refreshToken) : null,
			"refresh-token",
		);
		assert.equal(
			createdData?.password ? decrypt(createdData.password) : null,
			null,
		);
		assert.equal(
			createdData?.accountLoginPassword
				? decrypt(createdData.accountLoginPassword)
				: null,
			"legacy-password",
		);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.import accepts mainstream OAuth format with account login password first", async () => {
	const [{ default: prisma }, { decrypt }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("../../lib/crypto.js"),
		import("./email.service.js"),
	]);

	let createdData: Record<string, unknown> | null = null;
	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => null) as never),
		overrideMethod(
			prisma.emailAccount,
			"create",
			(async ({ data }: { data: Record<string, unknown> }) => {
				createdData = data;
				return {};
			}) as never,
		),
	];

	try {
		const result = await emailService.import({
			content:
				"JindraLannon1699@outlook.com----3PhYi9Mcv----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.refresh-token",
			separator: "----",
		});

		assert.deepEqual(result, { success: 1, failed: 0, errors: [] });
		assert.equal(createdData?.provider, "OUTLOOK");
		assert.equal(createdData?.authType, "MICROSOFT_OAUTH");
		assert.equal(createdData?.clientId, "9e5f94bc-e8a4-4e73-b8be-63364c29d753");
		assert.equal(createdData?.password, null);
		assert.equal(
			typeof createdData?.accountLoginPassword === "string"
				? decrypt(createdData.accountLoginPassword)
				: null,
			"3PhYi9Mcv",
		);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});

void test("emailService.import accepts mainstream IMAP format with optional account login password extension", async () => {
	const [{ default: prisma }, { decrypt }, { emailService }] = await Promise.all([
		import("../../lib/prisma.js"),
		import("../../lib/crypto.js"),
		import("./email.service.js"),
	]);

	let createdData: Record<string, unknown> | null = null;
	const restores = [
		overrideMethod(prisma.emailAccount, "findUnique", (async () => null) as never),
		overrideMethod(
			prisma.emailAccount,
			"create",
			(async ({ data }: { data: Record<string, unknown> }) => {
				createdData = data;
				return {};
			}) as never,
		),
	];

	try {
		const result = await emailService.import({
			content: "ops@qq.com----qq-auth-code----portal-login-password",
			separator: "----",
		});

		assert.deepEqual(result, { success: 1, failed: 0, errors: [] });
		assert.equal(createdData?.provider, "QQ");
		assert.equal(
			typeof createdData?.password === "string"
				? decrypt(createdData.password)
				: null,
			"qq-auth-code",
		);
		assert.equal(
			typeof createdData?.accountLoginPassword === "string"
				? decrypt(createdData.accountLoginPassword)
				: null,
			"portal-login-password",
		);
	} finally {
		while (restores.length > 0) {
			restores.pop()?.();
		}
	}
});
