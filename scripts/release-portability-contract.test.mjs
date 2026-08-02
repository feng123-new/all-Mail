import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("release portability workflow builds every published target", async () => {
  const workflow = await read(".github/workflows/release-portability.yml");
  for (const target of [
    "linux/amd64",
    "linux/arm64",
    "darwin/amd64",
    "darwin/arm64",
    "windows/amd64",
    "windows/arm64",
  ]) {
    assert.match(workflow, new RegExp(target.replace("/", "\\/")));
  }
  assert.match(workflow, /name: release-cross-builds/);
  assert.match(workflow, /name: windows-secret-lock/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /TestFileLockIsExclusiveAndReusable/);
});

test("runtime secret locking has explicit Unix and Windows implementations", async () => {
  const [common, unix, windows] = await Promise.all([
    read("core/internal/secretstate/secretstate.go"),
    read("core/internal/secretstate/filelock_unix.go"),
    read("core/internal/secretstate/filelock_windows.go"),
  ]);

  assert.match(common, /tryLockFile\(lockFile\)/);
  assert.match(common, /unlockFile\(lockFile\)/);
  assert.doesNotMatch(common, /syscall\.Flock/);
  assert.match(unix, /\/\/go:build !windows/);
  assert.match(unix, /syscall\.Flock/);
  assert.match(windows, /\/\/go:build windows/);
  assert.match(windows, /LockFileEx/);
  assert.match(windows, /UnlockFileEx/);
  assert.match(windows, /errorLockViolation/);
});
