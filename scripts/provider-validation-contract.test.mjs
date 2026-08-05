import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("provider validation documentation covers every external provider truthfully", async () => {
  const [providersSource, validation, docsIndex, readme] = await Promise.all([
    read("web/src/constants/providers.ts"),
    read("docs/PROVIDER-VALIDATION.md"),
    read("docs/README.md"),
    read("README.md"),
  ]);
  const union = providersSource.match(/export type EmailProvider =([\s\S]*?);/);
  assert.ok(union, "EmailProvider union is missing");
  const providers = [...union[1].matchAll(/["']([A-Z0-9_]+)["']/g)].map(
    (match) => match[1],
  );
  assert.ok(providers.length >= 16, `expected at least 16 providers, found ${providers.length}`);
  for (const provider of providers) {
    assert.match(validation, new RegExp("\\| `" + provider + "` \\|"), `${provider} is absent`);
  }

  assert.match(validation, /no real provider credentials/i);
  assert.match(validation, /does not prove that every third-party service/i);
  assert.match(validation, /implementation-tested/i);
  assert.match(validation, /live-validated for this deployment/i);
  for (const profile of ["minimal", "send", "manage", "full"]) {
    assert.match(validation, new RegExp("\\| `" + profile + "` \\|"));
  }
  assert.match(validation, /Mail\.com Premium account/);
  assert.match(validation, /private and special-use network targets are intentionally rejected/);
  assert.match(docsIndex, /PROVIDER-VALIDATION\.md/);
  assert.match(readme, /PROVIDER-VALIDATION\.md/);
});
