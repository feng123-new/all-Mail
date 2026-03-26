function pickFirstNonEmpty(values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function normalizeBaseUrl(value) {
  if (!value) {
    return null;
  }
  return value.replace(/\/+$/, '');
}

function resolveCorsOrigin(env) {
  if (typeof env?.CORS_ORIGIN !== 'string') {
    return null;
  }

  const firstOrigin = env.CORS_ORIGIN
    .split(',')
    .map((origin) => origin.trim())
    .find(Boolean);

  return firstOrigin ? normalizeBaseUrl(firstOrigin) : null;
}

export function resolveLoginBaseUrl(env = {}) {
  const explicitBaseUrl = normalizeBaseUrl(pickFirstNonEmpty([
    env.PUBLIC_BASE_URL,
    env.ALL_MAIL_PUBLIC_BASE_URL,
  ]));

  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const corsOrigin = resolveCorsOrigin(env);
  if (corsOrigin) {
    return corsOrigin;
  }

  const port = pickFirstNonEmpty([
    env.APP_PORT,
    env.PORT,
    '3002',
  ]);

  return `http://127.0.0.1:${port}`;
}

export function resolveLoginUrl(env = {}) {
  return `${resolveLoginBaseUrl(env)}/login`;
}
