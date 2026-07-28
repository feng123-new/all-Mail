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
const workerDir = path.join(repoRoot, 'cloudflare', 'workers', 'allmail-edge');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function printHelp() {
  console.log(`all-mail repository CLI

Usage:
  all-mail install
  all-mail build
  all-mail doctor [--env-file <path>]
  all-mail deps up|down
  all-mail check
  all-mail setup

Commands:
  install   Install server, web, and Cloudflare Worker dependencies
  build     Build the compatibility API and React frontend
  doctor    Check env resolution, infrastructure reachability, and build artifacts
  deps      Start or stop PostgreSQL + Redis for local development
  check     Run the full repository release gate
  setup     Install dependencies, then build

The supported production runtime is Docker Compose. This CLI intentionally does
not start a parallel Node production topology.
`);
}

function parseOptions(argv) {
  const options = { envFile: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--env-file') {
      options.envFile = argv[index + 1];
      index += 1;
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
    if (key) {
      entries[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return entries;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
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
  if (!normalizedEnv.DATABASE_URL && normalizedEnv.POSTGRES_USER && normalizedEnv.POSTGRES_PASSWORD && normalizedEnv.POSTGRES_DB) {
    const host = normalizedEnv.POSTGRES_HOST || '127.0.0.1';
    const port = normalizedEnv.POSTGRES_PORT || normalizedEnv.POSTGRES_INTERNAL_PORT || '5432';
    normalizedEnv.DATABASE_URL = `postgresql://${normalizedEnv.POSTGRES_USER}:${normalizedEnv.POSTGRES_PASSWORD}@${host}:${port}/${normalizedEnv.POSTGRES_DB}`;
  }
  if (!normalizedEnv.REDIS_URL && (normalizedEnv.REDIS_PORT || normalizedEnv.REDIS_INTERNAL_PORT)) {
    const host = normalizedEnv.REDIS_HOST || '127.0.0.1';
    const port = normalizedEnv.REDIS_PORT || normalizedEnv.REDIS_INTERNAL_PORT || '6379';
    normalizedEnv.REDIS_URL = `redis://${host}:${port}`;
  }
  return normalizedEnv;
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
  const installs = [
    [serverDir, path.join(serverDir, 'node_modules'), []],
    [webDir, path.join(webDir, 'node_modules'), ['--legacy-peer-deps']],
    [workerDir, path.join(workerDir, 'node_modules'), []],
  ];
  for (const [directory, nodeModules, extraArgs] of installs) {
    if (force || !(await pathExists(nodeModules))) {
      await run(npmCommand, ['install', ...extraArgs], { cwd: directory });
    }
  }
}

async function buildAll() {
  await run(npmCommand, ['run', 'build'], { cwd: repoRoot });
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
    const envFile = await resolveEnvFile(options.envFile);
    if (!envFile) {
      throw new Error('No env file found. Copy .env.example to .env or create server/.env for API development.');
    }
    results.push({ level: 'ok', message: `Using env file: ${envFile}` });
    const fileEnv = normalizeEnv(parseEnvText(await readFile(envFile, 'utf8')));
    const runtimeEnv = sanitizeNodeRuntimeEnv({ ...fileEnv, ...process.env });

    if (!runtimeEnv.DATABASE_URL) {
      throw new Error('DATABASE_URL could not be resolved from the current env configuration.');
    }
    const databaseUrl = new URL(runtimeEnv.DATABASE_URL);
    const databasePort = readPortFromUrl(runtimeEnv.DATABASE_URL, 5432);
    await testTcpReachability(databaseUrl.hostname, databasePort, 'PostgreSQL');
    results.push({ level: 'ok', message: `PostgreSQL reachable at ${databaseUrl.hostname}:${databasePort}` });

    if (runtimeEnv.REDIS_URL) {
      const redisUrl = new URL(runtimeEnv.REDIS_URL);
      const redisPort = readPortFromUrl(runtimeEnv.REDIS_URL, 6379);
      await testTcpReachability(redisUrl.hostname, redisPort, 'Redis');
      results.push({ level: 'ok', message: `Redis reachable at ${redisUrl.hostname}:${redisPort}` });
    } else {
      results.push({ level: 'warn', message: 'REDIS_URL is not configured; OAuth state and rate-limit behavior can degrade.' });
    }

    const artifacts = [
      [path.join(serverDir, 'dist', 'index.js'), 'Compatibility API build artifacts'],
      [path.join(webDir, 'dist', 'index.html'), 'React frontend build artifacts'],
    ];
    for (const [artifact, label] of artifacts) {
      const exists = await pathExists(artifact);
      results.push({
        level: exists ? 'ok' : 'warn',
        message: exists ? `${label} exist.` : `${label} are missing. Run all-mail setup or npm run build.`,
      });
    }
    results.push({ level: 'ok', message: 'Production startup remains docker compose up -d --build --wait.' });
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

async function main() {
  const [command, maybeSubcommand, ...restArgs] = process.argv.slice(2);
  const options = parseOptions([maybeSubcommand, ...restArgs].filter(Boolean));

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
    case 'check':
      await runCheck();
      return;
    case 'setup':
      await runSetup(true);
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
