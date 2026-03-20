export interface IngressSignatureHeaders {
    keyId: string;
    timestamp: string;
    signature: string;
}

export const INGRESS_SIGNATURE_HEADERS = [
    'x-ingress-key-id',
    'x-ingress-timestamp',
    'x-ingress-signature',
] as const;
