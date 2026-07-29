import type { R2BucketLike, WorkerEnv } from './types.js';

export interface ResolvedEnv {
  ingressUrl: URL;
  ingressKeyId: string;
  ingressSigningSecret: string;
  ingressProvider: string;
  rawEmailObjectPrefix: string;
  maxRawEmailBytes: number;
  rawEmailBucket?: R2BucketLike;
}

const DEFAULT_MAX_RAW_EMAIL_BYTES = 15 * 1024 * 1024;
const CLOUDFLARE_MAX_RAW_EMAIL_BYTES = 25 * 1024 * 1024;

function requireString(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function requireSecretString(name: string, value: string | undefined): string {
  const resolved = requireString(name, value);
  if (resolved.toLowerCase().startsWith('replace-with-')) {
    throw new Error(`${name} must be replaced with a real shared secret`);
  }
  return resolved;
}

function normalizePrefix(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'allmail-edge/raw';
  }
  return trimmed.replace(/^\/+|\/+$/g, '');
}

function validateIngressUrl(rawValue: string): URL {
  const url = new URL(rawValue);
  const isLocalHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!isLocalHttp && url.protocol !== 'https:') {
    throw new Error('INGRESS_URL must use https unless targeting localhost');
  }
  return url;
}

function parseMaxRawEmailBytes(value: string | undefined): number {
  if (!value || !value.trim()) {
    return DEFAULT_MAX_RAW_EMAIL_BYTES;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > CLOUDFLARE_MAX_RAW_EMAIL_BYTES) {
    throw new Error(`MAX_RAW_EMAIL_BYTES must be an integer between 1 and ${CLOUDFLARE_MAX_RAW_EMAIL_BYTES}`);
  }
  return parsed;
}

export function resolveEnv(env: WorkerEnv): ResolvedEnv {
  const ingressUrl = validateIngressUrl(requireString('INGRESS_URL', env.INGRESS_URL));

  return {
    ingressUrl,
    ingressKeyId: requireString('INGRESS_KEY_ID', env.INGRESS_KEY_ID),
    ingressSigningSecret: requireSecretString('INGRESS_SIGNING_SECRET', env.INGRESS_SIGNING_SECRET),
    ingressProvider: env.INGRESS_PROVIDER?.trim() || 'CLOUDFLARE_EMAIL_ROUTING',
    rawEmailObjectPrefix: normalizePrefix(env.RAW_EMAIL_OBJECT_PREFIX),
    maxRawEmailBytes: parseMaxRawEmailBytes(env.MAX_RAW_EMAIL_BYTES),
    rawEmailBucket: env.RAW_EMAIL_BUCKET,
  };
}
