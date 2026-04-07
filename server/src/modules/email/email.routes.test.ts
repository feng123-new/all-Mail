import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Prisma } from "@prisma/client";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??=
	"postgresql://tester:tester@127.0.0.1:15433/all_mail_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6380/0";
process.env.JWT_SECRET ??= "test-jwt-secret-1234567890abcdef";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-1234567890ab";
process.env.ADMIN_PASSWORD ??= "test-admin-password";

function toPrismaPromise<T>(value: T): Prisma.PrismaPromise<T> {
	return Promise.resolve(value) as Prisma.PrismaPromise<T>;
}

async function createAdminToken(adminId: number) {
	const { signToken } = await import("../../lib/jwt.js");
	return signToken({
		sub: String(adminId),
		username: "admin-user",
		role: "ADMIN",
	}, { audience: 'admin-console' });
}

async function mockAdminAuthContext() {
	const { default: prisma } = await import("../../lib/prisma.js");
	const originalFindUnique = prisma.admin.findUnique.bind(prisma.admin);
	const findUniqueMock: typeof prisma.admin.findUnique = () =>
		toPrismaPromise({
			id: 1,
			username: "admin-user",
			role: "ADMIN",
			status: "ACTIVE",
			mustChangePassword: false,
		});

	prisma.admin.findUnique = findUniqueMock;

	return () => {
		prisma.admin.findUnique = originalFindUnique;
	};
}

