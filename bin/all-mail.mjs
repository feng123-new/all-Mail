#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeNodeRuntimeEnv } from '../scripts/runtime-env.mjs';

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
  all-mail doctor [--env-file <path>]
  all-mail deps up|down
  all-mail up [--docker-deps] [--env-file <path>] [--port <number>]
  all-mail start [--env-file <path>] [--port <number>]
  all-mail deploy [--env-file <path>] [--port <number>]
  all-mail check
  all-mail setup

Commands:
  install   Install nested server/web dependencies
  build     Build backend + frontend and prepare ./public assets
  doctor    Check env, build artifacts, PostgreSQL, and Redis reachability
  deps      Start or stop PostgreSQL + Redis via docker compose
  up        One-command app startup; optionally boot dockerized deps first
  start     Start compiled all-Mail API + jobs runtimes with env resolution and Prisma fallback
  deploy    Build first, then start
  check     Run lint/test/build verification across the repository
  setup     Install nested dependencies, then build everything

Examples:
  all-mail doctor --env-file /path/to/.env
  all-mail deps up
  all-mail up --docker-deps --env-file /path/to/.env --port 3102
  all-mail setup
  all-mail start --env-file /path/to/.env --port 3102
  all-mail deploy --port 3002
`);
}

function parseOptions(argv) {
  const options = {
    envFile: undefined,
    port: undefined,
    dockerDeps: false,
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
    if (arg === '--docker-deps') {
      options.dockerDeps = true;
    }
  }

  return options;
}

function parseEnvText(content) {
  const entries = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    entries[key] = value.replace(/^['"]|['"]$/g, '');
  }
  return entries;
}

async function resolveEnvFile(explicitEnvFile) {
  const candidates = [
    explicitEnvFile ? path.resolve(explicitEnvFile) : null,
    process.env.ALL_MAIL_ENV_FILE ? path.resolve(process.env.ALL_MAIL_ENV_FILE) : null,
    path.join(serverDir, '.env'),
    path.join(repoRoot, '.env'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeEnv(fileEnv) {
  const normalizedEnv = { ...fileEnv };

  if (!normalizedEnv.PORT && normalizedEnv.APP_PORT) {
    normalizedEnv.PORT = normalizedEnv.APP_PORT;
  }

  if (!normalizedEnv.DATABASE_URL && normalizedEnv.POSTGRES_USER && normalizedEnv.POSTGRES_PASSWORD && normalizedEnv.POSTGRES_DB) {
    const postgresHost = normalizedEnv.POSTGRES_HOST || '127.0.0.1';
    const postgresPort = normalizedEnv.POSTGRES_PORT || normalizedEnv.POSTGRES_INTERNAL_PORT || '5432';
    normalizedEnv.DATABASE_URL = `postgresql://${normalizedEnv.POSTGRES_USER}:${normalizedEnv.POSTGRES_PASSWORD}@${postgresHost}:${postgresPort}/${normalizedEnv.POSTGRES_DB}`;
  }

  if (!normalizedEnv.REDIS_URL && (normalizedEnv.REDIS_PORT || normalizedEnv.REDIS_INTERNAL_PORT)) {
    const redisHost = normalizedEnv.REDIS_HOST || '127.0.0.1';
    const redisPort = normalizedEnv.REDIS_PORT || normalizedEnv.REDIS_INTERNAL_PORT || '6379';
    normalizedEnv.REDIS_URL = `redis://${redisHost}:${redisPort}`;
  }

  return normalizedEnv;
}

async function loadRuntimeEnv(explicitEnvFile, portOverride) {
  const envFile = await resolveEnvFile(explicitEnvFile);
  if (!envFile) {
    throw new Error('No env file found. Create server/.env from server/.env.example, or root .env from .env.example, then retry.');
  }

  const fileEnv = parseEnvText(await readFile(envFile, 'utf8'));
  const normalizedEnv = normalizeEnv(fileEnv);
  const runtimeEnv = sanitizeNodeRuntimeEnv({ ...normalizedEnv, ...process.env });
  if (portOverride) {
    runtimeEnv.PORT = String(portOverride);
  }

  return { envFile, runtimeEnv };
}

function readPortFromUrl(urlString, fallbackPort) {
  const parsed = new URL(urlString);
  return Number(parsed.port || fallbackPort);
}

