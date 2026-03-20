export interface ParsedRoutingAddress {
  matchedAddress: string;
  localPart: string;
  domain: string;
}

function cleanAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function parseRoutingAddress(address: string): ParsedRoutingAddress {
  const matchedAddress = cleanAddress(address);
  const atIndex = matchedAddress.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === matchedAddress.length - 1) {
    throw new Error(`Invalid routing address: ${address}`);
  }

  return {
    matchedAddress,
    localPart: matchedAddress.slice(0, atIndex),
    domain: matchedAddress.slice(atIndex + 1),
  };
}

export function sanitizeStorageToken(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

export function buildRawObjectKey(input: {
  prefix: string;
  receivedAt: Date;
  domain: string;
  localPart: string;
  messageId?: string | null;
}): string {
  const year = input.receivedAt.getUTCFullYear();
  const month = String(input.receivedAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(input.receivedAt.getUTCDate()).padStart(2, '0');
  const timestamp = input.receivedAt.toISOString().replace(/[:.]/g, '-');
  const messageToken = sanitizeStorageToken(input.messageId || crypto.randomUUID());

  return [
    input.prefix,
    String(year),
    month,
    day,
    sanitizeStorageToken(input.domain),
    sanitizeStorageToken(input.localPart),
    `${timestamp}-${messageToken}.eml`,
  ].join('/');
}
