from pathlib import Path
import json
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"expected text missing in {path}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


write(".go-version", "1.26.6\n")
replace_once("core/go.mod", "toolchain go1.26.5", "toolchain go1.26.6")
replace_once("Dockerfile", "FROM golang:1.26.5-bookworm AS go-builder", "FROM golang:1.26.6-bookworm AS go-builder")
replace_once(
    "Dockerfile",
    'org.opencontainers.image.licenses="LicenseRef-all-Mail-Non-Commercial"',
    'org.opencontainers.image.licenses="AGPL-3.0-only"',
)

package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
package["description"] = "all-Mail v2 open-source Docker-first Go email control plane"
package["license"] = "AGPL-3.0-only"
package["keywords"] = ["open-source" if item == "source-available" else item for item in package.get("keywords", [])]
package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

gitignore = read(".gitignore")
marker = "!docs/screenshots/dashboard-home.png\n"
if "!docs/screenshots/admin-dashboard.png" not in gitignore:
    if marker not in gitignore:
        raise SystemExit("screenshot whitelist marker missing from .gitignore")
    write(".gitignore", gitignore.replace(marker, marker + "!docs/screenshots/admin-dashboard.png\n", 1))

support = read("SUPPORT.md")
support = support.replace(
    "`all-Mail` is source-available under the custom non-commercial license in [`LICENSE`](./LICENSE). Community support is best effort and does not create a service-level agreement or grant commercial-use rights.",
    "`all-Mail` is free and open-source software licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`); see [`LICENSE`](./LICENSE). Community support is best effort and does not create a service-level agreement. Commercial use is permitted subject to the license terms.",
    1,
)
support = support.replace(
    "- **Commercial deployment or paid service:** obtain prior written permission from the repository owner as required by the license. Public issue support is not a commercial license.",
    "- **Commercial deployment or paid service:** commercial use is permitted under `AGPL-3.0-only`; support, warranty, and hosted-service arrangements are separate from the open-source license. Modified versions offered to users over a network must satisfy the AGPL source-availability obligations.",
    1,
)
support = support.replace(
    "Requests may be closed when they rely on modified security boundaries, unsupported revisions, unlicensed commercial use, incomplete diagnostics, or secrets posted publicly.",
    "Requests may be closed when they rely on modified security boundaries, unsupported revisions, incomplete diagnostics, requests outside the project's support scope, or secrets posted publicly.",
    1,
)
write("SUPPORT.md", support)

security = read("SECURITY.md")
security = security.replace(
    "`all-Mail` is a source-available project distributed under a custom non-commercial license. Security reports are welcome regardless of whether the reporter uses the software personally, for research, or under a separate commercial agreement.",
    "`all-Mail` is free and open-source software distributed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). Security reports are welcome from users, researchers, operators, and contributors regardless of deployment model.",
    1,
)
write("SECURITY.md", security)

changelog = read("CHANGELOG.md")
changelog = changelog.replace(
    "`all-Mail` is source-available under the custom all-Mail Non-Commercial License in [`LICENSE`](./LICENSE); it is not distributed under an OSI-approved open-source license.",
    "`all-Mail` is free and open-source software licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`); see [`LICENSE`](./LICENSE).",
    1,
)
unreleased = "## [Unreleased]\n\n"
if "Relicensed the project under `AGPL-3.0-only`" not in changelog:
    changelog = changelog.replace(
        unreleased,
        unreleased
        + "### Changed\n\n"
        + "- Relicensed the project under `AGPL-3.0-only` and aligned public metadata, documentation, OCI labels, and release contracts with the open-source license.\n"
        + "- Updated the current development and build toolchain to Go 1.26.6 to pick up standard-library security fixes detected by `govulncheck`.\n\n",
        1,
    )
write("CHANGELOG.md", changelog)