async function testTcpReachability(host, port, label) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${label} timed out while connecting to ${host}:${port}`));
    }, 4000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });

    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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
      env: sanitizeNodeRuntimeEnv(options.env ?? process.env),
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
  const workerDir = path.join(repoRoot, 'cloudflare', 'workers', 'allmail-edge');
  const workerNodeModules = path.join(workerDir, 'node_modules');

  if (force || !(await pathExists(serverNodeModules))) {
    await run(npmCommand, ['--prefix', 'server', 'install']);
  }

  if (force || !(await pathExists(webNodeModules))) {
    await run(npmCommand, ['--prefix', 'web', 'install', '--legacy-peer-deps']);
  }

  if (force || !(await pathExists(workerNodeModules))) {
    await run(npmCommand, ['--prefix', 'cloudflare/workers/allmail-edge', 'install']);
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

async function ensureDockerComposeAvailable() {
  await run('docker', ['compose', 'version'], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function runDockerDeps(action) {
  await ensureDockerComposeAvailable();
  if (action === 'up') {
    await run('docker', ['compose', 'up', '-d', 'postgres', 'redis'], { cwd: repoRoot });
    return;
  }
  if (action === 'down') {
    await run('docker', ['compose', 'stop', 'postgres', 'redis'], { cwd: repoRoot });
    return;
  }
  throw new Error(`Unknown deps action: ${action}`);
}

async function runDoctor(options) {
  const results = [];
  try {
    const { envFile, runtimeEnv } = await loadRuntimeEnv(options.envFile, options.port);
    results.push({ level: 'ok', message: `Using env file: ${envFile}` });

    if (!runtimeEnv.DATABASE_URL) {
      throw new Error('DATABASE_URL could not be resolved from the current env configuration.');
    }

    const databaseUrl = new URL(runtimeEnv.DATABASE_URL);
    await testTcpReachability(databaseUrl.hostname, readPortFromUrl(runtimeEnv.DATABASE_URL, 5432), 'PostgreSQL');
    results.push({ level: 'ok', message: `PostgreSQL reachable at ${databaseUrl.hostname}:${readPortFromUrl(runtimeEnv.DATABASE_URL, 5432)}` });

    if (runtimeEnv.REDIS_URL) {
      const redisUrl = new URL(runtimeEnv.REDIS_URL);
      await testTcpReachability(redisUrl.hostname, readPortFromUrl(runtimeEnv.REDIS_URL, 6379), 'Redis');
      results.push({ level: 'ok', message: `Redis reachable at ${redisUrl.hostname}:${readPortFromUrl(runtimeEnv.REDIS_URL, 6379)}` });
    } else {
      results.push({ level: 'warn', message: 'REDIS_URL is not configured. The app can start, but OAuth state caching and some rate-limit behavior will degrade.' });
    }

    const serverDistEntry = path.join(serverDir, 'dist', 'index.js');
    const serverWorkerDistEntry = path.join(serverDir, 'dist', 'worker.js');
    const publicIndexFile = path.join(repoRoot, 'public', 'index.html');
    results.push({ level: (await pathExists(serverDistEntry)) ? 'ok' : 'warn', message: (await pathExists(serverDistEntry)) ? 'Server build artifacts exist.' : 'Server build artifacts are missing. Run `all-mail setup` or `all-mail build`.' });
    results.push({ level: (await pathExists(serverWorkerDistEntry)) ? 'ok' : 'warn', message: (await pathExists(serverWorkerDistEntry)) ? 'Jobs runtime build artifacts exist.' : 'Jobs runtime build artifacts are missing. Run `all-mail setup` or `all-mail build`.' });
    results.push({ level: (await pathExists(publicIndexFile)) ? 'ok' : 'warn', message: (await pathExists(publicIndexFile)) ? 'Frontend public assets exist.' : 'Frontend public assets are missing. Run `all-mail setup` or `all-mail build`.' });
  } catch (error) {
    results.push({ level: 'error', message: error instanceof Error ? error.message : String(error) });
  }

  for (const result of results) {
    const prefix = result.level === 'ok' ? '[ok]' : result.level === 'warn' ? '[warn]' : '[error]';
    console.log(`${prefix} ${result.message}`);
  }

  if (results.some((result) => result.level === 'error')) {
    process.exit(1);
  }
}

async function runUp(options) {
  const serverNodeModules = path.join(serverDir, 'node_modules');
  const webNodeModules = path.join(webDir, 'node_modules');
  const serverDistEntry = path.join(serverDir, 'dist', 'index.js');
  const publicIndexFile = path.join(repoRoot, 'public', 'index.html');

  if (options.dockerDeps) {
    await runDockerDeps('up');
  }

  const needsSetup = !(
    await pathExists(serverNodeModules)
    && await pathExists(webNodeModules)
    && await pathExists(serverDistEntry)
    && await pathExists(publicIndexFile)
  );

  if (needsSetup) {
    await runSetup(false);
  }

  await startAll(options);
}

async function main() {
  const [command, maybeSubcommand, ...restArgs] = process.argv.slice(2);
  const options = parseOptions(command === 'deps' ? restArgs : [maybeSubcommand, ...restArgs].filter(Boolean));

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
    case 'doctor':
      await runDoctor(options);
      return;
    case 'deps':
      if (maybeSubcommand !== 'up' && maybeSubcommand !== 'down') {
        throw new Error('Usage: all-mail deps up|down');
      }
      await runDockerDeps(maybeSubcommand);
      return;
    case 'up':
      await runUp(options);
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
