#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(repoRoot, 'server');
const webDir = path.join(repoRoot, 'web');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function printHelp() {
  console.log(`all-mail CLI

Usage:
  all-mail install
  all-mail build
  all-mail start [--env-file <path>] [--port <number>]
  all-mail deploy [--env-file <path>] [--port <number>]
  all-mail check
  all-mail setup

Commands:
  install   Install nested server/web dependencies
  build     Build backend + frontend and prepare ./public assets
  start     Start compiled all-Mail server with env resolution and Prisma fallback
  deploy    Build first, then start
  check     Run lint/test/build verification across the repository
  setup     Install nested dependencies, then build everything

Examples:
  all-mail setup
  all-mail start --env-file /path/to/.env --port 3102
  all-mail deploy --port 3002
`);
}

function parseOptions(argv) {
  const options = {
    envFile: undefined,
    port: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      options.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--port') {
      options.port = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function installAll(force = false) {
  const serverNodeModules = path.join(serverDir, 'node_modules');
  const webNodeModules = path.join(webDir, 'node_modules');

  if (force || !(await pathExists(serverNodeModules))) {
    await run(npmCommand, ['--prefix', 'server', 'install']);
  }

  if (force || !(await pathExists(webNodeModules))) {
    await run(npmCommand, ['--prefix', 'web', 'install', '--legacy-peer-deps']);
  }
}

async function buildAll() {
  await run(npmCommand, ['run', 'build'], { cwd: repoRoot });
}

async function startAll(options = {}) {
  const env = { ...process.env };
  if (options.envFile) {
    env.ALL_MAIL_ENV_FILE = path.resolve(options.envFile);
  }
  if (options.port) {
    env.PORT = String(options.port);
  }
  await run('node', ['scripts/start-all-mail.mjs'], { cwd: repoRoot, env });
}

async function runCheck() {
  await run(npmCommand, ['run', 'check'], { cwd: repoRoot });
}

async function runSetup(force = false) {
  await installAll(force);
  await buildAll();
}

async function main() {
  const [command, ...restArgs] = process.argv.slice(2);
  const options = parseOptions(restArgs);

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'install':
      await installAll(true);
      return;
    case 'build':
      await buildAll();
      return;
    case 'start':
      await startAll(options);
      return;
    case 'deploy':
      await runSetup(false);
      await startAll(options);
      return;
    case 'check':
      await runCheck();
      return;
    case 'setup':
      await runSetup(true);
      return;
    case 'internal-postinstall':
      if (process.env.ALL_MAIL_SKIP_POSTINSTALL === '1') {
        return;
      }
      await runSetup(false);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
