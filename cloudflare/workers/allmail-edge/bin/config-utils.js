const DEFAULT_MAX_RAW_EMAIL_BYTES = 15 * 1024 * 1024;
const CLOUDFLARE_MAX_RAW_EMAIL_BYTES = 25 * 1024 * 1024;

export const REQUIRED_WORKER_DEPLOY_KEYS = [
  'INGRESS_URL',
  'INGRESS_KEY_ID',
  'INGRESS_PROVIDER',
  'RAW_EMAIL_OBJECT_PREFIX',
  'RAW_EMAIL_BUCKET_NAME',
  'MAX_RAW_EMAIL_BYTES',
];

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

export function parseEnvFile(content) {
  const entries = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }
    entries.set(key, parseEnvValue(line.slice(separatorIndex + 1)));
  }
  return entries;
}

export function requireWorkerDeployVars(entries) {
  const missing = REQUIRED_WORKER_DEPLOY_KEYS.filter((key) => !entries.get(key)?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing worker deployment variables: ${missing.join(', ')}`);
  }
  validateMaxRawEmailBytes(entries.get('MAX_RAW_EMAIL_BYTES'));
}

export function validateMaxRawEmailBytes(rawValue) {
  const value = rawValue?.trim() || String(DEFAULT_MAX_RAW_EMAIL_BYTES);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > CLOUDFLARE_MAX_RAW_EMAIL_BYTES) {
    throw new Error(
      `MAX_RAW_EMAIL_BYTES must be an integer between 1 and ${CLOUDFLARE_MAX_RAW_EMAIL_BYTES}`,
    );
  }
  return String(parsed);
}

function requireHttpsUrl(name, rawValue) {
  if (!rawValue?.trim()) {
    return null;
  }
  let url;
  try {
    url = new URL(rawValue.trim());
  } catch (error) {
    throw new Error(`${name} must be an absolute URL: ${error instanceof Error ? error.message : error}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use https`);
  }
  return url.toString();
}

export function resolveWorkerHealthUrl(entries) {
  return requireHttpsUrl('WORKER_HEALTH_URL', entries.get('WORKER_HEALTH_URL'));
}

export function buildDeployConfig(template, envEntries) {
  requireWorkerDeployVars(envEntries);
  const replacements = new Map([
    [
      '"INGRESS_URL": "https://edge.example.com/ingress/domain-mail/receive"',
      `"INGRESS_URL": ${JSON.stringify(envEntries.get('INGRESS_URL'))}`,
    ],
    [
      '"INGRESS_KEY_ID": "allmail-edge-main"',
      `"INGRESS_KEY_ID": ${JSON.stringify(envEntries.get('INGRESS_KEY_ID'))}`,
    ],
    [
      '"INGRESS_PROVIDER": "CLOUDFLARE_EMAIL_ROUTING"',
      `"INGRESS_PROVIDER": ${JSON.stringify(envEntries.get('INGRESS_PROVIDER'))}`,
    ],
    [
      '"RAW_EMAIL_OBJECT_PREFIX": "allmail-edge/raw"',
      `"RAW_EMAIL_OBJECT_PREFIX": ${JSON.stringify(envEntries.get('RAW_EMAIL_OBJECT_PREFIX'))}`,
    ],
    [
      '"MAX_RAW_EMAIL_BYTES": "15728640"',
      `"MAX_RAW_EMAIL_BYTES": ${JSON.stringify(validateMaxRawEmailBytes(envEntries.get('MAX_RAW_EMAIL_BYTES')))}`,
    ],
    [
      '"bucket_name": "mail-eml"',
      `"bucket_name": ${JSON.stringify(envEntries.get('RAW_EMAIL_BUCKET_NAME'))}`,
    ],
  ]);

  let result = template;
  for (const [from, to] of replacements) {
    if (!result.includes(from)) {
      throw new Error(`Could not find expected Wrangler template fragment: ${from}`);
    }
    result = result.replace(from, to);
  }
  return result;
}
