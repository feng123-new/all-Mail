# all-Mail Admin Forwarding Observability Design

Date: 2026-03-29
Status: Draft accepted for planning
Scope owner: admin shell / forwarding worker observability

## 1. Goal

Add a first-version admin observability surface for forwarding jobs created by forwarding v1.

This version is intentionally **read-only first**. It should help operators answer:
- Which forwarding jobs exist?
- Which ones are pending, running, sent, failed, or skipped?
- Which mailbox/domain/inbound message did a job come from?
- Why did a job fail or get skipped?
- When will it retry next?

## 2. Current state

Observed implementation today:
- Forwarding runtime data now exists in `MailboxForwardJob`
- `server/src/jobs/forwarding.worker.ts` owns the operational lifecycle and troubleshooting semantics
- Admin observability patterns already exist for inbound domain messages, send history, and API logs
- Frontend admin list/detail patterns already exist in `domain-messages`, `operation-logs`, and `sending-configs`
- There is currently no dedicated admin API or admin page for forwarding jobs

## 3. Scope and non-goals

## 3.1 In scope
- backend read-only admin endpoints for forwarding job list and detail
- frontend admin page for forwarding-job monitoring
- table filters, pagination, status tags, and detail Drawer
- troubleshooting fields from the actual worker/job model

## 3.2 Out of scope for v1
- retry / requeue / skip / cancel actions
- mutation endpoints
- charts or aggregated dashboard widgets
- portal-side exposure
- mailbox/domain detail embedded subpanels
- worker semantic changes beyond observability support

## 4. Recommended architecture

## 4.1 Backend surface

Add a new top-level admin resource module, parallel to `domain-messages` and `send`.

Recommended module set:
- `server/src/modules/forwarding-job/forwardingJob.routes.ts`
- `server/src/modules/forwarding-job/forwardingJob.schema.ts`
- `server/src/modules/forwarding-job/forwardingJob.service.ts`

Register it in `server/src/app.ts` under a dedicated top-level prefix:
- `/admin/forwarding-jobs`

Auth model:
- protect the entire module with `fastify.authenticateJwt`
- do not require super-admin-only access in v1

## 4.2 API shape

### List endpoint
`GET /admin/forwarding-jobs`

Query params:
- `page`
- `pageSize`
- `status?`
- `mode?`
- `mailboxId?`
- `domainId?`
- `keyword?`

`keyword` is intended to match high-signal troubleshooting text such as:
- `forwardTo`
- original sender address
- inbound subject
- matched/final mailbox address

List response shape should mirror existing paginated admin resources:

```json
{
  "success": true,
  "data": {
    "list": [...],
    "total": 0,
    "page": 1,
    "pageSize": 20
  }
}
```

### Detail endpoint
`GET /admin/forwarding-jobs/:id`

Detail response should expose:
- forwarding job core fields
- mailbox/domain summary
- linked inbound message summary
- enough worker state to explain why the current job is pending/running/failed/skipped/sent

## 4.3 Service responsibilities

The forwarding-job service should be read-only and should not duplicate worker logic.

Responsibilities:
- parse and normalize list filters
- query `MailboxForwardJob` with mailbox/domain/inbound joins
- stringify BigInt ids in responses
- expose detail payloads that are useful for troubleshooting
- avoid embedding write-side actions or state transitions

## 5. Data contract

## 5.1 List row fields

Each list row should include at minimum:
- `id` (string)
- `inboundMessageId` (string)
- `mailboxId` (number | null)
- `mode`
- `forwardTo`
- `status`
- `attemptCount`
- `providerMessageId`
- `nextAttemptAt`
- `processedAt`
- `createdAt`
- `updatedAt`
- `lastError` (optional in list; truncated if long)
- `mailbox`: `{ id, address, provisioningMode }`
- `domain`: `{ id, name, canSend, canReceive }`
- `inboundMessage`: `{ id, fromAddress, subject, matchedAddress, finalAddress, routeKind, receivedAt, portalState }`

## 5.2 Detail payload fields

The detail view should include everything in the row plus:
- full `lastError`
- `textPreview` / `htmlPreview` presence indicators or summary metadata if useful
- current mailbox forwarding config snapshot:
  - mailbox `forwardMode`
  - mailbox `forwardTo`
- explanation-oriented timestamps:
  - `createdAt`
  - `updatedAt`
  - `processedAt`
  - `nextAttemptAt`

