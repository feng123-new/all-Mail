import PostalMime from 'postal-mime';
import { buildRawObjectKey, parseRoutingAddress } from './routing.js';
import { sha256Hex, sha256HexBytes } from './signature.js';
import type { ResolvedEnv } from './config.js';
import type { EmailMessageLike, IngressAttachmentInput, IngressReceiveInput } from './types.js';

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizePreview(value: string | null | undefined, maxLength: number): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const entries: Record<string, string> = {};
  headers.forEach((value, name) => {
    entries[name.toLowerCase()] = value;
  });
  return entries;
}

function resolveAttachmentSize(content: unknown): number | null {
  if (content instanceof Uint8Array) {
    return content.byteLength;
  }
  if (content instanceof ArrayBuffer) {
    return content.byteLength;
  }
  return null;
}

function mapAttachments(attachments: unknown): IngressAttachmentInput[] {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.map((attachment) => {
    const record = attachment as Record<string, unknown>;
    const filename = typeof record.filename === 'string' ? record.filename.trim() || null : null;
    const contentTypeSource = typeof record.contentType === 'string'
      ? record.contentType
      : typeof record.mimeType === 'string'
        ? record.mimeType
        : null;

    return {
      filename,
      contentType: contentTypeSource?.trim() || null,
      size: resolveAttachmentSize(record.content),
      objectKey: null,
    };
  });
}

function buildMessageSummary(input: {
  parsed: Awaited<ReturnType<PostalMime['parse']>>;
  headers: Record<string, string>;
  rawObjectKey: string | null;
  storageStatus: 'PENDING' | 'STORED' | 'FAILED';
  messageId: string | null;
}): IngressReceiveInput['message'] {
  const { parsed, headers, rawObjectKey, storageStatus, messageId } = input;

  return {
    messageId,
    subject: firstNonEmpty(
      typeof parsed.subject === 'string' ? parsed.subject : null,
      headers.subject,
    ),
    textPreview: normalizePreview(typeof parsed.text === 'string' ? parsed.text : null, 12000),
    htmlPreview: normalizePreview(typeof parsed.html === 'string' ? parsed.html : null, 20000),
    headers,
    attachments: mapAttachments(parsed.attachments),
    rawObjectKey,
    storageStatus,
  };
}

async function buildDeliveryKey(input: {
  matchedAddress: string;
  messageId: string | null;
  rawEmail: ArrayBuffer;
}): Promise<string> {
  const normalizedAddress = input.matchedAddress.trim().toLowerCase();
  const normalizedMessageId = input.messageId?.trim().toLowerCase() || null;

  if (normalizedMessageId) {
    return sha256Hex(`message-id\n${normalizedAddress}\n${normalizedMessageId}`);
  }

  const rawEmailHash = await sha256HexBytes(input.rawEmail);
  return sha256Hex(`raw-email\n${normalizedAddress}\n${rawEmailHash}`);
}

async function readRawEmail(rawStream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  return new Response(rawStream).arrayBuffer();
}

async function storeRawEmail(input: {
  env: ResolvedEnv;
  rawEmail: ArrayBuffer;
  receivedAt: Date;
  deliveryKey: string;
}): Promise<string | null> {
  if (!input.env.rawEmailBucket) {
    return null;
  }

  const objectKey = buildRawObjectKey({
    prefix: input.env.rawEmailObjectPrefix,
    deliveryKey: input.deliveryKey,
  });

  try {
    await input.env.rawEmailBucket.put(objectKey, input.rawEmail, {
      httpMetadata: {
        contentType: 'message/rfc822',
      },
      customMetadata: {
        deliveryKey: input.deliveryKey,
        receivedAt: input.receivedAt.toISOString(),
      },
    });
    return objectKey;
  } catch (error) {
    console.error('Failed to store raw email in R2', {
      deliveryKey: input.deliveryKey.slice(0, 12),
      errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    });
    return null;
  }
}

async function resolveRawStorage(input: {
  env: ResolvedEnv;
  rawEmail: ArrayBuffer;
  receivedAt: Date;
  deliveryKey: string;
}): Promise<{ rawObjectKey: string | null; storageStatus: 'PENDING' | 'STORED' | 'FAILED' }> {
  if (!input.env.rawEmailBucket) {
    return {
      rawObjectKey: null,
      storageStatus: 'PENDING',
    };
  }

  const rawObjectKey = await storeRawEmail(input);
  return {
    rawObjectKey,
    storageStatus: rawObjectKey ? 'STORED' : 'FAILED',
  };
}

export async function deleteStoredRawEmail(payload: IngressReceiveInput, env: ResolvedEnv): Promise<void> {
  const objectKey = payload.message.rawObjectKey;
  if (!objectKey || !env.rawEmailBucket) {
    return;
  }
  await env.rawEmailBucket.delete(objectKey);
}

export async function buildIngressPayload(message: EmailMessageLike, env: ResolvedEnv): Promise<IngressReceiveInput> {
  if (!Number.isSafeInteger(message.rawSize) || message.rawSize < 0) {
    throw new Error('Inbound email raw size is invalid');
  }
  if (message.rawSize > env.maxRawEmailBytes) {
    throw new Error(`Inbound email exceeds MAX_RAW_EMAIL_BYTES (${message.rawSize} > ${env.maxRawEmailBytes})`);
  }
  const receivedAt = new Date();
  const routing = parseRoutingAddress(message.to);
  const rawEmail = await readRawEmail(message.raw);
  const parser = new PostalMime();
  const parsed = await parser.parse(rawEmail);
  const headers = headersToRecord(message.headers);
  const messageId = firstNonEmpty(
    typeof parsed.messageId === 'string' ? parsed.messageId : null,
    headers['message-id'],
  );
  const deliveryKey = await buildDeliveryKey({
    matchedAddress: routing.matchedAddress,
    messageId,
    rawEmail,
  });
  const storage = await resolveRawStorage({
    env,
    rawEmail,
    receivedAt,
    deliveryKey,
  });
  const summarizedMessage = buildMessageSummary({
    parsed,
    headers,
    rawObjectKey: storage.rawObjectKey,
    storageStatus: storage.storageStatus,
    messageId,
  });

  return {
    provider: env.ingressProvider,
    deliveryKey,
    receivedAt: receivedAt.toISOString(),
    envelope: {
      from: message.from.trim().toLowerCase(),
      to: message.to.trim().toLowerCase(),
    },
    routing,
    message: summarizedMessage,
  };
}
