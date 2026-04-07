import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLoginUrl } from './runtime-access.mjs';

const PLACEHOLDER_PREFIXES = ['replace-with-', 'changeme-', 'example-'];

export function parseEnvText(content) {
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

function formatEnvText(entries) {
  return [
    '# Auto-generated bootstrap secrets for all-Mail runtime',
    '# Keep this file private. Delete it only if you intentionally want new runtime secrets.',
    ...Object.entries(entries).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function isTruthyEnvFlag(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function isMissing(value) {
  if (value === undefined || value === null) {
    return true;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return true;
  }
  return PLACEHOLDER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function generateSecret(key) {
  switch (key) {
    case 'JWT_SECRET':
      return crypto.randomBytes(32).toString('hex');
    case 'ENCRYPTION_KEY':
      return crypto.randomBytes(16).toString('hex');
    case 'ADMIN_PASSWORD':
      return crypto.randomBytes(18).toString('base64url');
    default:
      throw new Error(`Unsupported bootstrap secret key: ${key}`);
  }
}

export function shouldPrintBootstrapPassword(env = {}) {
  return isTruthyEnvFlag(env.ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD);
}

export function resolveBootstrapAdminPasswordSource({ password, createdKeys = [], managedKeys = [] }) {
  if (isMissing(password)) {
    return null;
  }

  if (createdKeys.includes('ADMIN_PASSWORD')) {
    return 'generated';
  }

  if (managedKeys.includes('ADMIN_PASSWORD')) {
    return 'state-file';
  }

  return 'env';
}

export function buildBootstrapAdminPasswordMessages({
  password,
  passwordSource,
  secretsFile,
  envFile,
  printPassword = false,
  runtimeKind = 'source',
}) {
  if (isMissing(password) || !passwordSource) {
    return [];
  }

  if (printPassword) {
    const label = passwordSource === 'generated' ? 'Temporary admin password' : 'Bootstrap admin password';
    const lines = [
      `${label}: ${password}`,
      'WARNING: Startup logs may retain this password. Disable ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD after recovery.',
    ];

    if (passwordSource === 'generated') {
      lines.push('You must log in and change it immediately before using the rest of the application.');
      lines.push('After the password is changed, this temporary password will no longer be valid.');
    }

    return lines;
  }

  if (passwordSource === 'generated' || passwordSource === 'state-file') {
    const accessCommand = runtimeKind === 'docker'
      ? `docker compose exec app sh -lc "grep '^ADMIN_PASSWORD=' ${secretsFile} | cut -d= -f2-"`
      : `grep '^ADMIN_PASSWORD=' ${shellQuote(secretsFile)} | cut -d= -f2-`;
    const lines = [
      `Bootstrap admin password is stored in ${secretsFile}.`,
      'Retrieve it from the runtime state file instead of startup logs.',
      `Example: ${accessCommand}`,
    ];

    if (passwordSource === 'generated') {
      lines.push('You must log in and change this temporary password immediately before using the rest of the application.');
    }

    return lines;
  }

  const lines = [
    'Bootstrap admin password is configured via the active environment source and is not echoed to startup logs.',
  ];

  if (envFile) {
    lines.push(`Review ADMIN_PASSWORD in ${envFile}.`);
  } else {
    lines.push('Review ADMIN_PASSWORD in the environment source used for this runtime.');
  }

  lines.push('Set ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=true only if you explicitly want startup password output.');

  return lines;
}

export async function ensureBootstrapSecrets({ stateDir, env }) {
  await mkdir(stateDir, { recursive: true });
  const secretsFile = path.join(stateDir, 'bootstrap-secrets.env');
  const hadExistingSecretsFile = await pathExists(secretsFile);

  const existingSecrets = hadExistingSecretsFile
    ? parseEnvText(await readFile(secretsFile, 'utf8'))
    : {};

  const persistedSecrets = { ...existingSecrets };
  const createdKeys = [];
  const managedKeys = [];

  for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY', 'ADMIN_PASSWORD']) {
    if (isMissing(env[key]) && isMissing(persistedSecrets[key])) {
      persistedSecrets[key] = generateSecret(key);
      createdKeys.push(key);
    }

    if (isMissing(env[key]) && !isMissing(persistedSecrets[key])) {
      managedKeys.push(key);
    }
  }

  if (createdKeys.length > 0 || !(await pathExists(secretsFile))) {
    await writeFile(secretsFile, formatEnvText(persistedSecrets), 'utf8');
  }

  return {
    secretsFile,
    createdKeys,
    managedKeys,
    createdStateFile: !hadExistingSecretsFile,
    loginUrl: resolveLoginUrl(env),
    secrets: persistedSecrets,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const stateDirIndex = args.indexOf('--state-dir');
  const formatIndex = args.indexOf('--format');
  const stateDir = stateDirIndex !== -1 ? path.resolve(args[stateDirIndex + 1]) : path.resolve('.all-mail-runtime');
  const format = formatIndex !== -1 ? args[formatIndex + 1] : 'json';

  const result = await ensureBootstrapSecrets({ stateDir, env: process.env });

  if (format === 'shell') {
    console.log(`export ALL_MAIL_BOOTSTRAP_SECRETS_FILE=${shellQuote(result.secretsFile)}`);
    console.log(`export ALL_MAIL_GENERATED_SECRETS=${shellQuote(result.createdKeys.join(','))}`);
    console.log(`export ALL_MAIL_MANAGED_BOOTSTRAP_SECRETS=${shellQuote(result.managedKeys.join(','))}`);
    console.log(`export ALL_MAIL_CREATED_STATE_FILE=${shellQuote(result.createdStateFile ? '1' : '0')}`);
    console.log(`export ALL_MAIL_LOGIN_URL=${shellQuote(result.loginUrl)}`);
    for (const [key, value] of Object.entries(result.secrets)) {
      console.log(`export ${key}=${shellQuote(value)}`);
    }
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
