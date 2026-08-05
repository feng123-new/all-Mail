import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "scripts", "backup-restore-rehearsal.sh");

test("restore rehearsal is destructive only inside an explicitly isolated CI project", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /ALL_MAIL_ALLOW_DESTRUCTIVE_REHEARSAL/);
  assert.match(source, /CI:-/);
  assert.match(source, /\*rehearsal\*/);
  assert.doesNotMatch(source, /docker compose down -v/);

  const denied = spawnSync("bash", [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ALL_MAIL_ALLOW_DESTRUCTIVE_REHEARSAL: "0" },
  });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /requires ALL_MAIL_ALLOW_DESTRUCTIVE_REHEARSAL=1/);
});

test("restore rehearsal preserves the complete local state set and verifies acceptance", async () => {
  const source = await readFile(scriptPath, "utf8");
  for (const volume of [
    "legacy_runtime_data",
    "bootstrap_admin_data",
    "forwarding_runtime_data",
    "go_business_runtime_data",
    "redis_runtime_data",
    "database_runtime_data",
    "redis_data",
    "postgres_data",
  ]) {
    assert.match(source, new RegExp(volume));
  }
  for (const operation of [
    "pg_dump",
    "pg_restore --list",
    "pg_restore -U",
    "sha256sum --check",
    "docker volume rm",
    "docker volume create",
    "allmail doctor api",
    "allmail doctor business-api",
    "ci-delivery",
    "ci-go-key",
    "restore-rehearsal-report.txt",
  ]) {
    assert.match(source, new RegExp(operation.replaceAll(" ", "\\s+")));
  }
  assert.match(source, /jwt-secret-preserved=true/);
  assert.match(source, /encryption-key-preserved=true/);
  assert.match(source, /bootstrap-credential-retired=true/);
});
