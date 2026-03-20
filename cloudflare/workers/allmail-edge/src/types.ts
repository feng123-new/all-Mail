export interface R2PutOptionsLike {
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: R2PutOptionsLike): Promise<unknown>;
}

export interface WorkerEnv {
  INGRESS_URL: string;
  INGRESS_KEY_ID: string;
  INGRESS_SIGNING_SECRET: string;
  INGRESS_PROVIDER?: string;
  RAW_EMAIL_OBJECT_PREFIX?: string;
  RAW_EMAIL_BUCKET?: R2BucketLike;
}

export interface EmailMessageLike {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface IngressAttachmentInput {
  filename?: string | null;
  contentType?: string | null;
  size?: number | null;
  objectKey?: string | null;
}

export interface IngressReceiveInput {
  provider: string;
  receivedAt: string;
  envelope: {
    from: string;
    to: string;
  };
  routing: {
    domain: string;
    localPart: string;
    matchedAddress: string;
  };
  message: {
    messageId?: string | null;
    subject?: string | null;
    textPreview?: string | null;
    htmlPreview?: string | null;
    headers?: Record<string, string | undefined>;
    attachments?: IngressAttachmentInput[];
    rawObjectKey?: string | null;
  };
}
