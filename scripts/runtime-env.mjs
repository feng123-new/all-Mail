const USE_ENV_PROXY_FLAG_PATTERN = /(^|\s)--use-env-proxy(?:=(?:1|true))?(?=\s|$)/g;

export function stripUseEnvProxyFromNodeOptions(nodeOptions) {
  if (!nodeOptions) {
    return undefined;
  }

  const sanitized = nodeOptions
    .replace(USE_ENV_PROXY_FLAG_PATTERN, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  return sanitized || undefined;
}

export function sanitizeNodeRuntimeEnv(env) {
  const runtimeEnv = { ...env };
  delete runtimeEnv.NODE_USE_ENV_PROXY;

  const sanitizedNodeOptions = stripUseEnvProxyFromNodeOptions(runtimeEnv.NODE_OPTIONS);
  if (sanitizedNodeOptions) {
    runtimeEnv.NODE_OPTIONS = sanitizedNodeOptions;
  } else {
    delete runtimeEnv.NODE_OPTIONS;
  }

  return runtimeEnv;
}
