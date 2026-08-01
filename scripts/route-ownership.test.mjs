import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");
const supportedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function methodSet(route) {
	return new Set((route.methods || []).map((method) => method.toUpperCase()));
}

function methodsOverlap(left, right) {
	if (left.size === 0 || right.size === 0) return true;
	return [...left].some((method) => right.has(method));
}

test("the method-aware route ownership manifest covers every runtime namespace", async () => {
	const [manifest, businessServer, gateway, dockerfile, compose] = await Promise.all([
		read("config/route-ownership.json").then(JSON.parse),
		read("core/internal/businessapi/server.go"),
		read("core/internal/httpapi/server.go"),
		read("Dockerfile"),
		read("docker-compose.yml"),
	]);

	assert.equal(manifest.version, 3);
	assert.ok(Array.isArray(manifest.routes));
	assert.ok(manifest.routes.length >= 45);

	const ids = new Set();
	const matcherGroups = new Map();
	for (const route of manifest.routes) {
		assert.match(route.id, /^[a-z0-9][a-z0-9-]*$/);
		assert.ok(["go", "go-business-api"].includes(route.owner), route.id);
		assert.ok(["exact", "prefix", "fallback"].includes(route.match), route.id);
		assert.equal(route.migrationStage, "complete", route.id);
		assert.equal(route.targetOwner, undefined, route.id);
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

	for (const [routePath, family, owner] of [
		["/health", "system-health", "go"],
		["/livez", "system-liveness", "go"],
		["/readyz", "system-readiness", "go"],
		["/metrics", "system-metrics", "go"],
		["/admin", "admin-other", "go-business-api"],
		["/api", "external-api", "go-business-api"],
		["/mail/api", "mailbox-portal", "go-business-api"],
		["/ingress", "ingress-other", "go-business-api"],
		["/oauth", "oauth-compatibility", "go-business-api"],
	]) {
		const route = manifest.routes.find((candidate) => candidate.path === routePath);
		assert.equal(route?.id, family);
		assert.equal(route?.owner, owner);
	}

	for (const registration of [
		"registerAuthenticationRoutes",
		"registerMailboxAuthenticationRoutes",
		"registerMailboxPortalReadRoutes",
		"registerDashboardWriteRoutes",
		"registerDomainManagementRoutes",
		"registerDomainMessageRoutes",
		"registerDomainMessageTextRoutes",
		"registerForwardingJobRoutes",
		"registerAPIKeyRoutes",
		"registerExternalRoutes",
		"registerIngressRoutes",
		"registerAdminManagementRoutes",
		"registerEmailGroupManagementRoutes",
		"registerDomainMailboxManagementRoutes",
		"registerMailboxUserManagementRoutes",
		"registerMailAccountRoutes",
		"registerOAuthRoutes",
		"registerSendRoutes",
	]) {
		assert.match(businessServer, new RegExp(`s\\.${registration}\\(mux\\)`), registration);
	}

	const fallback = manifest.routes.filter((route) => route.match === "fallback");
	assert.deepEqual(fallback, [{
		id: "spa",
		owner: "go",
		match: "fallback",
		path: "/",
		migrationStage: "complete",
	}]);

	assert.doesNotMatch(gateway, /X-All-Mail-Migration-Bridge/);
	assert.doesNotMatch(gateway, /\bOwnerBusinessAPI\b|(?<!GO_)BUSINESS_API_URL/);
	assert.match(gateway, /OwnerGoBusinessAPI/);
	assert.match(gateway, /GO_BUSINESS_API_URL/);
	assert.match(dockerfile, /COPY config\/route-ownership\.json \/app\/config\/route-ownership\.json/);
	assert.match(dockerfile, /ALL_MAIL_ROUTE_OWNERSHIP_FILE=\/app\/config\/route-ownership\.json/);
	assert.match(compose, /go-business-api:/);
	assert.doesNotMatch(compose, /\n[ ]{2}business-(?:api|init):/);
	assert.match(compose, /GO_BUSINESS_API_URL: http:\/\/go-business-api:3200/);
	assert.doesNotMatch(compose.match(/\n[ ]{2}app:[\s\S]*?\n[ ]{2}go-business-api:/)?.[0] || "", /DATABASE_URL|JWT_SECRET_FILE/);
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
