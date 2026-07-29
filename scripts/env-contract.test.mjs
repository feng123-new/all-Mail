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

function section(content, start, end) {
	const startIndex = content.indexOf(start);
	assert.notEqual(startIndex, -1, `missing section ${start}`);
	const endIndex = end ? content.indexOf(end, startIndex + start.length) : content.length;
	return content.slice(startIndex, endIndex === -1 ? content.length : endIndex);
}

test("the production environment has one canonical template", async () => {
	const template = await readFile(path.join(repoRoot, ".env.example"), "utf8");
	const keys = parseEnvKeys(template);

	for (const removed of [
		"GO_API_MODE",
		"ALL_MAIL_ENV",
		"ALL_MAIL_STATE_DIR",
		"ALL_MAIL_PUBLIC_BASE_URL",
		"ALL_MAIL_SECRET_STATE_DIR",
		"GO_JOBS_HEARTBEAT_SECONDS",
		"GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS",
		"APP_INTERNAL_PORT",
		"LEGACY_API_INTERNAL_PORT",
		"POSTGRES_PUBLISH_HOST",
		"POSTGRES_PORT",
		"POSTGRES_INTERNAL_PORT",
		"REDIS_PUBLISH_HOST",
		"REDIS_PORT",
		"REDIS_INTERNAL_PORT",
		"CORS_ORIGIN",
	]) {
		assert.equal(keys.includes(removed), false, `${removed} remains in .env.example`);
	}
	assert.equal(keys.includes("TRUSTED_PROXY_CIDRS"), true);
	assert.equal(keys.includes("WORKER_HEARTBEAT_SECONDS"), true);
	assert.equal(keys.includes("WORKER_HEARTBEAT_MAX_AGE_SECONDS"), true);
	await assert.rejects(access(path.join(repoRoot, ".env.cloudflare.example")));
	await assert.rejects(access(path.join(repoRoot, ".env.basic.example")));
});

test("production keeps databases private and development publishes them explicitly", async () => {
	const [compose, devCompose] = await Promise.all([
		readFile(path.join(repoRoot, "docker-compose.yml"), "utf8"),
		readFile(path.join(repoRoot, "docker-compose.dev.yml"), "utf8"),
	]);
	assert.match(compose, /\$\{APP_PUBLISH_HOST:-127\.0\.0\.1\}:\$\{APP_PORT:-3002\}:3000/);
	assert.doesNotMatch(section(compose, "\n  postgres:", "\nnetworks:"), /\n\s+ports:/);
	assert.doesNotMatch(section(compose, "\n  redis:", "\n  postgres:"), /\n\s+ports:/);
	assert.match(devCompose, /127\.0\.0\.1:\$\{DEV_POSTGRES_PORT:-15433\}:5432/);
	assert.match(devCompose, /127\.0\.0\.1:\$\{DEV_REDIS_PORT:-6380\}:6379/);
});

test("bootstrap, API, gateway, and workers receive only their owned configuration", async () => {
	const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");
	const init = section(compose, "\n  legacy-init:", "\n  go-migrate:");
	const app = section(compose, "\n  app:", "\n  worker-forwarding:");
	const forwarding = section(compose, "\n  worker-forwarding:", "\n  worker-retention:");

	assert.doesNotMatch(init, /\n\s+redis:\n|REDIS_URL/);
	assert.doesNotMatch(app, /DATABASE_URL|REDIS_URL|GO_API_MODE|ALL_MAIL_ENV/);
	assert.match(app, /TRUSTED_PROXY_CIDRS/);
	assert.match(forwarding, /ENCRYPTION_KEY_FILE: \/var\/lib\/all-mail\/encryption-key/);
	assert.doesNotMatch(forwarding, /\n\s+ENCRYPTION_KEY:/);
	assert.doesNotMatch(compose, /GO_JOBS_HEARTBEAT_SECONDS|GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS|ALL_MAIL_SECRET_STATE_DIR/);
});

test("forwarding and retention remain independent Go services", async () => {
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

test("root release scripts expose no parallel production topology or legacy peer flags", async () => {
	const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
	const dockerfile = await readFile(path.join(repoRoot, "Dockerfile"), "utf8");
	assert.equal(packageJson.files, undefined);
	assert.equal(packageJson.scripts["start:npm"], undefined);
	assert.equal(packageJson.scripts["start:npm:jobs"], undefined);
	assert.equal(packageJson.scripts["docker:rollback:jobs"], undefined);
	assert.doesNotMatch(packageJson.scripts["install:web"], /legacy-peer-deps/);
	assert.doesNotMatch(packageJson.scripts["install:all"], /legacy-peer-deps/);
	assert.doesNotMatch(dockerfile, /legacy-peer-deps|ALL_MAIL_ENV/);
	assert.match(packageJson.scripts["verify:release"], /npm run check:go/);
	assert.match(packageJson.scripts["verify:release"], /npm run audit:prod/);
});

test("obsolete Node production runtime files remain deleted", async () => {
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
