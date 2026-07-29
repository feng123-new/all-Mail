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
		"DOMAIN_BOOTSTRAP_ADMIN_USERNAME",
		"DOMAIN_BOOTSTRAP_ADMIN_PASSWORD",
		"ADMIN_2FA_SECRET",
	]) {
		assert.equal(keys.includes(removed), false, `${removed} remains in .env.example`);
	}
	assert.equal(keys.includes("TRUSTED_PROXY_CIDRS"), true);
	assert.equal(keys.includes("ADMIN_USERNAME"), true);
	assert.equal(keys.includes("ADMIN_PASSWORD"), true);
	assert.equal(keys.includes("ADMIN_2FA_WINDOW"), true);
	assert.equal(keys.includes("POSTGRES_PASSWORD"), true);
	assert.match(template, /^POSTGRES_PASSWORD=$/m);
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

test("one-shot bootstrap and long-running API receive disjoint credentials", async () => {
	const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");
	const bootstrapEnvironment = section(compose, "x-bootstrap-environment:", "\nx-api-environment:");
	const apiEnvironment = section(compose, "x-api-environment:", "\nx-allmail-hardening:");
	const init = section(compose, "\n  legacy-init:", "\n  go-migrate:");
	const app = section(compose, "\n  app:", "\n  worker-forwarding:");
	const forwarding = section(compose, "\n  worker-forwarding:", "\n  worker-retention:");

	assert.match(bootstrapEnvironment, /ADMIN_USERNAME:/);
	assert.match(bootstrapEnvironment, /ADMIN_PASSWORD:/);
	assert.match(bootstrapEnvironment, /BOOTSTRAP_ADMIN_SECRET_FILE: \/var\/lib\/all-mail\/bootstrap-admin\.env/);
	assert.doesNotMatch(bootstrapEnvironment, /DOMAIN_BOOTSTRAP_ADMIN_|ADMIN_2FA_SECRET/);

	assert.doesNotMatch(apiEnvironment, /\n\s+ADMIN_USERNAME:|\n\s+ADMIN_PASSWORD:|DOMAIN_BOOTSTRAP_ADMIN_|ADMIN_2FA_SECRET/);
	assert.match(apiEnvironment, /BOOTSTRAP_ADMIN_SECRET_FILE: \/var\/lib\/all-mail\/bootstrap-admin\.env/);
	assert.match(apiEnvironment, /ADMIN_2FA_WINDOW:/);

	assert.doesNotMatch(init, /\n\s+redis:\n|REDIS_URL/);
	assert.doesNotMatch(app, /DATABASE_URL|REDIS_URL|GO_API_MODE|ALL_MAIL_ENV/);
	assert.match(app, /TRUSTED_PROXY_CIDRS/);
	assert.match(forwarding, /ENCRYPTION_KEY_FILE: \/var\/lib\/all-mail-secrets\/encryption-key/);
	assert.match(forwarding, /forwarding_runtime_data:\/var\/lib\/all-mail-secrets:ro/);
	assert.doesNotMatch(forwarding, /\n\s+ENCRYPTION_KEY:/);
	assert.doesNotMatch(compose, /GO_JOBS_HEARTBEAT_SECONDS|GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS|ALL_MAIL_SECRET_STATE_DIR/);
});

test("administrator bootstrap runs only after Prisma migration in legacy-init", async () => {
	const [entrypoint, processRuntime, authService] = await Promise.all([
		readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8"),
		readFile(path.join(repoRoot, "server/src/runtime/processes.ts"), "utf8"),
		readFile(path.join(repoRoot, "server/src/modules/auth/auth.service.ts"), "utf8"),
	]);

	const migrationIndex = entrypoint.indexOf("run_legacy_migrations");
	const bootstrapIndex = entrypoint.lastIndexOf("node dist/runtime/bootstrapAdmin.js");
	assert.ok(migrationIndex !== -1 && bootstrapIndex > migrationIndex);
	assert.doesNotMatch(processRuntime, /ensureBootstrapAdmin|bootstrapAdministrator/);
	assert.doesNotMatch(
		authService,
		/ensureBootstrapAdmin|createBootstrapAdmin|adminId === 0|legacyEnv|env\.ADMIN_USERNAME|env\.ADMIN_PASSWORD|process\.env\.ADMIN_USERNAME|process\.env\.ADMIN_PASSWORD/,
	);
	assert.match(authService, /BOOTSTRAP_ADMIN_SECRET_FILE/);
});

