import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");
const supportedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function routePrefixValues(source) {
	return Array.from(source.matchAll(/^\s+[A-Za-z0-9_]+:\s*'([^']+)'/gm), (match) => match[1]);
}

function methodSet(route) {
	return new Set((route.methods || []).map((method) => method.toUpperCase()));
}

function methodsOverlap(left, right) {
	if (left.size === 0 || right.size === 0) return true;
	return [...left].some((method) => right.has(method));
}

test("the method-aware route ownership manifest covers every runtime namespace", async () => {
	const [manifest, prefixes, app, gateway, dockerfile, compose] = await Promise.all([
		read("config/route-ownership.json").then(JSON.parse),
		read("server/src/routes/prefixes.ts"),
		read("server/src/app.ts"),
		read("core/internal/httpapi/server.go"),
		read("Dockerfile"),
		read("docker-compose.yml"),
	]);

	assert.equal(manifest.version, 2);
	assert.ok(Array.isArray(manifest.routes));
	assert.ok(manifest.routes.length >= 45);

	const ids = new Set();
	const matcherGroups = new Map();
	for (const route of manifest.routes) {
		assert.match(route.id, /^[a-z0-9][a-z0-9-]*$/);
		assert.ok(["go", "go-business-api", "business-api"].includes(route.owner), route.id);
		assert.ok(["exact", "prefix", "fallback"].includes(route.match), route.id);
		assert.ok(!ids.has(route.id), `duplicate route id ${route.id}`);
		ids.add(route.id);

		const methods = methodSet(route);
		for (const method of methods) assert.ok(supportedMethods.has(method), `${route.id}: ${method}`);
		const matcherKey = `${route.match}:${route.path}`;
		const previous = matcherGroups.get(matcherKey) || [];
		for (const candidate of previous) {
			assert.equal(
				methodsOverlap(methodSet(candidate), methods),
				false,
				`ambiguous route matcher ${matcherKey}: ${candidate.id} and ${route.id}`,
			);
		}
		previous.push(route);
		matcherGroups.set(matcherKey, previous);
	}

	const declaredPaths = new Set(manifest.routes.map((route) => route.path));
	for (const prefix of routePrefixValues(prefixes)) {
		assert.ok(declaredPaths.has(prefix), `Fastify prefix ${prefix} is absent from route ownership`);
	}

	for (const [routePath, family] of [
		["/health", "system-health"],
		["/livez", "system-liveness"],
		["/readyz", "system-readiness"],
		["/metrics", "system-metrics"],
	]) {
		const route = manifest.routes.find((candidate) => candidate.path === routePath);
		assert.deepEqual(
			{ id: route?.id, owner: route?.owner, match: route?.match },
			{ id: family, owner: "go", match: "exact" },
		);
	}

	for (const id of [
		"admin-dashboard-stats-read",
		"admin-dashboard-trend-read",
		"admin-dashboard-logs-read",
		"admin-dashboard-log-delete",
		"admin-dashboard-log-batch-delete",
		"admin-administrators",
		"admin-email-groups",
		"admin-emails",
		"admin-oauth",
		"admin-send",
		"admin-domain-mailboxes",
		"admin-mailbox-users",
	]) {
		const route = manifest.routes.find((candidate) => candidate.id === id);
		assert.equal(route?.owner, "go-business-api", id);
		assert.equal(route?.migrationStage, "complete", id);
		assert.equal(route?.targetOwner, undefined, id);
	}
	for (const id of [
		"admin-dashboard-stats-read",
		"admin-dashboard-trend-read",
		"admin-dashboard-logs-read",
	]) {
		const route = manifest.routes.find((candidate) => candidate.id === id);
		assert.deepEqual(route?.methods, ["GET", "HEAD"]);
	}
	const dashboardCatchAll = manifest.routes.find((candidate) => candidate.id === "admin-dashboard-other");
	assert.equal(dashboardCatchAll?.owner, "go-business-api");
	assert.equal(dashboardCatchAll?.migrationStage, "complete");
	assert.equal(dashboardCatchAll?.targetOwner, undefined);

	const apiKeyAdmin = manifest.routes.find((candidate) => candidate.id === "admin-api-keys");
	assert.equal(apiKeyAdmin?.owner, "go-business-api");
	assert.equal(apiKeyAdmin?.migrationStage, "complete");

	for (const id of [
		"ext-email-allocate", "ext-email-list", "ext-email-stats", "ext-email-reset",
		"ext-email-latest", "ext-email-latest-compat", "ext-email-messages", "ext-email-messages-compat",
		"ext-email-clear", "ext-email-clear-compat",
		"domain-email-allocate", "domain-email-latest", "domain-email-list",
		"domain-mailbox-list", "domain-mailbox-stats", "domain-mailbox-reset",
	]) {
		const route = manifest.routes.find((candidate) => candidate.id === id);
		assert.equal(route?.owner, "go-business-api", id);
		assert.equal(route?.migrationStage, "complete", id);
		assert.equal(route?.match, "exact", id);
	}
	for (const id of [
		"ext-email-text", "ext-email-text-compat",
		"domain-message-text", "domain-message-text-compat",
	]) {
		const route = manifest.routes.find((candidate) => candidate.id === id);
		assert.equal(route?.owner, "go-business-api", id);
		assert.equal(route?.migrationStage, "complete", id);
		assert.equal(route?.targetOwner, undefined, id);
		assert.equal(route?.match, "exact", id);
	}

	const ingress = manifest.routes.find((candidate) => candidate.id === "ingress-domain-mail");
	assert.equal(ingress?.owner, "go-business-api");
	assert.equal(ingress?.migrationStage, "complete");
	assert.equal(ingress?.targetOwner, undefined);
	const ingressCatchAll = manifest.routes.find((candidate) => candidate.id === "ingress-other");
	assert.equal(ingressCatchAll?.owner, "go-business-api");
	assert.equal(ingressCatchAll?.migrationStage, "complete");
	assert.equal(ingressCatchAll?.targetOwner, undefined);

	for (const id of [
		"admin-domains", "admin-domain-messages", "admin-forwarding-jobs", "admin-other",
		"external-domain-mail", "external-api", "mailbox-portal", "ingress-other",
		"mailbox-portal-sent-messages", "mailbox-portal-forwarding-jobs",
		"mailbox-portal-send", "mailbox-portal-forwarding",
	]) {
		const route = manifest.routes.find((candidate) => candidate.id === id);
		assert.equal(route?.owner, "go-business-api", id);
		assert.equal(route?.migrationStage, "complete", id);
		assert.equal(route?.targetOwner, undefined, id);
	}

	assert.equal(manifest.routes.some((route) => route.owner === "business-api"), false);
	assert.equal(manifest.routes.some((route) => route.migrationStage !== "complete"), false);

	const oauthCompatibility = manifest.routes.find((candidate) => candidate.id === "oauth-compatibility");
	assert.equal(oauthCompatibility?.owner, "go-business-api");
	assert.equal(oauthCompatibility?.migrationStage, "complete");
	assert.equal(oauthCompatibility?.targetOwner, undefined);

	const fallback = manifest.routes.filter((route) => route.match === "fallback");
	assert.deepEqual(fallback, [{
		id: "spa",
		owner: "go",
		match: "fallback",
		path: "/",
		migrationStage: "complete",
	}]);

	assert.doesNotMatch(prefixes, /legacyOauth/);
	assert.doesNotMatch(app, /legacyOAuth/);
	assert.match(prefixes, /oauthCompatibility:\s*'\/oauth'/);
	assert.match(app, /ROUTE_PREFIXES\.oauthCompatibility/);
	assert.doesNotMatch(gateway, /X-All-Mail-Migration-Bridge/);
	assert.doesNotMatch(gateway, /prefixes\s*:=\s*\[\]string\{/);
	assert.match(gateway, /OwnerGoBusinessAPI/);
	assert.match(gateway, /GO_BUSINESS_API_URL/);
	assert.match(dockerfile, /COPY config\/route-ownership\.json \/app\/config\/route-ownership\.json/);
	assert.match(dockerfile, /ALL_MAIL_ROUTE_OWNERSHIP_FILE=\/app\/config\/route-ownership\.json/);
	assert.match(compose, /go-business-api:/);
	assert.match(compose, /GO_BUSINESS_API_URL: http:\/\/go-business-api:3200/);
	assert.doesNotMatch(compose.match(/app:[\s\S]*?worker-forwarding:/)?.[0] || "", /DATABASE_URL|JWT_SECRET_FILE/);
});

test("active documentation points to route ownership and the private Go service", async () => {
	const [index, migration, roadmap] = await Promise.all([
		read("docs/README.md"),
		read("docs/GO-MIGRATION.md"),
		read("docs/internal/runtime-migration-roadmap.md"),
	]);
	for (const content of [index, migration, roadmap]) {
		assert.match(content, /ROUTE-OWNERSHIP\.md|route ownership manifest|route-family/i);
		assert.match(content, /go-business-api/i);
	}
});
