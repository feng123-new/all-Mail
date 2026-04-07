export interface IngressAttachmentInput {
    filename?: string | null;
    contentType?: string | null;
    size?: number | null;
    objectKey?: string | null;
}

export interface IngressEnvelopeInput {
    from: string;
    to: string;
}

export interface IngressRoutingInput {
    domain: string;
    localPart: string;
    matchedAddress: string;
}

export interface IngressMessageInput {
    messageId?: string | null;
    subject?: string | null;
    textPreview?: string | null;
    htmlPreview?: string | null;
    headers?: Record<string, string | undefined>;
    attachments?: IngressAttachmentInput[];
    rawObjectKey?: string | null;
    storageStatus?: 'PENDING' | 'STORED' | 'FAILED';
}

export interface IngressReceiveInput {
    provider: string;
    receivedAt: string;
    envelope: IngressEnvelopeInput;
    routing: IngressRoutingInput;
    message: IngressMessageInput;
}
