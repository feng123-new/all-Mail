import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("legacy implicit-all API keys are backfilled before fail-closed runtimes start", async () => {
	const [migration, compose] = await Promise.all([
		read("server/prisma/migrations/20260731_api_key_explicit_permissions/migration.sql"),
		read("docker-compose.yml"),
	]);
	assert.match(migration, /UPDATE api_keys/);
	assert.match(migration, /permissions = '\{"all": true\}'::jsonb/);
	assert.match(migration, /permissions IS NULL/);
	assert.match(migration, /permissions = '\{\}'::jsonb/);
	assert.match(compose, /business-init:[\s\S]*go-migrate:[\s\S]*business-api:/);
});

test("both active API-key implementations deny missing permissions", async () => {
	const [goPermissions, nodePermissions, nodeSchema] = await Promise.all([
		read("core/internal/businessapi/api_permissions.go"),
		read("server/src/plugins/api-permissions.ts"),
		read("server/src/modules/api-key/apiKey.schema.ts"),
	]);
	assert.match(goPermissions, /if len\(permissions\) == 0 \{\s*return false/);
	assert.match(nodePermissions, /Object\.keys\(permissions\)\.length === 0\) \{\s*return false/);
	assert.match(nodeSchema, /permissions: permissionsSchema,/);
	assert.match(nodeSchema, /At least one permission must be enabled/);
});
