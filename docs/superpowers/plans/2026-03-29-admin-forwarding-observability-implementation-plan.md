# all-Mail Admin Forwarding Observability Implementation Plan

Date: 2026-03-29
Based on: `docs/superpowers/specs/2026-03-29-admin-forwarding-observability-design.md`

## Goal

Implement read-only v1 admin forwarding observability for `MailboxForwardJob` using:
- dedicated backend admin resource under `/admin/forwarding-jobs`
- read-only list/detail endpoints
- admin page with filters, table, status tags, and detail Drawer
- no mutation actions
- no portal-side exposure

## Safe execution order

1. Backend schema
2. Backend service
3. Backend routes
4. App registration
5. Frontend API client and contract
6. Frontend page
7. Router and navigation registration
8. Backend tests
9. Frontend tests
10. Final integration verification

Do not change this order. The frontend depends on a stable backend shape, and the route/menu work should not precede the page itself.

## Slice 1 — Backend schema

### Files
- `server/src/modules/forwarding-job/forwardingJob.schema.ts`

### Changes
- Add list schema with:
  - `page`
  - `pageSize`
  - `status?`
  - `mode?`
  - `mailboxId?`
  - `domainId?`
  - `keyword?`
- Add detail schema for `:id`
- Export typed input aliases for service use

### Verification gate
- `cd server && npm run build`

## Slice 2 — Backend service

### Files
- `server/src/modules/forwarding-job/forwardingJob.service.ts`

### Changes
- Implement `list(input)`
- Implement `getById(id)`
- Join `mailbox`, related domain summary, and `inboundMessage`
- Stringify BigInt ids in responses
- Support query filters for:
  - `status`
  - `mode`
  - `mailboxId`
  - relation-based `domainId`
  - `keyword` against `forwardTo`, inbound sender, inbound subject, matched/final address
- Return paginated `{ list, total, page, pageSize }`

### Verification gate
- `cd server && npm run build`

## Slice 3 — Backend routes

### Files
- `server/src/modules/forwarding-job/forwardingJob.routes.ts`

### Changes
- Add plugin-level `fastify.authenticateJwt`
- Add `GET /` for list
- Add `GET /:id` for detail
- Return standard `{ success: true, data }` envelope

### Verification gate
- `cd server && npm run build`

## Slice 4 — Register backend resource

### Files
- `server/src/app.ts`

### Changes
- Register forwarding-job routes under `/admin/forwarding-jobs`
- Place it near adjacent observability resources for readability

### Verification gate
- `cd server && npm run build`

## Slice 5 — Frontend API client and contract

### Files
- `web/src/api/index.ts`
- `web/src/contracts/admin/forwardingJobs.ts`

### Changes
- Add `forwardingJobsApi.getList()`
- Add `forwardingJobsApi.getById()`
- Wrap them in a contract that also loads domain/mailbox options

### Verification gate
- `cd web && npm run build`

## Slice 6 — Frontend page

### Files
- `web/src/pages/forwarding-jobs/index.tsx`

### Changes
- Mirror the structure of `domain-messages` page
- Add filter bar with:
  - status
  - mode
  - domain
  - mailbox
  - keyword
- Add read-only table with columns for:
  - Job ID
  - Status
  - Mode
  - Target address
  - Domain
  - Mailbox
  - Original sender
  - Subject
  - Attempts
  - Next retry
  - Processed at
  - Created at
- Add detail Drawer showing:
  - job lifecycle fields
  - mailbox/domain context
  - inbound message context
  - full `lastError`
  - `providerMessageId`

### Verification gate
- `cd web && npm run build`
- `cd web && npm run lint`

## Slice 7 — Router and navigation

### Files
- `web/src/App.tsx`
- `web/src/layouts/MainLayout.tsx`

### Changes
- Add lazy route for `/forwarding-jobs`
- Add admin navigation item near `domain-messages` / `sending-configs`
- Keep naming aligned with forwarding terminology already used in portal settings

### Verification gate
- `cd web && npm run build`

## Slice 8 — Backend tests

### Files
- `server/src/modules/forwarding-job/forwardingJob.service.test.ts`
- `server/src/modules/forwarding-job/forwardingJob.routes.test.ts`
- optional schema test file if needed

### Coverage targets
- list with no filters
- list with `status`, `mode`, `mailboxId`, `domainId`, `keyword`
- detail by string id
- BigInt-to-string response conversion
- auth guard on routes
- not-found behavior for unknown ids

### Verification gate
- `cd server && npm run test`

## Slice 9 — Frontend tests

### Files
- `web/src/pages/forwarding-jobs/__tests__/index.test.tsx`
- route/auth test extension if needed

### Coverage targets
- admin route renders under authenticated shell
- empty state renders correctly
- detail Drawer opens from selected row
- status tags render stable labels
- table responds to loaded data

### Verification gate
- `cd web && npm run test`

## Slice 10 — Final integration verification

### Commands
```bash
cd /home/fengyong/github/all-Mail
npm run check
```

### Final checklist
- backend build passes
- backend tests pass
- frontend build passes
- frontend tests pass
- route is visible in admin nav
- `/admin/forwarding-jobs` list/detail are protected behind admin JWT
- implementation stayed read-only

## Explicit defer list

Out of scope for this implementation:
- retry / requeue / skip buttons
- write endpoints
- charts or trend cards
- portal-side exposure
- embedded mailbox/domain subpanels
- worker semantic changes
- super-admin-only restriction

## Implementation guardrails

- Do not add mutation affordances in v1
- Do not couple this page to worker state changes
- Do not widen page scope into dashboard analytics
- Do not expose raw MIME/body replay through the observability endpoints
- Do not change forwarding runtime behavior while adding observability