docs_index = read("docs/README.md")
docs_index = docs_index.replace(
    "The project is **source-available under the custom all-Mail Non-Commercial License**. It is not distributed under an OSI-approved open-source license. Use that wording consistently in public material.",
    "The project is **free and open-source software licensed under `AGPL-3.0-only`**. Public material should use the same license identity and avoid reintroducing the retired non-commercial/source-available wording.",
    1,
)
docs_index = docs_index.replace(
    "| Source-available release gate | [`source-available-release-checklist.md`](./source-available-release-checklist.md) |",
    "| Open-source release gate | [`open-source-release-checklist.md`](./open-source-release-checklist.md) |",
    1,
)
write("docs/README.md", docs_index)

checklist = '''# Open-source release checklist

This checklist is the release closure loop for `all-Mail`. The repository is free and open-source software licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`); see [`../LICENSE`](../LICENSE).

## 1. Release identity

- [ ] `VERSION`, root `package.json`, the changelog section, Git tag, binary output, release archive names, and OCI image labels use the same semantic version.
- [ ] `allmail version --json` reports a non-development version, full commit SHA, UTC build timestamp, and Go toolchain version.
- [ ] The release commit is on `main` and every required check is successful.
- [ ] The tag is immutable and points to the release commit.
- [ ] Release assets include checksums and are built from the tagged commit.

## 2. License and public wording

- [ ] `LICENSE`, `README.md`, `SECURITY.md`, `SUPPORT.md`, `CHANGELOG.md`, `package.json`, `Dockerfile`, and `docs/README.md` agree on `AGPL-3.0-only`.
- [ ] Current public documentation describes `all-Mail` as free and open-source software and does not reintroduce the retired custom non-commercial license.
- [ ] Commercial use is permitted subject to `AGPL-3.0-only`; support and warranty arrangements are separate from the license.
- [ ] Operators who modify the program and make that modified version available to users over a computer network provide those users an opportunity to obtain the Corresponding Source as required by AGPLv3 section 13.
- [ ] Code, screenshots, dependencies, and release assets are legally publishable and license-compatible.

## 3. Security and credentials

- [ ] No password, token, `.env`, OAuth output, raw message, database URL, or runtime secret is committed or included in an artifact.
- [ ] Portal passwords are never persisted, prefilled, placed in URLs, or logged.
- [ ] Browser authentication remains cookie-first and frontend auth stores are not persisted.
- [ ] Browser same-origin and framing protections pass.
- [ ] Redis authentication, secret-volume isolation, database role isolation, and private-port checks pass.
- [ ] The one-time bootstrap credential is removed after successful password rotation.

## 4. Runtime topology

The long-running production service set is exactly:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

- [ ] Only `app` is host-published.
- [ ] `app` has no database, cache, provider, JWT, encryption, OAuth, ingress, or bootstrap credential.
- [ ] PostgreSQL, Redis, provider egress, and internal app transport use separate networks.
- [ ] Runtime database identities are generated, non-owner, and table-scoped.
- [ ] The master secret volume is initializer-only.

Private-port verification remains explicit:

```bash
! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

## 5. Engineering verification

- [ ] Go formatting, race tests, unit/integration tests, vet, build, and `govulncheck` pass.
- [ ] Runtime and Frontend V3 source-contract tests pass.
- [ ] React lint, unit tests, production build, and bundle budget pass.
- [ ] Desktop and mobile Chromium administrator and mailbox-portal smoke pass.
- [ ] Browser reports, traces, screenshots, and videos contain no live secrets or production message data.
- [ ] Cloudflare Worker checks pass.
- [ ] Production dependency audit passes.
- [ ] Fresh, repeated, historical-ledger, malformed-schema, OAuth, API-key, forwarding, and retention database tests pass.
- [ ] Full Docker startup, bootstrap rotation, network/secret boundaries, doctors, SBOM, and release gate pass.

Runtime doctors remain part of the release evidence:

```bash
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

## 6. Upgrade and recovery

- [ ] [`UPGRADE.md`](./UPGRADE.md) matches the target release and identifies incompatible rollback points.
- [ ] [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) covers PostgreSQL, `.env`, exact revision, every secret export, Redis persistence, checksums, and restore verification.
- [ ] A restore rehearsal succeeds on isolated infrastructure.
- [ ] No two revisions run concurrently against one database or secret set.
- [ ] `docker compose down -v` is absent from normal upgrade and recovery instructions.

## 7. Publication and cleanup

- [ ] The GitHub Release is created only after all required checks pass.
- [ ] The multi-architecture GHCR image and release archives report the same injected version and commit.
- [ ] The OCI image carries `org.opencontainers.image.licenses=AGPL-3.0-only`.
- [ ] Release notes are generated from the dated changelog section.
- [ ] Merged maintenance branches are removed only after their changes are safely present on `main`; unmerged branches are preserved.
'''
Path("docs/open-source-release-checklist.md").write_text(checklist, encoding="utf-8")
old_checklist = Path("docs/source-available-release-checklist.md")
if not old_checklist.exists():
    raise SystemExit("retired source-available checklist is already missing")
