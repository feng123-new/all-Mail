# OpenAPI contract

`all-Mail` publishes an OpenAPI 3.1 document at:

```text
/openapi.json
```

The file is generated during frontend development and production builds. It is served by the same credential-free Go gateway and React static bundle as the administrator console.

## Source of truth

The generated document is derived from:

- `VERSION` — OpenAPI `info.version`;
- `config/openapi-routes.json` — canonical method, path, audience, authentication, summary, and request-body inventory;
- `scripts/generate-openapi.mjs` — deterministic OpenAPI 3.1 generation;
- `config/route-ownership.json` — Go gateway and private business API ownership;
- production Go route registrations under `core/internal/businessapi`.

Compatibility aliases remain implemented for migration but are deliberately excluded from primary OpenAPI paths. New integrations should use the canonical resource-style routes.

## Generate locally

From the repository root:

```bash
node scripts/generate-openapi.mjs --output web/public/openapi.json
```

Or from `web`:

```bash
npm run generate:openapi
```

`npm run dev` and `npm run build` generate the document automatically. The generated local file is ignored by Git because the route inventory and generator are the reviewable source.

## Contract scope

The initial machine-readable contract covers:

- canonical external-mailbox automation routes;
- canonical domain-mailbox automation routes;
- representative administrator control-plane collections and authentication;
- mailbox portal session, mailbox, and message routes;
- signed domain-mail ingress.

It defines method, path, operation ID, audience tag, authentication boundary, common envelopes, and whether a JSON body is required. Detailed field-by-field examples and operator guidance remain in the administrator API documentation page.

## Authentication schemes

- `ApiKey` — `X-API-Key` header;
- `BearerApiKey` — API key in the `Authorization: Bearer` compatibility form;
- `AdminCookie` — administrator `token` Cookie;
- `MailboxCookie` — mailbox portal `mailbox_token` Cookie;
- `IngressKeyId` and `IngressSignature` — signed internal delivery headers.

Login operations are explicitly public only for credential exchange. Subsequent administrator and mailbox operations use Cookie sessions.

## Permanent verification

`scripts/openapi-contract.test.mjs` fails when:

- an operation ID or method/path pair is duplicated;
- a compatibility alias becomes a primary route;
- an operation is not owned by the completed private Go business API route manifest;
- a documented administrator, portal, or ingress method/path is missing from Go registration;
- a canonical public path is missing from Go production source;
- the generated document version differs from `VERSION`;
- authentication tags or required request bodies drift;
- frontend development and production builds stop publishing `/openapi.json`.

Any API change must update the Go implementation, route ownership when needed, the OpenAPI route inventory, the curated administrator documentation, and tests in the same pull request.
