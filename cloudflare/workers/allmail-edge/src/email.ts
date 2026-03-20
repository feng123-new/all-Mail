import PostalMime from 'postal-mime';
import { buildRawObjectKey, parseRoutingAddress } from './routing.js';
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

async function readRawEmail(rawStream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  return new Response(rawStream).arrayBuffer();
}

async function storeRawEmail(input: {
  env: ResolvedEnv;
  rawEmail: ArrayBuffer;
  receivedAt: Date;
  domain: string;
  localPart: string;
  messageId?: string | null;
  from: string;
  to: string;
}): Promise<string | null> {
  if (!input.env.rawEmailBucket) {
    return null;
  }

  const objectKey = buildRawObjectKey({
    prefix: input.env.rawEmailObjectPrefix,
    receivedAt: input.receivedAt,
    domain: input.domain,
    localPart: input.localPart,
    messageId: input.messageId,
  });

  try {
    await input.env.rawEmailBucket.put(objectKey, input.rawEmail, {
      httpMetadata: {
        contentType: 'message/rfc822',
      },
      customMetadata: {
        domain: input.domain,
        localPart: input.localPart,
        from: input.from,
        to: input.to,
        receivedAt: input.receivedAt.toISOString(),
      },
    });
    return objectKey;
  } catch (error) {
    console.error('Failed to store raw email in R2', {
      domain: input.domain,
      localPart: input.localPart,
      messageId: input.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function buildIngressPayload(message: EmailMessageLike, env: ResolvedEnv): Promise<IngressReceiveInput> {
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
  const rawObjectKey = await storeRawEmail({
    env,
    rawEmail,
    receivedAt,
    domain: routing.domain,
    localPart: routing.localPart,
    messageId,
    from: message.from,
    to: message.to,
  });

  return {
    provider: env.ingressProvider,
    receivedAt: receivedAt.toISOString(),
    envelope: {
      from: message.from.trim().toLowerCase(),
      to: message.to.trim().toLowerCase(),
    },
    routing,
    message: {
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
    },
  };
}
