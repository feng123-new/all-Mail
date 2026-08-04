import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = path.join(root, 'config', 'openapi-routes.json');
const versionPath = path.join(root, 'VERSION');

const authSecurity = {
  public: [],
  apiKey: [{ ApiKey: [] }, { BearerApiKey: [] }],
  adminCookie: [{ AdminCookie: [] }],
  mailboxCookie: [{ MailboxCookie: [] }],
  ingressSignature: [{ IngressKeyId: [], IngressSignature: [] }],
};

const commonResponses = {
  200: { $ref: '#/components/responses/Ok' },
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
};

export async function loadOpenAPIInputs() {
  const [rawInventory, rawVersion] = await Promise.all([
    readFile(inventoryPath, 'utf8'),
    readFile(versionPath, 'utf8'),
  ]);
  return {
    inventory: JSON.parse(rawInventory),
    version: rawVersion.trim(),
  };
}

export function generateOpenAPI(inventory, version) {
  const paths = {};
  for (const route of inventory.operations) {
    const method = route.method.toLowerCase();
    const operation = {
      operationId: route.operationId,
      summary: route.summary,
      tags: [route.tag],
      security: authSecurity[route.auth],
      responses: commonResponses,
      'x-allmail-auth': route.auth,
    };
    if (route.body) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/JsonObject' },
          },
        },
      };
    }
    paths[route.path] ||= {};
    paths[route.path][method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'all-Mail API',
      version,
      description: 'Canonical method, path, audience, and authentication contract. Compatibility aliases remain supported but are intentionally excluded as primary OpenAPI paths. Detailed request examples remain in the administrator API documentation.',
    },
    servers: [{ url: '/', description: 'Same-origin all-Mail gateway' }],
    tags: [
      { name: 'Public automation', description: 'API-key authenticated mailbox automation.' },
      { name: 'Administrator', description: 'Cookie-authenticated control-plane operations.' },
      { name: 'Mailbox portal', description: 'Mailbox-user session and message operations.' },
      { name: 'Signed ingress', description: 'Internally signed Cloudflare Email Worker delivery.' },
    ],
    paths,
    components: {
      securitySchemes: {
        ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        BearerApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'API key' },
        AdminCookie: { type: 'apiKey', in: 'cookie', name: 'token' },
        MailboxCookie: { type: 'apiKey', in: 'cookie', name: 'mailbox_token' },
        IngressKeyId: { type: 'apiKey', in: 'header', name: 'X-All-Mail-Key-Id' },
        IngressSignature: { type: 'apiKey', in: 'header', name: 'X-All-Mail-Signature' },
      },
      schemas: {
        JsonObject: { type: 'object', additionalProperties: true },
        Success: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { const: true },
            data: {},
            requestId: { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { const: false },
            requestId: { type: 'string' },
            error: {
              type: 'object',
              required: ['code'],
              properties: { code: { type: ['string', 'integer'] } },
            },
          },
        },
      },
      responses: {
        Ok: {
          description: 'Successful operation.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
        },
        BadRequest: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Unauthorized: {
          description: 'Authentication failed.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'The authenticated principal lacks permission.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  };
}

export function serializeOpenAPI(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0 && (!args[outputIndex + 1] || args.length !== 2)) {
    throw new Error('usage: node scripts/generate-openapi.mjs [--output PATH]');
  }
  if (outputIndex < 0 && args.length !== 0) {
    throw new Error('usage: node scripts/generate-openapi.mjs [--output PATH]');
  }

  const { inventory, version } = await loadOpenAPIInputs();
  const content = serializeOpenAPI(generateOpenAPI(inventory, version));
  if (outputIndex < 0) {
    process.stdout.write(content);
    return;
  }

  const output = path.resolve(process.cwd(), args[outputIndex + 1]);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, content, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
