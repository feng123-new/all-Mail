import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function parseEnvKeys(content) {
	return content.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#") && line.includes("="))
		.map((line) => line.slice(0, line.indexOf("=")).trim())
		.sort();
}

function section(content, start, end) {
	const startIndex = content.indexOf(start);
	assert.notEqual(startIndex, -1, `missing section ${start}`);
	const endIndex = end ? content.indexOf(end, startIndex + start.length) : -1;
	return content.slice(startIndex, endIndex < 0 ? content.length : endIndex);
}

test("the production template matches the canonical manifest", async () => {
	const [template, active, retired] = await Promise.all([
		read(".env.example"),
		read("config/runtime-env.json").then(JSON.parse),
		read("config/retired-env.json").then(JSON.parse),
	]);
	const keys = parseEnvKeys(template);
	assert.deepEqual(keys, active.variables.map(({ name }) => name).sort());
	for (const name of retired.variables) assert.equal(keys.includes(name), false, name);
	assert.match(template, /^POSTGRES_PASSWORD=$/m);
	assert.match(template, /^INGRESS_IMPORT_KEY_ID=allmail-edge-main$/m);
	await assert.rejects(access(path.join(repoRoot, ".env.cloudflare.example")));
	await assert.rejects(access(path.join(repoRoot, ".env.basic.example")));
});

test("Compose keeps infrastructure private and compatibility imports initializer-only", async () => {
	const [compose, devCompose] = await Promise.all([read("docker-compose.yml"), read("docker-compose.dev.yml")]);
	assert.match(compose, /\$\{APP_PUBLISH_HOST:-127\.0\.0\.1\}:\$\{APP_PORT:-3002\}:3000/);
	assert.doesNotMatch(section(compose, "\n  postgres:", "\nnetworks:"), /\n\s+ports:/);
	assert.doesNotMatch(section(compose, "\n  redis:", "\n  postgres:"), /\n\s+ports:/);
	assert.match(devCompose, /DEV_POSTGRES_PORT:-15433/);
	assert.match(devCompose, /DEV_REDIS_PORT:-6380/);

	const bootstrap = section(compose, "x-bootstrap-environment:", "\nx-api-environment:");
	const api = section(compose, "x-api-environment:", "\nx-allmail-hardening:");
	const app = section(compose, "\n  app:", "\n  worker-forwarding:");
	const forwarding = section(compose, "\n  worker-forwarding:", "\n  worker-retention:");
	assert.match(bootstrap, /ADMIN_USERNAME:[\s\S]*ADMIN_PASSWORD:/);
	for (const name of [
		"SEND_ENABLED_DOMAINS", "INGRESS_SIGNING_SECRET", "INGRESS_IMPORT_KEY_ID",
		"GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
		"MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET",
	]) assert.match(bootstrap, new RegExp(`\\n\\s+${name}:`), name);
	for (const name of [
		"ADMIN_USERNAME", "ADMIN_PASSWORD", "SEND_ENABLED_DOMAINS", "INGRESS_SIGNING_SECRET",
		"INGRESS_IMPORT_KEY_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
		"MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET",
	]) assert.doesNotMatch(api, new RegExp(`\\n\\s+${name}:`), name);
	assert.doesNotMatch(app, /DATABASE_URL|REDIS_URL|GO_API_MODE|ALL_MAIL_ENV/);
	assert.match(forwarding, /ENCRYPTION_KEY_FILE: \/var\/lib\/all-mail-secrets\/encryption-key/);
	assert.doesNotMatch(forwarding, /\n\s+ENCRYPTION_KEY:/);
	assert.match(compose, /command: \["worker", "forwarding"\]/);
	assert.match(compose, /command: \["worker", "retention"\]/);
	assert.doesNotMatch(compose, /\n[ ]{2}(?:go-jobs|legacy-jobs|jobs):|retention_runtime_data/);
});

test("administrator bootstrap, config import, and secret files remain one-shot", async () => {
	const [entrypoint, processes, auth, secretScript, ci] = await Promise.all([
		read("docker/entrypoint.sh"), read("server/src/runtime/processes.ts"),
		read("server/src/modules/auth/auth.service.ts"), read("scripts/bootstrap-secrets.mjs"),
		read(".github/workflows/ci.yml"),
	]);
	const migrationIndex = entrypoint.indexOf("run_legacy_migrations");
	const importIndex = entrypoint.indexOf("npm run config:import-env");
	const bootstrapIndex = entrypoint.lastIndexOf("node dist/runtime/bootstrapAdmin.js");
	assert.ok(migrationIndex >= 0 && importIndex > migrationIndex && bootstrapIndex > importIndex);
	assert.doesNotMatch(processes, /ensureBootstrapAdmin|bootstrapAdministrator/);
	assert.doesNotMatch(auth, /createBootstrapAdmin|adminId === 0|legacyEnv|env\.ADMIN_USERNAME|env\.ADMIN_PASSWORD/);
	assert.match(auth, /BOOTSTRAP_ADMIN_SECRET_FILE/);
	assert.match(secretScript, /runtime-secrets\.env[\s\S]*bootstrap-admin\.env[\s\S]*bootstrap-secrets\.env/);
	assert.match(entrypoint, /bootstrap_mode=require-existing[\s\S]*bootstrap_mode=init/);
	assert.match(ci, /test -r \/var\/lib\/all-mail\/runtime-secrets\.env/);
	assert.match(ci, /test ! -e \/var\/lib\/all-mail\/bootstrap-secrets\.env/);
});

