import { resolveEnv } from './config.js';
import { buildIngressPayload } from './email.js';
import { dispatchIngress } from './ingress.js';
import type { EmailMessageLike, ExecutionContextLike, WorkerEnv } from './types.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

export default {
  async email(message: EmailMessageLike, envInput: WorkerEnv, _ctx: ExecutionContextLike): Promise<void> {
    try {
      const env = resolveEnv(envInput);
      const payload = await buildIngressPayload(message, env);
      const result = await dispatchIngress(payload, env);

      if (!result.ok) {
        console.error('Ingress request rejected', {
          status: result.status,
          requestId: result.requestId,
          responseText: result.responseText,
          matchedAddress: payload.routing.matchedAddress,
        });
        message.setReject(`all-Mail ingress returned ${result.status}`);
      }
    } catch (error) {
      console.error('Inbound email processing failed', {
        error: errorMessage(error),
        from: message.from,
        to: message.to,
      });
      message.setReject('all-Mail edge ingest failed');
    }
  },

  async fetch(request: Request, envInput: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      try {
        const env = resolveEnv(envInput);
        return json({
          success: true,
          data: {
            worker: 'allmail-edge',
            ingressUrl: env.ingressUrl.toString(),
            ingressKeyId: env.ingressKeyId,
            ingressProvider: env.ingressProvider,
            rawEmailBucketBound: Boolean(env.rawEmailBucket),
            rawEmailObjectPrefix: env.rawEmailObjectPrefix,
          },
        });
      } catch (error) {
        return json({
          success: false,
          error: {
            code: 'WORKER_NOT_CONFIGURED',
            message: errorMessage(error),
          },
        }, { status: 503 });
      }
    }

    return json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    }, { status: 404 });
  },
};
