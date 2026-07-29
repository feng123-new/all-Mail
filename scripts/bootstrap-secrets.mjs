import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLoginUrl } from './runtime-access.mjs';

const PLACEHOLDER_PREFIXES = ['replace-with-', 'changeme-', 'example-'];
const RUNTIME_SECRET_KEYS = ['JWT_SECRET', 'ENCRYPTION_KEY'];

export const RUNTIME_SECRETS_FILENAME = 'runtime-secrets.env';
export const BOOTSTRAP_ADMIN_FILENAME = 'bootstrap-admin.env';
export const LEGACY_SECRETS_FILENAME = 'bootstrap-secrets.env';

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
    if (key) {
      entries[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return entries;
}

function formatEnvText(title, entries) {
  return [
    `# ${title}`,
    '# Keep this file private and preserve it with the matching database backup.',
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

function generateRuntimeSecret(key) {
  switch (key) {
    case 'JWT_SECRET':
      return crypto.randomBytes(32).toString('hex');
    case 'ENCRYPTION_KEY':
      return crypto.randomBytes(16).toString('hex');
    default:
      throw new Error(`Unsupported runtime secret key: ${key}`);
  }
}

async function writeAtomic(targetPath, content) {
  const temporaryPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, targetPath);
}

function selectEntries(source, keys) {
  const selected = {};
  for (const key of keys) {
    if (!isMissing(source[key])) {
      selected[key] = String(source[key]).trim();
    }
  }
  return selected;
}

export async function ensureRuntimeSecrets({ stateDir, env }) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });

  const runtimeSecretsFile = path.join(stateDir, RUNTIME_SECRETS_FILENAME);
  const bootstrapAdminFile = path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME);
  const legacySecretsFile = path.join(stateDir, LEGACY_SECRETS_FILENAME);

  const existingRuntime = (await pathExists(runtimeSecretsFile))
    ? parseEnvText(await readFile(runtimeSecretsFile, 'utf8'))
    : {};
  const legacySecrets = (await pathExists(legacySecretsFile))
    ? parseEnvText(await readFile(legacySecretsFile, 'utf8'))
    : {};
  const existingAdmin = (await pathExists(bootstrapAdminFile))
    ? parseEnvText(await readFile(bootstrapAdminFile, 'utf8'))
    : {};

  const persistedRuntime = {
    ...selectEntries(legacySecrets, RUNTIME_SECRET_KEYS),
    ...selectEntries(existingRuntime, RUNTIME_SECRET_KEYS),
  };
  const effectiveRuntime = {};
  const createdKeys = [];
  const managedKeys = [];

  for (const key of RUNTIME_SECRET_KEYS) {
    if (!isMissing(env[key])) {
      effectiveRuntime[key] = String(env[key]).trim();
      continue;
    }
    if (isMissing(persistedRuntime[key])) {
      persistedRuntime[key] = generateRuntimeSecret(key);
      createdKeys.push(key);
    }
    effectiveRuntime[key] = persistedRuntime[key];
    managedKeys.push(key);
  }

  await writeAtomic(
    runtimeSecretsFile,
    formatEnvText('Auto-generated all-Mail runtime secrets', persistedRuntime),
  );

  // Existing split state wins. During migration from the combined bundle, a
  // canonical one-shot ADMIN_USERNAME/ADMIN_PASSWORD pair may override the old
  // bundle. This is the safe upgrade path for installations that previously
  // used DOMAIN_BOOTSTRAP_ADMIN_* values which were never written to the bundle.
  const migratedAdmin = {
    ...selectEntries(legacySecrets, ['ADMIN_USERNAME', 'ADMIN_PASSWORD']),
    ...selectEntries(env, ['ADMIN_USERNAME', 'ADMIN_PASSWORD']),
    ...selectEntries(existingAdmin, ['ADMIN_USERNAME', 'ADMIN_PASSWORD']),
  };
  if (!isMissing(legacySecrets.ADMIN_PASSWORD) && isMissing(migratedAdmin.ADMIN_USERNAME)) {
    migratedAdmin.ADMIN_USERNAME = 'admin';
  }
  if (!isMissing(migratedAdmin.ADMIN_PASSWORD)) {
    await writeAtomic(
      bootstrapAdminFile,
      formatEnvText('One-time all-Mail bootstrap administrator credential', migratedAdmin),
    );
  }

  if (await pathExists(legacySecretsFile)) {
    await rm(legacySecretsFile, { force: true });
  }

  return {
    runtimeSecretsFile,
    bootstrapAdminFile,
    legacySecretsFile,
    createdKeys,
    managedKeys,
    runtimeSecrets: effectiveRuntime,
    migratedLegacyBundle: Object.keys(legacySecrets).length > 0,
    loginUrl: resolveLoginUrl(env),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const stateDirIndex = args.indexOf('--state-dir');
  const formatIndex = args.indexOf('--format');
  const stateDir = stateDirIndex !== -1
    ? path.resolve(args[stateDirIndex + 1])
    : path.resolve('.all-mail-runtime');
  const format = formatIndex !== -1 ? args[formatIndex + 1] : 'json';

  const result = await ensureRuntimeSecrets({ stateDir, env: process.env });

  if (format === 'shell') {
    console.log(`export ALL_MAIL_RUNTIME_SECRETS_FILE=${shellQuote(result.runtimeSecretsFile)}`);
    console.log(`export BOOTSTRAP_ADMIN_SECRET_FILE=${shellQuote(result.bootstrapAdminFile)}`);
    console.log(`export ALL_MAIL_GENERATED_RUNTIME_SECRETS=${shellQuote(result.createdKeys.join(','))}`);
    console.log(`export ALL_MAIL_MANAGED_RUNTIME_SECRETS=${shellQuote(result.managedKeys.join(','))}`);
    console.log(`export ALL_MAIL_LOGIN_URL=${shellQuote(result.loginUrl)}`);
    for (const [key, value] of Object.entries(result.runtimeSecrets)) {
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