test("long-running business code no longer reads imported environment settings", async () => {
	const [serverTemplate, envLoader, oauthService, domainService, ingressAuth] = await Promise.all([
		read("server/.env.example"), read("server/src/config/env.ts"),
		read("server/src/modules/email/email.oauth-config.service.ts"),
		read("server/src/modules/domain/domain.service.ts"), read("server/src/plugins/auth.ts"),
	]);
	for (const name of [
		"SEND_ENABLED_DOMAINS", "INGRESS_SIGNING_SECRET", "GOOGLE_OAUTH_CLIENT_ID",
		"GOOGLE_OAUTH_CLIENT_SECRET", "MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET",
	]) {
		assert.doesNotMatch(serverTemplate, new RegExp(`^${name}=`, "m"), name);
		assert.doesNotMatch(envLoader, new RegExp(name), name);
	}
	assert.doesNotMatch(oauthService, /process\.env|env\.(?:GOOGLE|MICROSOFT)_OAUTH/);
	assert.doesNotMatch(domainService, /SEND_ENABLED_DOMAINS|DOMAIN_SEND_NOT_ALLOWED/);
	assert.doesNotMatch(ingressAuth, /env\.INGRESS_SIGNING_SECRET/);
	assert.match(ingressAuth, /signing_secret_encrypted/);
});

test("production images and root scripts retain the hardened topology", async () => {
	const [compose, dockerfile, legacyDockerfile, entrypoint, packageJson] = await Promise.all([
		read("docker-compose.yml"), read("Dockerfile"), read("Dockerfile.legacy"), read("docker/entrypoint.sh"),
		read("package.json").then(JSON.parse),
	]);
	assert.match(compose, /x-legacy-runtime:[\s\S]*?user: "10001:10001"/);
	assert.match(legacyDockerfile, /FROM node:24-bookworm-slim[\s\S]*useradd --system --uid 10001[\s\S]*gosu/);
	assert.match(dockerfile, /FROM node:24-bookworm-slim/);
	assert.match(entrypoint, /chown -R 10001:10001 "\$ALL_MAIL_STATE_DIR"/);
	assert.equal(packageJson.files, undefined);
	for (const name of ["start:npm", "start:npm:jobs", "docker:rollback:jobs"]) assert.equal(packageJson.scripts[name], undefined);
	assert.doesNotMatch(packageJson.scripts["install:all"], /legacy-peer-deps/);
	assert.match(packageJson.scripts["verify:release"], /npm run check:go[\s\S]*npm run audit:prod/);
});

test("obsolete runtime files remain deleted", async () => {
	for (const relativePath of [
		"scripts/start-all-mail.mjs", "scripts/prepare-public.mjs", "server/src/worker.ts",
		"server/src/jobs/forwarding.worker.ts", "server/src/jobs/api-log-retention.ts",
	]) await assert.rejects(access(path.join(repoRoot, relativePath)), relativePath);
});

test("operator documentation uses canonical paths and redacts secrets", async () => {
	const combined = (await Promise.all([
		"core/README.md", "docs/DEPLOY.md", "docs/RUNBOOK.md", "docs/GO-MIGRATION.md",
	].map(read))).join("\n");
	assert.doesNotMatch(
		combined,
		/\/var\/lib\/all-mail\/encryption-key|\/var\/lib\/all-mail\/worker-forwarding-heartbeat\.json|cat\s+\/var\/lib\/all-mail\/runtime-secrets\.env/,
	);
	assert.match(combined, /\/var\/lib\/all-mail-secrets\/encryption-key/);
	assert.match(combined, /\/tmp\/all-mail\/worker-forwarding-heartbeat\.json/);
	assert.match(combined, /runtime-secrets\.env[\s\S]*?<redacted>/);
});

test("compatibility API omits retired direct dependencies", async () => {
	const pkg = JSON.parse(await read("server/package.json"));
	for (const name of ["@fastify/rate-limit", "@fastify/static", "@fastify/swagger", "@fastify/swagger-ui", "pg"])
		assert.equal(pkg.dependencies[name], undefined, name);
	assert.equal(pkg.dependencies["pino-pretty"], undefined);
	assert.equal(typeof pkg.devDependencies["pino-pretty"], "string");
	assert.equal(pkg.devDependencies["@types/pg"], undefined);
});

test("local tooling has no retired fallback and proxies every namespace", async () => {
	const [ingress, cli, vite] = await Promise.all([
		read("server/scripts/ensure-ingress-endpoint.ts"), read("bin/all-mail.mjs"), read("web/vite.config.ts"),
	]);
	assert.doesNotMatch(ingress, /process\.env\.POSTGRES_PORT|entries\.get\(["']POSTGRES_PORT["']\)|allmail_dev_password/);
	assert.doesNotMatch(cli, /ALL_MAIL_ENV_FILE|POSTGRES_HOST|REDIS_HOST/);
	for (const prefix of ["/admin", "/api", "/mail", "/ingress", "/oauth"])
		assert.match(vite, new RegExp(`['\"]${prefix}['\"]`));
});
