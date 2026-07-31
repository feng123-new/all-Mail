import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("administrator and mailbox sessions have durable revocation state", async () => {
	const [migration, schema] = await Promise.all([
		read("server/prisma/migrations/20260731_revocable_sessions/migration.sql"),
		read("server/prisma/schema.prisma"),
	]);
	for (const table of ["admins", "mailbox_users"]) {
		assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*session_version`, "i"));
	}
	assert.match(migration, /admins_bump_session_version/);
	assert.match(migration, /mailbox_users_bump_session_version/);
	assert.match(migration, /NEW\.password_hash IS DISTINCT FROM OLD\.password_hash/);
	assert.match(migration, /NEW\.two_factor_secret IS DISTINCT FROM OLD\.two_factor_secret/);
	assert.equal((schema.match(/sessionVersion/g) ?? []).length, 2);
});

test("Fastify and private Go JWT verification share issuer and session-version checks", async () => {
	const [jwt, sessionVersion, goAuth, goStore] = await Promise.all([
		read("server/src/lib/jwt.ts"),
		read("server/src/lib/session-version.ts"),
		read("core/internal/businessapi/auth.go"),
		read("core/internal/businessapi/store.go"),
	]);
	assert.match(jwt, /algorithms: \['HS256'\]/);
	assert.match(jwt, /issuer: JWT_ISSUER/);
	assert.match(jwt, /payload\.sessionVersion !== currentVersion/);
	assert.match(sessionVersion, /JWT_ISSUER = 'all-mail'/);
	assert.match(goAuth, /payload\.Issuer != allMailJWTIssuer/);
	assert.match(goAuth, /claims\.SessionVersion != storedVersion/);
	assert.match(goStore, /must_change_password, session_version/);
});

test("security mutations rotate browser sessions", async () => {
	const [adminRoutes, mailboxRoutes] = await Promise.all([
		read("server/src/modules/auth/auth.routes.ts"),
		read("server/src/modules/mailbox-user/mailboxPortal.routes.ts"),
	]);
	assert.match(adminRoutes, /change-password[\s\S]*rotateAdminSession/);
	assert.match(adminRoutes, /2fa\/enable[\s\S]*rotateAdminSession/);
	assert.match(adminRoutes, /2fa\/disable[\s\S]*rotateAdminSession/);
	assert.match(mailboxRoutes, /change-password[\s\S]*rotateMailboxSession/);
});

test("Microsoft OAuth defaults stay limited to identity and mail capabilities", async () => {
	const [oauthService, helperConfig] = await Promise.all([
		read("server/src/modules/email/email.oauth.service.ts"),
		read("oauth-temp/config.example.env"),
	]);
	for (const content of [oauthService, helperConfig]) {
		assert.match(content, /User\.Read/);
		assert.match(content, /Mail\.ReadWrite/);
		assert.match(content, /Mail\.Send/);
		assert.doesNotMatch(content, /Contacts\.ReadWrite/);
		assert.doesNotMatch(content, /Calendars\.ReadWrite/);
		assert.doesNotMatch(content, /MailboxSettings\.ReadWrite/);
	}
});