The purpose of the detail payload is not to replay the mail body; it is to explain the forwarding job lifecycle and current state.

## 6. Frontend surface

## 6.1 Route and navigation

Add a new admin page under the existing admin shell.

Recommended route:
- `/forwarding-jobs`

Recommended navigation placement:
- place it near `domain-messages` and `sending-configs` in `web/src/layouts/MainLayout.tsx`
- this keeps mail-flow observability pages clustered together

## 6.2 Page baseline

Use `web/src/pages/domain-messages/index.tsx` as the main structural template because it already matches the troubleshooting workflow:
- filter bar
- data table
- refresh
- detail Drawer
- empty state handling

Borrow from `web/src/pages/operation-logs/index.tsx` for:
- pagination discipline
- status tags
- copyable identifiers

## 6.3 Page layout

Recommended frontend files:
- `web/src/pages/forwarding-jobs/index.tsx`
- small local helpers for status-tag mapping if needed
- API client methods in `web/src/api/index.ts`

Page sections:
1. `PageHeader`
   - eyebrow
   - title
   - subtitle
   - refresh action
2. `SurfaceCard`
   - filter controls on top
   - read-only jobs table
3. Detail `Drawer`
   - job summary
   - mailbox/domain summary
   - inbound summary
   - failure/skip reason block
   - retry timing block

## 7. UI behavior

## 7.1 Filters

Recommended initial filters:
- status select
- mode select (`COPY`, `MOVE`)
- domain select
- mailbox select
- keyword search

These should map directly to list endpoint query params.

## 7.2 Table columns

Recommended columns:
- Job ID
- Status
- Mode
- Target forward address
- Domain
- Mailbox
- Original sender
- Subject
- Attempts
- Next retry
- Processed at
- Created at
- Action: detail link/button

Optional refinement:
- for `lastError`, show a shortened tooltip/tag in the table and full text only in Drawer detail

## 7.3 Detail drawer

Drawer sections should answer:
- what job is this?
- what message triggered it?
- where was it supposed to forward?
- what happened most recently?
- if failed or skipped, why?
- if retryable, when will it run again?

Recommended Drawer content blocks:
- job identity and lifecycle
- mailbox/domain context
- inbound message context
- provider/result block
- failure/skip diagnostics block

## 7.4 Status semantics for UI

Use direct worker-aligned labels:
- `PENDING`
- `RUNNING`
- `SENT`
- `FAILED`
- `SKIPPED`

Do not invent alternate product language in v1. The point of this page is operational clarity, not abstraction.

## 8. Error handling and edge cases

The admin page should explicitly handle:
- no jobs yet
- jobs with `FAILED` and no next retry scheduled
- jobs with `SKIPPED` due to changed forwarding config
- jobs with `RUNNING` that may actually be stale but have not yet been reclaimed
- jobs whose linked mailbox/domain still exists vs. now-disabled context

The detail view must not assume every linked context is perfectly healthy; stale operational context is part of the troubleshooting value.

## 9. Testing and verification

## 9.1 Backend tests
- schema parsing for list filters
- service list with `status`, `mode`, `domainId`, `mailboxId`, and keyword filtering
- detail fetch by string id with BigInt conversion
- response shape with joined mailbox/domain/inbound summaries
- auth coverage: routes are mounted behind admin JWT like other admin observability modules

## 9.2 Frontend tests
- route registration under admin shell
- unauthenticated redirect remains correct
- table renders empty state correctly
- detail Drawer opens for a selected row
- status tag rendering remains stable

## 9.3 Final verification targets
At minimum during implementation:
- relevant server tests
- relevant web tests
- root `npm run check`

## 10. Why this design

This design keeps the first version narrow and consistent with the repository’s current shape:
- a dedicated operational model deserves a dedicated admin resource
- list/detail troubleshooting patterns already exist in adjacent mail-flow pages
- read-only first avoids mixing observability with control-plane semantics too early
- later write actions like retry/requeue can extend the same page without forcing a redesign

## 11. Deferred v2 directions

Possible future extensions after read-only v1:
- manual retry action for `FAILED` or stale `RUNNING` jobs
- skip/cancel controls
- job metrics and trend cards
- domain/mailbox detail subpanels that embed forwarding job history
- links from portal/admin message views directly into related forwarding jobs