test("runtime and one-time administrator secrets use separate files", async () => {
	const [secretScript, entrypoint, ciWorkflow] = await Promise.all([
		readFile(path.join(repoRoot, "scripts/bootstrap-secrets.mjs"), "utf8"),
		readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8"),
		readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
	]);
	assert.match(secretScript, /runtime-secrets\.env/);
	assert.match(secretScript, /bootstrap-admin\.env/);
	assert.match(secretScript, /bootstrap-secrets\.env/);
	assert.match(secretScript, /rm\(legacySecretsFile/);
	assert.match(entrypoint, /ALL_MAIL_RUNTIME_SECRETS_FILE/);
	assert.match(entrypoint, /bootstrap_exports=\$\(run_as_allmail/);
	assert.match(entrypoint, /flock -w 30/);
	assert.match(entrypoint, /bootstrap_mode=require-existing/);
	assert.match(entrypoint, /bootstrap_mode=init/);
	assert.match(entrypoint, /--mode "\$bootstrap_mode"/);
	assert.match(entrypoint, /eval "\$bootstrap_exports"/);
	assert.doesNotMatch(entrypoint, /eval "\$\(run_as_allmail/);
	assert.doesNotMatch(entrypoint, /ALL_MAIL_BOOTSTRAP_SECRETS_FILE|ALL_MAIL_MANAGED_BOOTSTRAP_SECRETS/);
	assert.match(ciWorkflow, /test -r \/var\/lib\/all-mail\/runtime-secrets\.env/);
	assert.match(ciWorkflow, /test -r \/var\/lib\/all-mail\/bootstrap-admin\.env/);
	assert.match(ciWorkflow, /test ! -e \/var\/lib\/all-mail\/bootstrap-secrets\.env/);
	assert.doesNotMatch(ciWorkflow, /test -r \/var\/lib\/all-mail\/bootstrap-secrets\.env/);
});

test("forwarding and retention remain independent Go services", async () => {
	const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");
	assert.match(compose, /worker-forwarding:[\s\S]*?command: \["worker", "forwarding"\]/);
	assert.match(compose, /worker-retention:[\s\S]*?command: \["worker", "retention"\]/);
	assert.match(compose, /allmail", "doctor", "worker", "forwarding"/);
	assert.match(compose, /allmail", "doctor", "worker", "retention"/);
	assert.doesNotMatch(compose, /\n[ ]{2}(?:go-jobs|legacy-jobs|jobs):/);
	assert.doesNotMatch(compose, /retention_runtime_data/);
	assert.match(compose, /ALL_MAIL_STATE_DIR: \/tmp\/all-mail/);
});

test("long-running compatibility API uses the unprivileged hardened runtime", async () => {
	const [compose, dockerfile, entrypoint] = await Promise.all([
		readFile(path.join(repoRoot, "docker-compose.yml"), "utf8"),
		readFile(path.join(repoRoot, "Dockerfile.legacy"), "utf8"),
		readFile(path.join(repoRoot, "docker/entrypoint.sh"), "utf8"),
	]);
	assert.match(compose, /x-legacy-runtime:[\s\S]*?user: "10001:10001"/);
	assert.match(compose, /x-legacy-long-runtime:[\s\S]*?<<: \*legacy-runtime/);
	assert.match(compose, /legacy-api:[\s\S]*?<<: \*legacy-long-runtime/);
	assert.match(dockerfile, /useradd --system --uid 10001/);
	assert.match(dockerfile, /gosu/);
	assert.match(entrypoint, /chown -R 10001:10001 "\$ALL_MAIL_STATE_DIR"/);
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

test("operator documentation uses canonical worker paths and redacts runtime secrets", async () => {
	const files = await Promise.all([
		"core/README.md",
		"docs/DEPLOY.md",
		"docs/RUNBOOK.md",
		"docs/GO-MIGRATION.md",
	].map((relativePath) => readFile(path.join(repoRoot, relativePath), "utf8")));
	const combined = files.join("\n");
	assert.doesNotMatch(combined, /\/var\/lib\/all-mail\/encryption-key/);
	assert.doesNotMatch(combined, /\/var\/lib\/all-mail\/worker-forwarding-heartbeat\.json/);
	assert.doesNotMatch(combined, /cat\s+\/var\/lib\/all-mail\/runtime-secrets\.env/);
	assert.match(combined, /\/var\/lib\/all-mail-secrets\/encryption-key/);
	assert.match(combined, /\/tmp\/all-mail\/worker-forwarding-heartbeat\.json/);
	assert.match(combined, /runtime-secrets\.env[\s\S]*?<redacted>/);
});

test("compatibility API omits retired direct dependencies", async () => {
	const packageJson = JSON.parse(await readFile(path.join(repoRoot, "server/package.json"), "utf8"));
	for (const removed of [
		"@fastify/rate-limit",
		"@fastify/static",
		"@fastify/swagger",
		"@fastify/swagger-ui",
		"pg",
	]) {
		assert.equal(packageJson.dependencies[removed], undefined, `${removed} remains a direct production dependency`);
	}
	assert.equal(packageJson.dependencies["pino-pretty"], undefined);
	assert.equal(typeof packageJson.devDependencies["pino-pretty"], "string");
	assert.equal(packageJson.devDependencies["@types/pg"], undefined);
});
