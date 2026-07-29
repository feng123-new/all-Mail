import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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

test("Docker env templates expose one aligned variable contract", async () => {
	const [defaultTemplate, cloudflareTemplate] = await Promise.all([
		readFile(path.join(repoRoot, ".env.example"), "utf8"),
		readFile(path.join(repoRoot, ".env.cloudflare.example"), "utf8"),
	]);

	assert.deepEqual(parseEnvKeys(defaultTemplate), parseEnvKeys(cloudflareTemplate));
	assert.doesNotMatch(defaultTemplate, /API_LOG_RETENTION_OWNER|FORWARDING_WORKER_OWNER/);
	assert.match(defaultTemplate, /WORKER_HEARTBEAT_SECONDS=15/);
	assert.match(defaultTemplate, /WORKER_HEARTBEAT_MAX_AGE_SECONDS=90/);
	await assert.rejects(access(path.join(repoRoot, ".env.basic.example")));
});

test("docker compose binds published ports to configurable hosts", async () => {
	const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");
	assert.match(compose, /\$\{APP_PUBLISH_HOST:-127\.0\.0\.1\}/);
	assert.match(compose, /\$\{POSTGRES_PUBLISH_HOST:-127\.0\.0\.1\}/);
	assert.match(compose, /\$\{REDIS_PUBLISH_HOST:-127\.0\.0\.1\}/);
});

test("legacy bootstrap and migrations complete before long-running services", async () => {
	const [compose, entrypoint] = await Promise.all([
		readFile(path.join(repoRoot, "docker-compose.yml"), "utf8"),
		readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8"),
	]);

	assert.match(compose, /legacy-init:[\s\S]*?command: \["init"\]/);
	assert.match(
		compose,
		/go-migrate:[\s\S]*?depends_on:[\s\S]*?legacy-init:[\s\S]*?condition: service_completed_successfully/,
	);
	assert.match(
		compose,
		/legacy-api:[\s\S]*?depends_on:[\s\S]*?go-migrate:[\s\S]*?condition: service_completed_successfully/,
	);
	assert.match(
		compose,
		/legacy-init:[\s\S]*?ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE: \/var\/lib\/all-mail-forwarding\/encryption-key/,
	);
	assert.match(entrypoint, /runtime_role" = "init"/);
	assert.doesNotMatch(entrypoint, /runtime_role" = "jobs"|dist\/worker\.js/);
	assert.match(entrypoint, /ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR/);
	assert.match(entrypoint, /automatic db push fallback is disabled/);
});

test("forwarding and retention are independent Go services", async () => {
	const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");
	assert.match(compose, /worker-forwarding:[\s\S]*?command: \["worker", "forwarding"\]/);
	assert.match(compose, /worker-retention:[\s\S]*?command: \["worker", "retention"\]/);
	assert.match(compose, /allmail", "doctor", "worker", "forwarding"/);
	assert.match(compose, /allmail", "doctor", "worker", "retention"/);
	assert.doesNotMatch(compose, /\n  (?:go-jobs|legacy-jobs|jobs):/);
	assert.doesNotMatch(compose, /API_LOG_RETENTION_OWNER|FORWARDING_WORKER_OWNER/);
});

test("long-running compatibility API uses the unprivileged hardened runtime", async () => {
	const [compose, dockerfile, entrypoint] = await Promise.all([
		readFile(path.join(repoRoot, "docker-compose.yml"), "utf8"),
		readFile(path.join(repoRoot, "Dockerfile.legacy"), "utf8"),
		readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8"),
	]);

	assert.match(compose, /x-legacy-runtime:[\s\S]*?user: "10001:10001"/);
	assert.match(compose, /legacy-api:[\s\S]*?<<: \*legacy-runtime/);
	assert.match(dockerfile, /useradd --system --uid 10001/);
	assert.match(dockerfile, /gosu/);
	assert.match(entrypoint, /chown -R 10001:10001 "\$ALL_MAIL_STATE_DIR"/);
	assert.match(entrypoint, /Refusing unsafe ALL_MAIL_STATE_DIR/);
});

test("Prisma and Go agree on forwarding claim lease columns", async () => {
	const [schema, migration] = await Promise.all([
		readFile(path.join(repoRoot, "server/prisma/schema.prisma"), "utf8"),
		readFile(
			path.join(repoRoot, "server/prisma/migrations/202607281200_forwarding_claim_lease_v1/migration.sql"),
			"utf8",
		),
	]);
	assert.match(
		schema,
		/leaseExpiresAt\s+DateTime\?\s+@map\("lease_expires_at"\)\s+@db\.Timestamptz\(3\)/,
	);
	assert.match(migration, /claim_token VARCHAR\(64\)/);
	assert.match(migration, /lease_expires_at TIMESTAMPTZ\(3\)/);
	assert.match(migration, /mailbox_forward_jobs_go_claim_idx/);
});

test("root release scripts have no Node production or rollback topology", async () => {
	const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
	assert.match(packageJson.scripts["install:all"], /cloudflare\/workers\/allmail-edge install/);
	assert.equal(packageJson.scripts["start:npm"], undefined);
	assert.equal(packageJson.scripts["start:npm:jobs"], undefined);
	assert.equal(packageJson.scripts["docker:rollback:jobs"], undefined);
	assert.doesNotMatch(packageJson.scripts["build:web"], /prepare-public/);
	assert.match(packageJson.scripts["verify:release"], /npm run check:go/);
	assert.match(packageJson.scripts["verify:release"], /npm run audit:prod/);
	assert.match(packageJson.scripts["audit:prod"], /node scripts\/run-audit-prod\.mjs/);
	assert.match(packageJson.scripts.check, /npm run verify:release/);
});

test("obsolete Node production runtime files are deleted", async () => {
	for (const relativePath of [
		"scripts/start-all-mail.mjs",
		"scripts/prepare-public.mjs",
		"server/src/worker.ts",
		"server/src/jobs/forwarding.worker.ts",
		"server/src/jobs/api-log-retention.ts",
	]) {
		await assert.rejects(access(path.join(repoRoot, relativePath)), relativePath);
	}
});

test("bootstrap password output stays opt-in and points to the owning legacy volume", async () => {
	const entrypoint = await readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8");
	assert.match(entrypoint, /ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD/);
	assert.match(entrypoint, /Retrieve it from the runtime state file instead of startup logs\./);
	assert.match(entrypoint, /docker compose exec legacy-api/);
});
