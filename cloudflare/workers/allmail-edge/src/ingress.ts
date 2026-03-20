import { createSignedHeaders } from './signature.js';
import type { ResolvedEnv } from './config.js';
import type { IngressReceiveInput } from './types.js';

export interface IngressDispatchResult {
  ok: boolean;
  status: number;
  requestId: string | null;
  responseText: string;
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

  return {
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get('x-request-id'),
    responseText: await response.text(),
  };
}
