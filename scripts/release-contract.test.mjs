import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

async function readReleaseFiles() {
  const [version, packageJSON, changelog] = await Promise.all([
    read("VERSION"),
    read("package.json"),
    read("CHANGELOG.md"),
  ]);
  return {
    version: version.trim(),
    packageMetadata: JSON.parse(packageJSON),
    changelog,
  };
}

test("stable release identity is canonical and dated", async () => {
  const { version, packageMetadata, changelog } = await readReleaseFiles();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageMetadata.version, version);
  const escapedVersion = version.replaceAll(".", "\\.");
  assert.match(changelog, new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"));
  assert.match(changelog, new RegExp(`^\\[Unreleased\\]: .*compare\\/v${escapedVersion}\\.\\.\\.HEAD$`, "m"));
  assert.match(changelog, new RegExp(`^\\[${escapedVersion}\\]: .*v${escapedVersion}$`, "m"));
});

test("Go binary and OCI image receive injected release metadata", async () => {
  const [main, buildInfo, dockerfile, compose, helper] = await Promise.all([
    read("core/cmd/allmail/main.go"),
    read("core/internal/buildinfo/buildinfo.go"),
    read("Dockerfile"),
    read("docker-compose.yml"),
    read("scripts/compose-up.sh"),
  ]);

  assert.match(main, /case "version":/);
  assert.match(main, /allmail version --json/);
  for (const field of ["Version", "Commit", "BuildDate"]) {
    assert.match(buildInfo, new RegExp(`${field}\\s+=`));
    assert.match(
      dockerfile,
      new RegExp(`buildinfo\\.${field}=\\$\\{ALL_MAIL_${field === "BuildDate" ? "BUILD_DATE" : field.toUpperCase()}\\}`),
    );
  }
  for (const label of [
    "org.opencontainers.image.version",
    "org.opencontainers.image.revision",
    "org.opencontainers.image.created",
    "org.opencontainers.image.licenses",
  ]) {
    assert.match(dockerfile, new RegExp(label.replaceAll(".", "\\.")));
  }
  for (const name of ["ALL_MAIL_VERSION", "ALL_MAIL_COMMIT", "ALL_MAIL_BUILD_DATE"]) {
    assert.ok(
      compose.includes(name + ": ${" + name + ":-"),
      `docker-compose.yml is missing build arg ${name}`,
    );
    assert.match(helper, new RegExp(`export[\\s\\S]*${name}`));
  }
  assert.match(helper, /ALL_MAIL_USE_PUBLISHED_IMAGE/);
  assert.match(helper, /allmail version --json/);
});

test("public project wording consistently reflects AGPL open-source licensing", async () => {
  const files = [
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CHANGELOG.md",
    "docs/README.md",
    "docs/open-source-release-checklist.md",
  ];
  for (const file of files) {
    const content = await read(file);
    assert.match(content, /AGPL-3\.0-only/i, `${file} lacks the canonical AGPL license identifier`);
    assert.doesNotMatch(
      content,
      /custom all-Mail Non-Commercial License|not distributed under an OSI-approved open-source license/i,
      `${file} still contains retired license wording`,
    );
  }
  assert.match(await read("README.md"), /free and open-source software/i);
  assert.match(await read("SUPPORT.md"), /Commercial use is permitted/i);
  assert.match(await read("SECURITY.md"), /Report a vulnerability/i);
  assert.match(await read("Dockerfile"), /org\.opencontainers\.image\.licenses="AGPL-3\.0-only"/);
  assert.match(await read("package.json"), /"license": "AGPL-3\.0-only"/);
});

test("open-source release checklist is canonical", async () => {
  await access(path.join(root, "docs/open-source-release-checklist.md"));
  await assert.rejects(access(path.join(root, "docs/source-available-release-checklist.md")));
  assert.match(await read("docs/README.md"), /open-source-release-checklist/);
  assert.doesNotMatch(await read("docs/README.md"), /source-available-release-checklist/);
});

test("upgrade and restore docs cover the complete state set", async () => {
  const [upgrade, backup, deploy, runbook] = await Promise.all([
    read("docs/UPGRADE.md"),
    read("docs/BACKUP-RESTORE.md"),
    read("docs/DEPLOY.md"),
    read("docs/RUNBOOK.md"),
  ]);
  const volumes = [
    "runtime_secrets_data",
    "bootstrap_admin_data",
    "forwarding_runtime_data",
    "go_business_runtime_data",
    "redis_runtime_data",
    "database_runtime_data",
    "redis_data",
  ];
  for (const volume of volumes) {
    assert.match(upgrade, new RegExp(volume));
    assert.match(backup, new RegExp(volume));
  }
  for (const command of ["pg_dump", "pg_restore", "sha256sum --check", "docker volume create"]) {
    assert.match(backup, new RegExp(command.replaceAll(" ", "\\s+")));
  }
  for (const content of [upgrade, backup, deploy, runbook]) {
    assert.match(content, /docker compose down -v/);
    assert.match(content, /allmail version --json/);
  }
  assert.match(upgrade, /Rollback decision table/);
  assert.match(backup, /Restore rehearsal/);
});

test("release workflow gates publication and removes only merged maintenance branches", async () => {
  const workflow = await read(".github/workflows/release.yml");
  assert.match(workflow, /workflow_run:/);
  assert.ok(workflow.includes("contains(github.event.workflow_run.head_commit.message, '[release:v"));
  assert.ok(workflow.includes('marker="[release:v${version}]"'));
  assert.match(workflow, /release_date/);
  assert.match(workflow, /cross-platform-release-builds/);
  assert.doesNotMatch(workflow, /v2\.0\.0|2026-08-02/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /ghcr\.io/);
  assert.match(workflow, /linux\/amd64,linux\/arm64/);
  assert.match(workflow, /SHA256SUMS/);
  assert.match(workflow, /--state merged/);
  assert.match(workflow, /agent\/\*\|fix\/\*/);
  assert.match(workflow, /git\/refs\/heads/);
});

test("support documentation contains no retired runtime entrypoints", async () => {
  const support = await read("SUPPORT.md");
  for (const retired of ["oauth-temp", "gmail_oauth", "server/"]) {
    assert.doesNotMatch(support, new RegExp(retired.replaceAll("/", "\\/")));
  }
  for (const current of ["app", "go-business-api", "worker-forwarding", "worker-retention"]) {
    assert.match(support, new RegExp(current));
  }
});
