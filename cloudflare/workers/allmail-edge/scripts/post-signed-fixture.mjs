import { createHash, createHmac } from 'node:crypto';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function buildPayload() {
  const matchedAddress = required('MATCHED_ADDRESS').toLowerCase();
  const atIndex = matchedAddress.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === matchedAddress.length - 1) {
    throw new Error(`MATCHED_ADDRESS is invalid: ${matchedAddress}`);
  }

  return {
    provider: process.env.INGRESS_PROVIDER?.trim() || 'FIXTURE_SMOKE',
    receivedAt: new Date().toISOString(),
    envelope: {
      from: (process.env.ENVELOPE_FROM?.trim() || 'fixture@example.com').toLowerCase(),
      to: matchedAddress,
    },
    routing: {
      domain: matchedAddress.slice(atIndex + 1),
      localPart: matchedAddress.slice(0, atIndex),
      matchedAddress,
    },
    message: {
      messageId: process.env.MESSAGE_ID?.trim() || `<fixture-${Date.now()}@allmail-edge.local>`,
      subject: process.env.MESSAGE_SUBJECT?.trim() || 'allmail-edge signed ingress smoke',
      textPreview: process.env.MESSAGE_TEXT?.trim() || 'Your verification code is 246810.',
      htmlPreview: process.env.MESSAGE_HTML?.trim() || '<p>Your verification code is <strong>246810</strong>.</p>',
      headers: {
        subject: process.env.MESSAGE_SUBJECT?.trim() || 'allmail-edge signed ingress smoke',
        'message-id': process.env.MESSAGE_ID?.trim() || `<fixture-${Date.now()}@allmail-edge.local>`,
      },
      attachments: [],
      rawObjectKey: null,
    },
  };
}

async function main() {
  const ingressUrl = new URL(required('INGRESS_URL'));
  const keyId = required('INGRESS_KEY_ID');
  const signingSecret = required('INGRESS_SIGNING_SECRET');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = buildPayload();
  const bodyText = JSON.stringify(payload);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');
  const canonical = `${timestamp}\nPOST\n${ingressUrl.pathname}\n${bodyHash}`;
  const signature = createHmac('sha256', signingSecret).update(canonical).digest('hex');

  const response = await fetch(ingressUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ingress-key-id': keyId,
      'x-ingress-timestamp': timestamp,
      'x-ingress-signature': signature,
    },
    body: bodyText,
  });

  console.log(JSON.stringify({
    status: response.status,
    ok: response.ok,
    body: await response.text(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
