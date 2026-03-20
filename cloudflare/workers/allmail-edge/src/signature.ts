const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return toHex(digest);
}

export function buildCanonicalString(input: {
  timestamp: string;
  method: string;
  path: string;
  bodyHash: string;
}): string {
  return `${input.timestamp}\n${input.method.toUpperCase()}\n${input.path}\n${input.bodyHash}`;
}

export async function signCanonicalString(secret: string, canonical: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(canonical));
  return toHex(signature);
}

export async function createSignedHeaders(input: {
  bodyText: string;
  method: string;
  url: URL;
  keyId: string;
  signingSecret: string;
  timestamp?: string;
}): Promise<Headers> {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const bodyHash = await sha256Hex(input.bodyText);
  const canonical = buildCanonicalString({
    timestamp,
    method: input.method,
    path: input.url.pathname,
    bodyHash,
  });
  const signature = await signCanonicalString(input.signingSecret, canonical);

  return new Headers({
    'content-type': 'application/json',
    'x-ingress-key-id': input.keyId,
    'x-ingress-timestamp': timestamp,
    'x-ingress-signature': signature,
  });
}
