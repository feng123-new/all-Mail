import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseEnvKeys(content) {
	return content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#") && line.includes("="))
		.map((line) => line.slice(0, line.indexOf("=")).trim())
		.sort();
}

test("default docker env templates stay aligned", async () => {
	const [defaultTemplate, basicTemplate] = await Promise.all([
		readFile(path.join(repoRoot, ".env.example"), "utf8"),
		readFile(path.join(repoRoot, ".env.basic.example"), "utf8"),
	]);

	assert.deepEqual(parseEnvKeys(defaultTemplate), parseEnvKeys(basicTemplate));
});

test("docker compose binds published ports to configurable hosts", async () => {
	const compose = await readFile(
		path.join(repoRoot, "docker-compose.yml"),
		"utf8",
	);

	assert.match(compose, /\$\{APP_PUBLISH_HOST:-127\.0\.0\.1\}/);
	assert.match(compose, /\$\{POSTGRES_PUBLISH_HOST:-127\.0\.0\.1\}/);
	assert.match(compose, /\$\{REDIS_PUBLISH_HOST:-127\.0\.0\.1\}/);
});

test("Go forwarding waits for a fresh gated legacy jobs runtime", async () => {
	const [compose, entrypoint] = await Promise.all([
		readFile(path.join(repoRoot, "docker-compose.yml"), "utf8"),
		readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8"),
	]);

	assert.match(
		compose,
		/go-jobs:[\s\S]*?depends_on:[\s\S]*?\n\s{6}jobs:\n\s{8}condition: service_healthy/,
	);
	assert.match(
		entrypoint,
		/runtime_role" = "jobs"[\s\S]*?rm -f "\$ALL_MAIL_STATE_DIR\/jobs-heartbeat\.txt"/,
	);
	assert.match(compose, /ENCRYPTION_KEY_FILE: \/var\/lib\/all-mail\/encryption-key/);
	assert.match(compose, /ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE: \/var\/lib\/all-mail-go\/encryption-key/);
	assert.match(entrypoint, /chown 10001:10001 "\$ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE"/);
});

test("Prisma db push preserves the Go forwarding lease timestamp type", async () => {
	const schema = await readFile(
		path.join(repoRoot, "server/prisma/schema.prisma"),
		"utf8",
	);

	assert.match(
		schema,
		/leaseExpiresAt\s+DateTime\?\s+@map\("lease_expires_at"\)\s+@db\.Timestamptz\(3\)/,
	);
});

test("source-runtime migrations install forwarding claim ownership columns", async () => {
	const migration = await readFile(
		path.join(
			repoRoot,
			"server/prisma/migrations/202607281200_forwarding_claim_lease_v1/migration.sql",
		),
		"utf8",
	);

	assert.match(migration, /claim_token VARCHAR\(64\)/);
	assert.match(migration, /lease_expires_at TIMESTAMPTZ\(3\)/);
	assert.match(migration, /mailbox_forward_jobs_go_claim_idx/);
});

test("root release scripts include worker install and production audits", async () => {
	const packageJson = JSON.parse(
		await readFile(path.join(repoRoot, "package.json"), "utf8"),
	);

	assert.match(
		packageJson.scripts["install:all"],
		/cloudflare\/workers\/allmail-edge install/,
	);
	assert.match(packageJson.scripts["verify:release"], /npm run audit:prod/);
	assert.match(
		packageJson.scripts["audit:prod"],
		/node scripts\/run-audit-prod\.mjs/,
	);
	assert.match(packageJson.scripts.check, /npm run verify:release/);
});

test("bootstrap password output stays opt-in and points operators at persisted state", async () => {
	const [startScript, entrypoint] = await Promise.all([
		readFile(path.join(repoRoot, "scripts/start-all-mail.mjs"), "utf8"),
		readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8"),
	]);

	assert.match(startScript, /buildBootstrapAdminPasswordMessages/);
	assert.match(entrypoint, /ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD/);
	assert.match(
		entrypoint,
		/Retrieve it from the runtime state file instead of startup logs\./,
	);
});
