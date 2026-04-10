# all-Mail Forwarding Execution Implementation Plan

Date: 2026-03-29
Based on: `docs/internal/superpowers/specs/2026-03-29-forwarding-design.md`

## Goal

Implement forwarding execution v1 for **new inbound mail only** using:
- async forwarding job table
- in-process scheduled worker
- preview-content forwarding
- `COPY` vs `MOVE` semantics through portal visibility state
- no history backfill
- no physical deletion of inbound rows

## Safe execution order

1. **Schema foundation**
2. **Ingress creates forwarding jobs**
3. **Forwarding worker executes jobs**
4. **Register worker on server startup**
5. **Portal visibility filtering**
6. **Integration and regression tests**

Do not change the order. The worker depends on schema + job creation. Portal filtering depends on the visibility state already existing.

## Slice 1 — Schema foundation

### Files
- `server/prisma/schema.prisma`

### Changes
- Add `MailboxForwardJob` model
- Add `ForwardJobStatus` enum
- Add `PortalState` enum
- Add `portalState` field to `InboundMessage`
- Add relations from `InboundMessage` and `DomainMailbox` to `MailboxForwardJob`
- Add `nextAttemptAt` to the forward job model for retry scheduling

### Tests / gates
- Prisma migration succeeds
- Prisma generate succeeds
- `cd server && npm run build`

## Slice 2 — Ingress job creation

### Files
- `server/src/modules/ingress/ingress.service.ts`
- `server/src/modules/ingress/ingress.service.test.ts`

### Changes
- After `InboundMessage.create()` succeeds, inspect mailbox forwarding config
- Create `MailboxForwardJob(PENDING)` only when:
  - `forwardMode !== DISABLED`
  - `forwardTo` is present
- Set initial `nextAttemptAt` to current time
- Keep duplicate protection anchored to inbound acceptance and unique `inboundMessageId`

### Tests / gates
- `DISABLED` mailbox -> no job
- `COPY` mailbox -> job created
- `MOVE` mailbox -> job created
- duplicate inbound -> no second job
- `cd server && npm run test`

## Slice 3 — Forwarding worker

### Files
- `server/src/jobs/forwarding.worker.ts`
- `server/src/config/env.ts`
- tests under `server/src/jobs/` or forwarding modules

### Changes
- Add interval-driven worker following the `api-log-retention.ts` pattern
- Claim pending/retryable jobs using database-safe claim semantics
- Re-check current mailbox forwarding config before sending
- Mark job `SKIPPED` if forwarding is now disabled or target changed
- Use v1 retry policy:
  - max attempts: 3
  - exponential backoff starting at 30 seconds, capped at 5 minutes
- Reuse domain sending config and Resend provider path
- On success:
  - `COPY` -> leave inbound visible
  - `MOVE` -> hide inbound from portal
- On failure:
  - keep inbound visible
  - update `attemptCount`, `lastError`, `nextAttemptAt`

### Tests / gates
- `COPY` success -> job `SENT`, inbound still visible
- `MOVE` success -> job `SENT`, inbound hidden
- disabled-after-create -> job `SKIPPED`
- failed send -> job `FAILED`, inbound still visible
- retries stop after 3 attempts
- multi-worker claim does not double-process one job
- `cd server && npm run test`

## Slice 4 — Startup registration

### Files
- `server/src/index.ts`

### Changes
- Start forwarding worker during server boot
- Stop forwarding worker during shutdown
- Mirror the lifecycle pattern used by API log retention job

### Tests / gates
- `cd server && npm run build`
- server startup smoke test succeeds

## Slice 5 — Portal visibility filtering

### Files
- `server/src/modules/message/message.service.ts`
- `server/src/modules/message/message.service.test.ts`
- `server/src/modules/mailbox-user/mailboxPortal.routes.ts`
- portal-facing tests if needed

### Changes
- Exclude `FORWARDED_HIDDEN` inbound messages from portal list queries
- Treat hidden moved messages as not found for portal detail reads
- Preserve admin visibility semantics unless explicitly changed

### Tests / gates
- portal list excludes hidden moved messages
- portal detail returns not found for hidden moved messages
- admin-facing message flow keeps expected behavior

## Slice 6 — Integration and regression coverage

### Files
- integration tests spanning ingress + worker + portal visibility

### Coverage targets
- full flow: ingress -> job -> worker -> portal result for `COPY`
- full flow: ingress -> job -> worker -> portal result for `MOVE`
- duplicate inbound protection
- rollback-safe failure behavior

### Final verification
- `cd server && npm run test`
- `npm run check`

## Explicit defer list

The following stay out of v1:
- history backfill
- full MIME replay
- attachment forwarding
- CC/BCC enhancement
- external queue infrastructure
- physical deletion of inbound rows
- admin UI for forward jobs
- metrics dashboard beyond logs/database inspection

## Implementation guardrails

- Do not perform forwarding synchronously inside ingress
- Do not hide `MOVE` messages before send succeeds
- Do not reuse `OutboundMessage` as the forwarding job table
- Do not delete inbound rows for `MOVE`
- Do not expand scope to history replay or full MIME handling

## Primary verification commands

```bash
cd server && npm run test
cd server && npm run build
cd /path/to/all-Mail && npm run check
```
