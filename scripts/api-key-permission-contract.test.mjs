import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("legacy implicit-all API keys are backfilled before fail-closed runtimes start", async () => {
	const [migration, compose, startup] = await Promise.all([
		read("core/internal/schema/migrations/20260731_api_key_explicit_permissions.sql"),
		read("docker-compose.yml"),
		read("scripts/compose-up.sh"),
	]);
	assert.match(migration, /UPDATE api_keys/);
	assert.match(migration, /permissions = '\{"all": true\}'::jsonb/);
	assert.match(migration, /permissions IS NULL/);
	assert.match(migration, /permissions = '\{\}'::jsonb/);
	assert.doesNotMatch(compose, /\n[ ]{2}business-init:/);
	assert.doesNotMatch(compose, /\n[ ]{2}go-migrate:/);
	assert.match(startup, /run\s+--rm\s+--no-deps[\s\S]*app init/);
});

test("the Go API-key implementation denies missing permissions", async () => {
	const [goPermissions, requestPermissions] = await Promise.all([
		read("core/internal/businessapi/api_permissions.go"),
		read("core/internal/businessapi/api_key_request_permissions.go"),
	]);
	assert.match(goPermissions, /if len\(permissions\) == 0 \{\s*return false/);
	assert.match(requestPermissions, /!present \|\| len\(permissions\) == 0 \|\| isJSONNull\(permissions\)/);
});
