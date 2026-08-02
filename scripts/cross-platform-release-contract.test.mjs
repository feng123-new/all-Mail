import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("release CI builds every supported operating-system and architecture pair", async () => {
  const workflow = await read(".github/workflows/cross-platform-release.yml");
  assert.match(workflow, /name: Cross-platform release builds/);
  assert.match(workflow, /name: cross-platform-release-builds/);
  assert.match(workflow, /CGO_ENABLED=0 GOOS=/);
  assert.match(workflow, /go test \.\/internal\/secretstate \.\/cmd\/allmail/);

  for (const target of [
    "linux/amd64",
    "linux/arm64",
    "darwin/amd64",
    "darwin/arm64",
    "windows/amd64",
    "windows/arm64",
  ]) {
    assert.ok(workflow.includes(target), `release workflow omits ${target}`);
  }
});

test("runtime secret locking is separated by platform", async () => {
  const [runtime, unixLock, windowsLock, fallbackLock] = await Promise.all([
    read("core/internal/secretstate/secretstate.go"),
    read("core/internal/secretstate/filelock_unix.go"),
    read("core/internal/secretstate/filelock_windows.go"),
    read("core/internal/secretstate/filelock_other.go"),
  ]);

  assert.doesNotMatch(runtime, /syscall\.Flock/);
  assert.match(runtime, /tryExclusiveFileLock/);
  assert.match(runtime, /releaseFileLock/);
  assert.match(unixLock, /\/\/go:build unix/);
  assert.match(unixLock, /syscall\.Flock/);
  assert.match(windowsLock, /\/\/go:build windows/);
  assert.match(windowsLock, /LockFileEx/);
  assert.match(windowsLock, /UnlockFileEx/);
  assert.match(fallbackLock, /\/\/go:build !unix && !windows/);
});
