#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if new in content:
        return
    if old not in content:
        raise SystemExit(f"missing expected fragment in {path}: {old!r}")
    target.write_text(content.replace(old, new, 1), encoding="utf-8")


replace_once(
    "scripts/bootstrap-admin-docker-smoke.sh",
    "grep -qi '^X-All-Mail-Route-Owner: business-api' \"$write_headers\"",
    "grep -qi '^X-All-Mail-Route-Owner: go-business-api' \"$write_headers\"",
)

ci = ROOT / ".github/workflows/ci.yml"
ci_content = ci.read_text(encoding="utf-8")
ci_updated = ci_content.replace(
    "grep -qi '^X-All-Mail-Route-Owner: business-api' \"$write_headers\"",
    "grep -qi '^X-All-Mail-Route-Owner: go-business-api' \"$write_headers\"",
)
if ci_updated != ci_content:
    ci.write_text(ci_updated, encoding="utf-8")

changelog = ROOT / "CHANGELOG.md"
content = changelog.read_text(encoding="utf-8")
entry = "- moved Dashboard single and batch operation-log deletion to the private Go business service with bounded validation and transactionally coupled administrator audit records\n"
marker = "## [Unreleased]\n\n"
if entry not in content:
    if marker not in content:
        raise SystemExit("CHANGELOG Unreleased marker missing")
    changelog.write_text(content.replace(marker, marker + entry, 1), encoding="utf-8")
