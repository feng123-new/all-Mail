import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

const expectedLongRunning = [
	"app",
	"go-business-api",
	"business-api",
	"worker-forwarding",
	"worker-retention",
	"postgres",
	"redis",
];

const expectedOneShot = ["business-init"];

function composeServices(compose) {
	const servicesStart = compose.indexOf("\nservices:\n");
	const networksStart = compose.indexOf("\nnetworks:\n", servicesStart);
	assert.ok(servicesStart >= 0 && networksStart > servicesStart, "Compose services section is missing");
	return compose
		.slice(servicesStart, networksStart)
		.split(/\r?\n/)
		.map((line) => /^  ([a-z0-9-]+):\s*$/.exec(line)?.[1])
		.filter(Boolean);
}

function assertMentionsEvery(content, values, label) {
	for (const value of values) {
		assert.match(content, new RegExp(`(?:^|[^a-z0-9-])${value.replaceAll("-", "\\-")}(?:$|[^a-z0-9-])`, "im"), `${label} omits ${value}`);
	}
}

test("operator documentation matches the canonical Compose topology", async () => {
	const [compose, deploy, runbook, environment, release] = await Promise.all([
		read("docker-compose.yml"),
		read("docs/DEPLOY.md"),
		read("docs/RUNBOOK.md"),
		read("docs/ENVIRONMENT.md"),
		read("docs/open-source-release-checklist.md"),
	]);

	const services = composeServices(compose);
	for (const service of [...expectedLongRunning, ...expectedOneShot]) {
		assert.ok(services.includes(service), `Compose omits ${service}`);
	}
	for (const document of [deploy, runbook, release]) {
		assertMentionsEvery(document, expectedLongRunning, "operator documentation");
		assertMentionsEvery(document, expectedOneShot, "operator documentation");
	}

	assert.match(environment, /GO_BUSINESS_API_URL=http:\/\/go-business-api:3200/);
	assert.match(environment, /JWT_SECRET_FILE=\/var\/lib\/all-mail-secrets\/jwt-secret/);
	assert.match(`${runbook}\n${environment}`, /go_business_runtime_data/);
});

test("all runtime doctors and private network checks are documented", async () => {
	const [deploy, runbook, release] = await Promise.all([
		read("docs/DEPLOY.md"),
		read("docs/RUNBOOK.md"),
		read("docs/open-source-release-checklist.md"),
	]);
	const combined = [deploy, runbook, release].join("\n");
	for (const command of [
		"docker compose exec -T app allmail doctor api",
		"docker compose exec -T go-business-api allmail doctor business-api",
		"docker compose exec -T worker-forwarding allmail doctor worker forwarding",
		"docker compose exec -T worker-retention allmail doctor worker retention",
	]) {
		assert.match(combined, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	for (const privatePort of [
		"! docker compose port go-business-api 3200",
		"! docker compose port business-api 3100",
		"! docker compose port postgres 5432",
		"! docker compose port redis 6379",
	]) {
		assert.match(combined, new RegExp(privatePort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
});

test("documentation describes aggregate readiness and source-available licensing truthfully", async () => {
	const [deploy, runbook, release, license] = await Promise.all([
		read("docs/DEPLOY.md"),
		read("docs/RUNBOOK.md"),
		read("docs/open-source-release-checklist.md"),
		read("LICENSE"),
	]);
	const operatorDocs = `${deploy}\n${runbook}`;
	assert.match(operatorDocs, /requires[\s\S]*(?:go-business-api|private Go business)[\s\S]*business-api/i);
	assert.doesNotMatch(operatorDocs, /checks the built SPA and Fastify readiness/i);
	assert.match(release, /source-available/i);
	assert.match(release, /not distributed under an OSI-approved open-source license/i);
	assert.match(license, /You may not use the Software for commercial purposes/i);
});