void test("email export route forwards rawSecrets and ids query params to emailService.export", async () => {
	const [{ buildApp }, { emailService }] = await Promise.all([
		import("../../app.js"),
		import("./email.service.js"),
	]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let capturedArgs: unknown[] | null = null;
	mock.method(emailService, "export", async (...args: unknown[]) => {
		capturedArgs = args;
		return "exported-content";
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "GET",
			url: "/admin/emails/export?ids=1,2&separator=::::&groupId=3&rawSecrets=true",
			headers: { authorization: `Bearer ${token}` },
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(capturedArgs, [[1, 2], "::::", 3, true]);
		assert.deepEqual(JSON.parse(response.payload), {
			success: true,
			data: { content: "exported-content" },
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email export route defaults rawSecrets to false", async () => {
	const [{ buildApp }, { emailService }] = await Promise.all([
		import("../../app.js"),
		import("./email.service.js"),
	]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let capturedArgs: unknown[] | null = null;
	mock.method(emailService, "export", async (...args: unknown[]) => {
		capturedArgs = args;
		return "exported-content";
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "GET",
			url: "/admin/emails/export",
			headers: { authorization: `Bearer ${token}` },
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(capturedArgs, [undefined, undefined, undefined, false]);
		assert.deepEqual(JSON.parse(response.payload), {
			success: true,
			data: { content: "exported-content" },
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email detail route ignores secrets query flag", async () => {
	const [{ buildApp }, { emailService }] = await Promise.all([
		import("../../app.js"),
		import("./email.service.js"),
	]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let capturedArgs: unknown[] | null = null;
	mock.method(emailService, "getById", async (...args: unknown[]) => {
		capturedArgs = args;
		return { id: 12, email: "detail@example.com" };
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "GET",
			url: "/admin/emails/12?secrets=true",
			headers: { authorization: `Bearer ${token}` },
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(capturedArgs, [12, false]);
		assert.deepEqual(JSON.parse(response.payload), {
			success: true,
			data: { id: 12, email: "detail@example.com" },
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email reveal route verifies 2FA and returns requested secrets", async () => {
	const [{ buildApp }, { authService }, { emailService }, { mailService }] =
		await Promise.all([
			import("../../app.js"),
			import("../auth/auth.service.js"),
			import("./email.service.js"),
			import("../mail/mail.service.js"),
		]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let authArgs: unknown[] | null = null;
	let revealArgs: unknown[] | null = null;
	let logArgs: unknown[] | null = null;
	mock.method(authService, "verifyStepUpTwoFactor", async (...args: unknown[]) => {
		authArgs = args;
		return { verified: true };
	});
	mock.method(emailService, "revealSecrets", async (...args: unknown[]) => {
		revealArgs = args;
		return {
			secrets: { password: "app-password" },
			availableFields: ["password"],
		};
	});
	mock.method(mailService, "logAdminAction", async (...args: unknown[]) => {
		logArgs = args;
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "POST",
			url: "/admin/emails/12/reveal-secrets",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: {
				otp: "123456",
				fields: ["password"],
			},
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(authArgs, [1, { otp: "123456" }]);
		assert.deepEqual(revealArgs, [12, ["password"]]);
		assert.equal(logArgs?.[0], "admin_reveal_external_secret");
		assert.equal(logArgs?.[1], 12);
		assert.equal(logArgs?.[3], 200);
		assert.deepEqual(JSON.parse(response.payload), {
			success: true,
			data: {
				secrets: { password: "app-password" },
				availableFields: ["password"],
			},
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email reveal unlock route verifies OTP and returns a short-lived grant", async () => {
	const [{ buildApp }, { authService }, { mailService }] = await Promise.all([
		import("../../app.js"),
		import("../auth/auth.service.js"),
		import("../mail/mail.service.js"),
	]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let authArgs: unknown[] | null = null;
	let grantArgs: unknown[] | null = null;
	mock.method(authService, "verifyStepUpTwoFactor", async (...args: unknown[]) => {
		authArgs = args;
		return { verified: true };
	});
	mock.method(
		authService,
		"createExternalSecretRevealGrant",
		async (...args: unknown[]) => {
			grantArgs = args;
			return {
				grantToken: "grant-token-123",
				expiresAt: "2026-04-02T12:34:56.000Z",
			};
		},
	);

	const logCalls: unknown[][] = [];
	mock.method(mailService, "logAdminAction", async (...args: unknown[]) => {
		logCalls.push(args);
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "POST",
			url: "/admin/emails/reveal-unlock",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: { otp: "123456" },
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(authArgs, [1, { otp: "123456" }]);
		assert.deepEqual(grantArgs, [1]);
		assert.equal(logCalls[0]?.[0], "admin_reveal_external_secret_unlock");
		assert.equal(logCalls[0]?.[3], 200);
		assert.deepEqual(JSON.parse(response.payload), {
			success: true,
			data: {
				grantToken: "grant-token-123",
				expiresAt: "2026-04-02T12:34:56.000Z",
			},
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email reveal unlock route returns INVALID_OTP when step-up verification fails", async () => {
	const [{ buildApp }, { authService }, { mailService }, { AppError }] =
		await Promise.all([
			import("../../app.js"),
			import("../auth/auth.service.js"),
			import("../mail/mail.service.js"),
			import("../../plugins/error.js"),
		]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	mock.method(authService, "verifyStepUpTwoFactor", async () => {
		throw new AppError("INVALID_OTP", "Invalid two-factor code", 401);
	});
	let logArgs: unknown[] | null = null;
	mock.method(mailService, "logAdminAction", async (...args: unknown[]) => {
		logArgs = args;
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "POST",
			url: "/admin/emails/reveal-unlock",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: { otp: "000000" },
		});

		assert.equal(response.statusCode, 401);
		assert.equal(logArgs?.[0], "admin_reveal_external_secret_unlock");
		assert.equal(logArgs?.[3], 401);
		assert.deepEqual(JSON.parse(response.payload), {
			success: false,
			requestId: "req-1",
			error: {
				code: "INVALID_OTP",
				message: "Invalid two-factor code",
			},
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email reveal route accepts a valid short-lived grant token", async () => {
	const [{ buildApp }, { authService }, { emailService }, { mailService }] =
		await Promise.all([
			import("../../app.js"),
			import("../auth/auth.service.js"),
			import("./email.service.js"),
			import("../mail/mail.service.js"),
		]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let verifyGrantArgs: unknown[] | null = null;
	let revealArgs: unknown[] | null = null;
	mock.method(
		authService,
		"verifyExternalSecretRevealGrant",
		async (...args: unknown[]) => {
			verifyGrantArgs = args;
			return { verified: true };
		},
	);
	mock.method(emailService, "revealSecrets", async (...args: unknown[]) => {
		revealArgs = args;
		return {
			secrets: { password: "revealed-password" },
			availableFields: ["password"],
		};
	});
	let logArgs: unknown[] | null = null;
	mock.method(mailService, "logAdminAction", async (...args: unknown[]) => {
		logArgs = args;
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "POST",
			url: "/admin/emails/12/reveal-secrets",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: {
				grantToken: "grant-token-123",
				fields: ["password"],
			},
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(verifyGrantArgs, [1, "grant-token-123"]);
		assert.deepEqual(revealArgs, [12, ["password"]]);
		assert.equal(logArgs?.[0], "admin_reveal_external_secret");
		assert.equal(logArgs?.[3], 200);
		assert.deepEqual(JSON.parse(response.payload), {
			success: true,
			data: {
				secrets: { password: "revealed-password" },
				availableFields: ["password"],
			},
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email reveal route returns REVEAL_UNLOCK_EXPIRED when grant verification fails", async () => {
	const [{ buildApp }, { authService }, { mailService }, { AppError }] =
		await Promise.all([
			import("../../app.js"),
			import("../auth/auth.service.js"),
			import("../mail/mail.service.js"),
			import("../../plugins/error.js"),
		]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	mock.method(authService, "verifyExternalSecretRevealGrant", async () => {
		throw new AppError(
			"REVEAL_UNLOCK_EXPIRED",
			"Reveal unlock expired or invalid",
			401,
		);
	});
	let logArgs: unknown[] | null = null;
	mock.method(mailService, "logAdminAction", async (...args: unknown[]) => {
		logArgs = args;
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "POST",
			url: "/admin/emails/12/reveal-secrets",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: {
				grantToken: "expired-grant-token",
				fields: ["password"],
			},
		});

		assert.equal(response.statusCode, 401);
		assert.equal(logArgs?.[0], "admin_reveal_external_secret");
		assert.equal(logArgs?.[3], 401);
		assert.deepEqual(JSON.parse(response.payload), {
			success: false,
			requestId: "req-1",
			error: {
				code: "REVEAL_UNLOCK_EXPIRED",
				message: "Reveal unlock expired or invalid",
			},
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email reveal route accepts accountLoginPassword as a revealable field", async () => {
	const [{ buildApp }, { authService }, { emailService }, { mailService }] =
		await Promise.all([
			import("../../app.js"),
			import("../auth/auth.service.js"),
			import("./email.service.js"),
			import("../mail/mail.service.js"),
		]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let authArgs: unknown[] | null = null;
	let revealArgs: unknown[] | null = null;
	mock.method(authService, "verifyStepUpTwoFactor", async (...args: unknown[]) => {
		authArgs = args;
		return { verified: true };
	});
	mock.method(emailService, "revealSecrets", async (...args: unknown[]) => {
		revealArgs = args;
		return {
			secrets: { accountLoginPassword: "portal-login-password" },
			availableFields: ["refreshToken", "accountLoginPassword"],
		};
	});
	mock.method(mailService, "logAdminAction", async () => undefined);

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "POST",
			url: "/admin/emails/12/reveal-secrets",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: {
				otp: "123456",
				fields: ["accountLoginPassword"],
			},
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(authArgs, [1, { otp: "123456" }]);
		assert.deepEqual(revealArgs, [12, ["accountLoginPassword"]]);
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email update route requires a grant token before updating account login password", async () => {
	const [{ buildApp }] = await Promise.all([import("../../app.js")]);

	const restoreAdminFindUnique = await mockAdminAuthContext();
	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "PUT",
			url: "/admin/emails/12",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: {
				accountLoginPassword: "portal-login-password",
			},
		});

		assert.equal(response.statusCode, 403);
		assert.deepEqual(JSON.parse(response.payload), {
			success: false,
			requestId: "req-1",
			error: {
				code: "ACCOUNT_LOGIN_PASSWORD_GRANT_REQUIRED",
				message:
					"Two-factor verification is required before updating the stored account login password",
			},
		});
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});

void test("email update route verifies grant token before updating account login password", async () => {
	const [{ buildApp }, { authService }, { emailService }] = await Promise.all([
		import("../../app.js"),
		import("../auth/auth.service.js"),
		import("./email.service.js"),
	]);

	const restoreAdminFindUnique = await mockAdminAuthContext();

	let verifyGrantArgs: unknown[] | null = null;
	let updateArgs: unknown[] | null = null;
	mock.method(
		authService,
		"verifyExternalSecretRevealGrant",
		async (...args: unknown[]) => {
			verifyGrantArgs = args;
			return { verified: true };
		},
	);
	mock.method(emailService, "update", async (...args: unknown[]) => {
		updateArgs = args;
		return { id: 12, updatedAt: new Date().toISOString() };
	});

	const app = await buildApp();
	try {
		const token = await createAdminToken(1);
		const response = await app.inject({
			method: "PUT",
			url: "/admin/emails/12",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			payload: {
				accountLoginPassword: "portal-login-password",
				accountPasswordGrantToken: "grant-token-123",
			},
		});

		assert.equal(response.statusCode, 200);
		assert.deepEqual(verifyGrantArgs, [1, "grant-token-123"]);
		assert.deepEqual(updateArgs, [12, { accountLoginPassword: "portal-login-password" }]);
	} finally {
		restoreAdminFindUnique();
		mock.restoreAll();
		await app.close();
	}
});
