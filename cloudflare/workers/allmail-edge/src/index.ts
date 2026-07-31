import { resolveEnv } from './config.js';
import { buildIngressPayload, deleteStoredRawEmail } from './email.js';
import { dispatchIngress, type IngressDispatchResult } from './ingress.js';
import type { ResolvedEnv } from './config.js';
import type { EmailMessageLike, ExecutionContextLike, IngressReceiveInput, WorkerEnv } from './types.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processingErrorCode(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes('MAX_RAW_EMAIL_BYTES')) {
    return 'RAW_EMAIL_TOO_LARGE';
  }
  if (message === 'Inbound email raw size is invalid') {
    return 'RAW_EMAIL_SIZE_INVALID';
  }
  if (message === 'Invalid routing address') {
    return 'ROUTING_ADDRESS_INVALID';
  }
  return 'INBOUND_PROCESSING_FAILED';
}

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

function deliveryKeyTag(payload: IngressReceiveInput): string {
  return payload.deliveryKey.slice(0, 12);
}

function isReplayAccepted(result: IngressDispatchResult): boolean {
  return result.status === 409 && result.errorCode === 'INGRESS_REPLAY_DETECTED';
}

function shouldCompensateRawStorage(result: IngressDispatchResult): boolean {
  if (result.status < 400 || result.status >= 500) {
    return false;
  }
  return ![408, 409, 425, 429].includes(result.status);
}

async function compensateRawStorage(
  payload: IngressReceiveInput,
  env: ResolvedEnv,
): Promise<void> {
  try {
    await deleteStoredRawEmail(payload, env);
  } catch (error) {
    console.error('Raw email compensation failed', {
      deliveryKey: deliveryKeyTag(payload),
      errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    });
  }
}

type IngressDispatcher = (
  payload: IngressReceiveInput,
  env: ResolvedEnv,
) => Promise<IngressDispatchResult>;

export async function handleEmail(
  message: EmailMessageLike,
  envInput: WorkerEnv,
  ctx: ExecutionContextLike,
  dispatcher: IngressDispatcher = dispatchIngress,
): Promise<void> {
  try {
    const env = resolveEnv(envInput);
    const payload = await buildIngressPayload(message, env);
    const result = await dispatcher(payload, env);

    if (result.ok || isReplayAccepted(result)) {
      return;
    }

    console.error('Ingress request rejected', {
      status: result.status,
      requestId: result.requestId,
      errorCode: result.errorCode,
      deliveryKey: deliveryKeyTag(payload),
    });
    if (shouldCompensateRawStorage(result)) {
      ctx.waitUntil(compensateRawStorage(payload, env));
    }
    message.setReject(`all-Mail ingress returned ${result.status}`);
  } catch (error) {
    console.error('Inbound email processing failed', {
      errorCode: processingErrorCode(error),
    });
    message.setReject('all-Mail edge ingest failed');
  }
}

export default {
  async email(message: EmailMessageLike, envInput: WorkerEnv, ctx: ExecutionContextLike): Promise<void> {
    await handleEmail(message, envInput, ctx);
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
            status: 'ok',
            configured: Boolean(env.ingressUrl && env.ingressKeyId && env.ingressSigningSecret),
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
