const PLACEHOLDER_PREFIXES = ['replace-with-', 'changeme-', 'example-'];
const WEAK_DATABASE_PASSWORDS = new Set([
  'admin',
  'allmail',
  'allmail_dev_password',
  'changeme',
  'password',
  'postgres',
]);
const URL_SAFE_SECRET = /^[A-Za-z0-9_-]+$/;

function isTrue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PLACEHOLDER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function requireAbsoluteUrl(name, rawValue, protocols) {
  let parsed;
  try {
    parsed = new URL(String(rawValue || '').trim());
  } catch (error) {
    throw new Error(`${name} must be an absolute URL: ${error instanceof Error ? error.message : error}`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use one of these protocols: ${protocols.join(', ')}`);
  }
  if (!parsed.hostname) {
    throw new Error(`${name} must include a hostname`);
  }
  return parsed;
}

export function validateProductionEnvironment(env = process.env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
    return;
  }

  const databaseUrl = requireAbsoluteUrl('DATABASE_URL', env.DATABASE_URL, ['postgres:', 'postgresql:']);
  if (!databaseUrl.username) {
    throw new Error('DATABASE_URL must include a database username');
  }
  const password = decodeURIComponent(databaseUrl.password || '');
  if (password.length < 24) {
    throw new Error('The PostgreSQL password must contain at least 24 URL-safe characters');
  }
  if (!URL_SAFE_SECRET.test(password)) {
    throw new Error('The PostgreSQL password must use only letters, numbers, underscore, or hyphen');
  }
  if (WEAK_DATABASE_PASSWORDS.has(password.toLowerCase()) || isPlaceholder(password)) {
    throw new Error('The PostgreSQL password is a known weak or placeholder value');
  }
  if (!databaseUrl.pathname || databaseUrl.pathname === '/') {
    throw new Error('DATABASE_URL must include a database name');
  }

  const runtimeRole = String(env.ALL_MAIL_RUNTIME_ROLE || 'api').trim().toLowerCase();
  if (runtimeRole !== 'init') {
    requireAbsoluteUrl('REDIS_URL', env.REDIS_URL, ['redis:', 'rediss:']);
  }

  if (isTrue(env.ALLOW_LOCAL_RATE_LIMIT_FALLBACK)) {
    throw new Error('ALLOW_LOCAL_RATE_LIMIT_FALLBACK must be disabled in production');
  }

  if (env.PUBLIC_BASE_URL) {
    const publicBaseUrl = requireAbsoluteUrl('PUBLIC_BASE_URL', env.PUBLIC_BASE_URL, ['http:', 'https:']);
    if (publicBaseUrl.username || publicBaseUrl.password) {
      throw new Error('PUBLIC_BASE_URL must not contain credentials');
    }
  }

  for (const [name, minimumLength] of [['JWT_SECRET', 32]]) {
    const value = String(env[name] || '').trim();
    if (value && (value.length < minimumLength || isPlaceholder(value))) {
      throw new Error(`${name} must contain at least ${minimumLength} non-placeholder characters when explicitly configured`);
    }
  }

  const encryptionKey = String(env.ENCRYPTION_KEY || '').trim();
  if (encryptionKey && (encryptionKey.length !== 32 || isPlaceholder(encryptionKey))) {
    throw new Error('ENCRYPTION_KEY must contain exactly 32 non-placeholder characters when explicitly configured');
  }
}

async function main() {
  validateProductionEnvironment(process.env);
  console.log('Production runtime configuration validated.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
