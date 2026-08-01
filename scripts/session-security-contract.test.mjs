import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("administrator and mailbox sessions have durable revocation state", async () => {
	const migration = await read("core/internal/schema/migrations/20260731_revocable_sessions.sql");
	for (const table of ["admins", "mailbox_users"]) {
		assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*session_version`, "i"));
	}
	assert.match(migration, /admins_bump_session_version/);
	assert.match(migration, /mailbox_users_bump_session_version/);
	assert.match(migration, /NEW\.password_hash IS DISTINCT FROM OLD\.password_hash/);
	assert.match(migration, /NEW\.two_factor_secret IS DISTINCT FROM OLD\.two_factor_secret/);
});

test("Go JWT verification enforces algorithm, issuer, audience, and session version", async () => {
	const [goAuth, types, mailboxAuth, goStore] = await Promise.all([
		read("core/internal/businessapi/auth.go"),
		read("core/internal/businessapi/types.go"),
		read("core/internal/businessapi/mailbox_auth.go"),
		read("core/internal/businessapi/store.go"),
	]);
	assert.match(goAuth, /header\.Algorithm != "HS256"/);
	assert.match(goAuth, /payload\.Issuer != allMailJWTIssuer/);
	assert.match(goAuth, /claims\.SessionVersion != storedVersion/);
	assert.match(types, /allMailJWTIssuer\s*= "all-mail"/);
	assert.match(mailboxAuth, /claims\.SessionVersion != identity\.SessionVersion/);
	assert.match(goStore, /must_change_password, session_version/);
});

test("security mutations rotate browser sessions", async () => {
	const [adminRoutes, mailboxRoutes] = await Promise.all([
		read("core/internal/businessapi/auth_handlers.go"),
		read("core/internal/businessapi/mailbox_auth_handlers.go"),
	]);
	assert.match(adminRoutes, /adminChangePassword[\s\S]*signAdminSession\(admin\)[\s\S]*setAdminSessionCookie/);
	assert.match(adminRoutes, /writeTwoFactorRotation[\s\S]*signAdminSession\(admin\)[\s\S]*setAdminSessionCookie/);
	assert.match(mailboxRoutes, /mailboxChangePassword[\s\S]*rotateMailboxSession/);
	assert.match(mailboxRoutes, /writeMailboxTwoFactorRotation[\s\S]*rotateMailboxSession/);
});

test("Microsoft OAuth defaults stay limited to identity and mail capabilities", async () => {
	const [oauthService, helperConfig] = await Promise.all([
		read("core/internal/businessapi/mail_oauth_handlers.go"),
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
