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
    throw new Error('Invalid routing address');
  }

  return {
    matchedAddress,
    localPart: matchedAddress.slice(0, atIndex),
    domain: matchedAddress.slice(atIndex + 1),
  };
}

export function buildRawObjectKey(input: {
  prefix: string;
  deliveryKey: string;
}): string {
  const deliveryKey = input.deliveryKey.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(deliveryKey)) {
    throw new Error('deliveryKey must be a 64-character hexadecimal digest');
  }
  const prefix = input.prefix.replace(/^\/+|\/+$/g, '');
  return `${prefix}/${deliveryKey.slice(0, 2)}/${deliveryKey}.eml`;
}
