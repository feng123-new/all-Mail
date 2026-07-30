import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function routePrefixValues(source) {
	return Array.from(source.matchAll(/^\s+[A-Za-z0-9_]+:\s*'([^']+)'/gm), (match) => match[1]);
}

test("the route ownership manifest covers every Fastify namespace and gateway route", async () => {
	const [manifest, prefixes, gateway, dockerfile] = await Promise.all([
		read("config/route-ownership.json").then(JSON.parse),
		read("server/src/routes/prefixes.ts"),
		read("core/internal/httpapi/server.go"),
		read("Dockerfile"),
	]);

	assert.equal(manifest.version, 1);
	assert.ok(Array.isArray(manifest.routes));
	assert.ok(manifest.routes.length >= 20);

	const ids = new Set();
	const matcherKeys = new Set();
	for (const route of manifest.routes) {
		assert.match(route.id, /^[a-z0-9][a-z0-9-]*$/);
		assert.ok(["go", "business-api"].includes(route.owner), route.id);
		assert.ok(["exact", "prefix", "fallback"].includes(route.match), route.id);
		assert.ok(!ids.has(route.id), `duplicate route id ${route.id}`);
		ids.add(route.id);
		const matcherKey = `${route.match}:${route.path}`;
		assert.ok(!matcherKeys.has(matcherKey), `duplicate route matcher ${matcherKey}`);
		matcherKeys.add(matcherKey);
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

	const dashboard = manifest.routes.find((route) => route.id === "admin-dashboard");
	assert.equal(dashboard?.owner, "business-api");
	assert.equal(dashboard?.migrationStage, "observing");
	assert.equal(dashboard?.targetOwner, "go");

	const fallback = manifest.routes.filter((route) => route.match === "fallback");
	assert.deepEqual(fallback, [{
		id: "spa",
		owner: "go",
		match: "fallback",
		path: "/",
		migrationStage: "complete",
	}]);

	assert.doesNotMatch(gateway, /X-All-Mail-Migration-Bridge/);
	assert.doesNotMatch(gateway, /prefixes\s*:=\s*\[\]string\{/);
	assert.match(gateway, /routeownership\.LoadDefault\(\)/);
	assert.match(dockerfile, /COPY config\/route-ownership\.json \/app\/config\/route-ownership\.json/);
	assert.match(dockerfile, /ALL_MAIL_ROUTE_OWNERSHIP_FILE=\/app\/config\/route-ownership\.json/);
});

test("active documentation points to the route ownership contract", async () => {
	const [index, migration, roadmap] = await Promise.all([
		read("docs/README.md"),
		read("docs/GO-MIGRATION.md"),
		read("docs/internal/runtime-migration-roadmap.md"),
	]);
	for (const content of [index, migration, roadmap]) {
		assert.match(content, /ROUTE-OWNERSHIP\.md|route ownership manifest|route-family/i);
	}
});
