import { createSignedHeaders } from './signature.js';
import type { ResolvedEnv } from './config.js';
import type { IngressReceiveInput } from './types.js';

const MAX_ERROR_RESPONSE_BYTES = 8192;

export interface IngressDispatchResult {
  ok: boolean;
  status: number;
  requestId: string | null;
  errorCode: string | null;
}

async function readBoundedErrorCode(response: Response): Promise<string | null> {
  if (!response.body) {
    return null;
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ERROR_RESPONSE_BYTES) {
    await response.body.cancel();
    return 'INGRESS_ERROR_RESPONSE_TOO_LARGE';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ERROR_RESPONSE_BYTES) {
        await reader.cancel();
        return 'INGRESS_ERROR_RESPONSE_TOO_LARGE';
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    const payload = JSON.parse(body) as { error?: { code?: unknown } };
    return typeof payload.error?.code === 'string' && payload.error.code.trim()
      ? payload.error.code.trim().slice(0, 128)
      : null;
  } catch {
    return null;
  }
}

export async function dispatchIngress(payload: IngressReceiveInput, env: ResolvedEnv): Promise<IngressDispatchResult> {
  const bodyText = JSON.stringify(payload);
  const headers = await createSignedHeaders({
    bodyText,
    method: 'POST',
    url: env.ingressUrl,
    keyId: env.ingressKeyId,
    signingSecret: env.ingressSigningSecret,
  });

  const response = await fetch(env.ingressUrl.toString(), {
    method: 'POST',
    headers,
    body: bodyText,
  });
  const errorCode = response.ok ? null : await readBoundedErrorCode(response);
  if (response.ok && response.body) {
    await response.body.cancel();
  }

  return {
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get('x-request-id'),
    errorCode,
  };
}
