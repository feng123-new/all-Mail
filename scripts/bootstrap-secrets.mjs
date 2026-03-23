import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

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

export async function ensureBootstrapSecrets({ stateDir, env }) {
  await mkdir(stateDir, { recursive: true });
  const secretsFile = path.join(stateDir, 'bootstrap-secrets.env');

  const existingSecrets = (await pathExists(secretsFile))
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