old_checklist.unlink()

release_test = read("scripts/release-contract.test.mjs")
release_test = re.sub(
    r'const canonicalLicenseSentence =\n  "source-available under the custom all-Mail Non-Commercial License";\n\n',
    '',
    release_test,
    count=1,
)
start = release_test.index('test("public project wording is consistently source-available"')
end = release_test.index('test("upgrade and restore docs cover the complete state set"', start)
new_contract = '''test("public project wording consistently reflects AGPL open-source licensing", async () => {
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
    assert.match(content, /AGPL-3\\.0-only/i, `${file} lacks the canonical AGPL license identifier`);
    assert.doesNotMatch(
      content,
      /custom all-Mail Non-Commercial License|not distributed under an OSI-approved open-source license/i,
      `${file} still contains retired license wording`,
    );
  }
  assert.match(await read("README.md"), /free and open-source software/i);
  assert.match(await read("SUPPORT.md"), /Commercial use is permitted/i);
  assert.match(await read("SECURITY.md"), /Report a vulnerability/i);
  assert.match(await read("Dockerfile"), /org\\.opencontainers\\.image\\.licenses="AGPL-3\\.0-only"/);
  assert.match(await read("package.json"), /"license": "AGPL-3\\.0-only"/);
});

test("open-source release checklist is canonical", async () => {
  await access(path.join(root, "docs/open-source-release-checklist.md"));
  await assert.rejects(access(path.join(root, "docs/source-available-release-checklist.md")));
  assert.match(await read("docs/README.md"), /open-source-release-checklist/);
  assert.doesNotMatch(await read("docs/README.md"), /source-available-release-checklist/);
});

'''
release_test = release_test[:start] + new_contract + release_test[end:]
write("scripts/release-contract.test.mjs", release_test)

runtime_test = read("scripts/runtime-documentation.test.mjs")
runtime_test = runtime_test.replace("docs/source-available-release-checklist.md", "docs/open-source-release-checklist.md")
runtime_test = runtime_test.replace(
    'test("documentation describes aggregate readiness and source-available licensing truthfully"',
    'test("documentation describes aggregate readiness and AGPL open-source licensing truthfully"',
    1,
)
old_assertions = "\tassert.match(release, /source-available/i);\n\tassert.match(release, /not distributed under an OSI-approved open-source license/i);\n\tassert.match(license, /You may not use the Software for commercial purposes/i);"
new_assertions = "\tassert.match(release, /AGPL-3\\.0-only/i);\n\tassert.match(release, /Commercial use is permitted/i);\n\tassert.match(release, /computer network[\\s\\S]*Corresponding Source/i);\n\tassert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);\n\tassert.match(license, /You may charge any price or no price/);"
if old_assertions not in runtime_test:
    raise SystemExit("runtime documentation license assertions not found")
runtime_test = runtime_test.replace(old_assertions, new_assertions, 1)
write("scripts/runtime-documentation.test.mjs", runtime_test)

public_files = [
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CHANGELOG.md",
    "docs/README.md",
    "docs/open-source-release-checklist.md",
    "package.json",
    "Dockerfile",
]
retired = re.compile(r"source-available|Non-Commercial License|LicenseRef-all-Mail-Non-Commercial", re.I)
for file in public_files:
    match = retired.search(read(file))
    if match:
        raise SystemExit(f"retired licensing wording remains in {file}: {match.group(0)}")
