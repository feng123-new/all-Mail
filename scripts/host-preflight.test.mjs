import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "host-preflight.sh");

async function fixture(overcommit = "1", availableMemoryKiB = 2 * 1024 * 1024) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "allmail-preflight-"));
  const bin = path.join(directory, "bin");
  const proc = path.join(directory, "proc");
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(proc, "sys", "vm"), { recursive: true });
  await writeFile(path.join(proc, "sys", "vm", "overcommit_memory"), `${overcommit}\n`);
  await writeFile(path.join(proc, "meminfo"), `MemAvailable: ${availableMemoryKiB} kB\n`);
  const docker = path.join(bin, "docker");
  await writeFile(docker, `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  version) printf '27.5.1\\n' ;;
  compose)
    test "\${2:-}" = version
    printf '2.33.1\\n'
    ;;
  info)
    if [[ "\${2:-}" == "--format" ]]; then
      printf 'overlay2\\n'
    fi
    ;;
  *) exit 1 ;;
esac
`);
  await chmod(docker, 0o755);
  return { directory, bin, proc };
}

function runPreflight(fixtureState, overrides = {}) {
  return spawnSync("bash", [script], {
    cwd: fixtureState.directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixtureState.bin}:${process.env.PATH}`,
      ALL_MAIL_PREFLIGHT_PROC_ROOT: fixtureState.proc,
      ALL_MAIL_PREFLIGHT_CHECK_PATH: fixtureState.directory,
      ALL_MAIL_PREFLIGHT_MIN_MEMORY_MIB: "1",
      ALL_MAIL_PREFLIGHT_MIN_DISK_MIB: "0",
      ALL_MAIL_PREFLIGHT_MIN_INODES: "0",
      ALL_MAIL_PREFLIGHT_SKIP_PORT: "1",
      ...overrides,
    },
  });
}

test("production host preflight verifies kernel, capacity and Docker capabilities", async () => {
  const state = await fixture();
  const result = runPreflight(state);
  assert.equal(result.status, 0, result.stderr);
  for (const expected of [
    "vm.overcommit_memory=1",
    "memory-available-mib=2048",
    "disk-available-mib=",
    "inodes-available=",
    "docker-client=27.5.1",
    "docker-compose=2.33.1",
    "docker-storage-driver=overlay2",
    "all-Mail production host preflight passed",
  ]) {
    assert.match(result.stdout, new RegExp(expected.replaceAll(".", "\\.")));
  }
});

test("production host preflight rejects unsafe Redis overcommit policy", async () => {
  const state = await fixture("0");
  const result = runPreflight(state);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /vm\.overcommit_memory must be 1/);
});

test("production host preflight rejects insufficient available memory", async () => {
  const state = await fixture("1", 512 * 1024);
  const result = runPreflight(state, {
    ALL_MAIL_PREFLIGHT_MIN_MEMORY_MIB: "1024",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /available memory is 512 MiB/);
});

test("an occupied application port is reported without blocking a verified upgrade", async () => {
  const state = await fixture();
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const result = runPreflight(state, {
    ALL_MAIL_PREFLIGHT_SKIP_PORT: "0",
    ALL_MAIL_PREFLIGHT_APP_PORT: String(address.port),
  });
  await new Promise((resolve) => server.close(resolve));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /is already bound/);
  assert.match(result.stdout, /passed with 1 warning/);
});

test("malformed numeric overrides fail cleanly without arithmetic expansion errors", async () => {
  const state = await fixture();
  const result = runPreflight(state, {
    ALL_MAIL_PREFLIGHT_APP_PORT: "not-a-port",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a non-negative integer/);
  assert.match(result.stderr, /must be between 1 and 65535/);
  assert.doesNotMatch(result.stderr, /unbound variable|syntax error/i);
});
