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
export const SECRET_MODE_INIT = 'init';
export const SECRET_MODE_REQUIRE_EXISTING = 'require-existing';

const VALID_SECRET_MODES = new Set([SECRET_MODE_INIT, SECRET_MODE_REQUIRE_EXISTING]);

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

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
    const value = line.slice(separatorIndex + 1);
    if (key) {
      entries[key] = parseEnvValue(value);
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

function validateBootstrapAdminEnvironment(env) {
  const rawUsername = env.ADMIN_USERNAME == null ? '' : String(env.ADMIN_USERNAME);
  const rawPassword = env.ADMIN_PASSWORD == null ? '' : String(env.ADMIN_PASSWORD);
  if (/\r|\n/.test(rawUsername)) {
    throw new Error('ADMIN_USERNAME must not contain line breaks');
  }
  if (/\r|\n/.test(rawPassword)) {
    throw new Error('ADMIN_PASSWORD must not contain line breaks');
  }
  const username = !isMissing(rawUsername) ? rawUsername.trim() : '';
  const password = !isMissing(rawPassword) ? rawPassword.trim() : '';
  if (username.length > 50) {
    throw new Error('ADMIN_USERNAME must contain at most 50 characters');
  }
  if (username && (/^['"]/.test(username) || /['"]$/.test(username))) {
    throw new Error('ADMIN_USERNAME must not start or end with a quote');
  }
  if (password && password.length < 8) {
    throw new Error('ADMIN_PASSWORD must contain at least 8 characters');
  }
  if (password && (/^['"]/.test(password) || /['"]$/.test(password))) {
    throw new Error('ADMIN_PASSWORD must not start or end with a quote');
  }
}

function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
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

function validateRuntimeSecrets(runtimeSecrets) {
  const jwtSecret = String(runtimeSecrets.JWT_SECRET || '').trim();
  const encryptionKey = String(runtimeSecrets.ENCRYPTION_KEY || '').trim();
  if (jwtSecret.length < 32 || isMissing(jwtSecret)) {
    throw new Error('JWT_SECRET must contain at least 32 non-placeholder characters');
  }
  if (encryptionKey.length !== 32 || isMissing(encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must contain exactly 32 non-placeholder characters');
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

export async function ensureRuntimeSecrets({ stateDir, env, mode = SECRET_MODE_INIT }) {
  if (!VALID_SECRET_MODES.has(mode)) {
    throw new Error(`Unsupported secret bootstrap mode: ${mode}`);
  }
  if (mode === SECRET_MODE_INIT) {
    validateBootstrapAdminEnvironment(env);
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const runtimeSecretsFile = path.join(stateDir, RUNTIME_SECRETS_FILENAME);
  const bootstrapAdminFile = path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME);
  const legacySecretsFile = path.join(stateDir, LEGACY_SECRETS_FILENAME);

  const runtimeSecretsExist = await pathExists(runtimeSecretsFile);
  if (mode === SECRET_MODE_REQUIRE_EXISTING && !runtimeSecretsExist) {
    throw new Error(`Runtime secret file is missing: ${runtimeSecretsFile}`);
  }
  const existingRuntime = runtimeSecretsExist
    ? parseEnvText(await readFile(runtimeSecretsFile, 'utf8'))
    : {};

  if (mode === SECRET_MODE_REQUIRE_EXISTING) {
    const runtimeSecrets = {
      JWT_SECRET: !isMissing(env.JWT_SECRET) ? String(env.JWT_SECRET).trim() : existingRuntime.JWT_SECRET,
      ENCRYPTION_KEY: !isMissing(env.ENCRYPTION_KEY) ? String(env.ENCRYPTION_KEY).trim() : existingRuntime.ENCRYPTION_KEY,
    };
    validateRuntimeSecrets(runtimeSecrets);
    return {
      mode,
      runtimeSecretsFile,
      bootstrapAdminFile,
      legacySecretsFile,
      createdKeys: [],
      managedKeys: RUNTIME_SECRET_KEYS.filter((key) => isMissing(env[key])),
      runtimeSecrets,
      migratedLegacyBundle: false,
      loginUrl: resolveLoginUrl(env),
    };
  }

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

  validateRuntimeSecrets(effectiveRuntime);

  await writeAtomic(
    runtimeSecretsFile,
    formatEnvText('Auto-generated all-Mail runtime secrets', persistedRuntime),
  );

  // Only migrate administrator plaintext here. Fresh environment credentials
  // are persisted by the database-locked bootstrap command, so later init runs
  // cannot rematerialize an already consumed password. Existing split state
  // wins; during legacy bundle migration, canonical one-shot inputs may replace
  // old aliases that were never written to the combined bundle.
  const migratedAdmin = !isMissing(legacySecrets.ADMIN_PASSWORD)
    ? {
        ...selectEntries(legacySecrets, ['ADMIN_USERNAME', 'ADMIN_PASSWORD']),
        ...selectEntries(env, ['ADMIN_USERNAME', 'ADMIN_PASSWORD']),
        ...selectEntries(existingAdmin, ['ADMIN_USERNAME', 'ADMIN_PASSWORD']),
      }
    : selectEntries(existingAdmin, ['ADMIN_USERNAME', 'ADMIN_PASSWORD']);
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
    mode,
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
  const modeIndex = args.indexOf('--mode');
  const stateDir = stateDirIndex !== -1
    ? path.resolve(args[stateDirIndex + 1])
    : path.resolve('.all-mail-runtime');
  const format = formatIndex !== -1 ? args[formatIndex + 1] : 'json';
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : SECRET_MODE_INIT;

  const result = await ensureRuntimeSecrets({ stateDir, env: process.env, mode });

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
