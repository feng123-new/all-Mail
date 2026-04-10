# all-Mail Forwarding Execution Design

Date: 2026-03-29
Status: Draft accepted for planning
Scope owner: mailbox portal / ingress / send pipeline

## 1. Goal

Turn mailbox forwarding from a saved portal configuration into a real runtime behavior for **new inbound mail only**.

When a mailbox has forwarding enabled:
- `DISABLED`: no forwarding happens
- `COPY`: new inbound mail is forwarded and the original inbound message remains visible in the portal
- `MOVE`: new inbound mail is forwarded and the original inbound message becomes hidden from the mailbox portal only after forwarding succeeds

This design does **not** backfill history and does **not** replay old mail when forwarding is enabled later.

## 2. Current state

Observed implementation today:
- `server/src/modules/mailbox-user/mailboxUser.service.ts` persists `DomainMailbox.forwardMode` and `DomainMailbox.forwardTo`
- `server/src/modules/ingress/ingress.service.ts` resolves target mailbox and persists `InboundMessage`
- `server/src/modules/send/send.service.ts` and `server/src/modules/send/providers/resend.ts` already provide a working domain-scoped outbound send path
- portal UI currently exposes forwarding as saved configuration, but runtime ingress does not execute it

## 3. Non-goals

This iteration will not:
- backfill unread or historical mail
- rebuild full raw MIME with attachments for forwarding
- introduce external queue infrastructure
- physically delete original inbound rows for `MOVE`
- change admin visibility semantics unless explicitly needed for portal filtering

## 4. Recommended architecture

## 4.1 High-level shape

Keep ingress fast and deterministic.

Recommended flow:
1. Cloudflare worker posts inbound payload
2. `ingressService.receive()` validates domain and resolves mailbox
3. `InboundMessage` is created exactly as today
4. if mailbox forwarding is enabled, create a forwarding job record for this new inbound message
5. a background forwarding worker claims pending jobs and executes the actual forward send asynchronously
6. if forwarding succeeds:
   - `COPY`: leave original inbound message visible
   - `MOVE`: mark original inbound message hidden from portal queries
7. if forwarding fails: preserve original inbound message and record failure on the job

## 4.2 Why asynchronous forwarding is required

Synchronous forwarding inside ingress was rejected because it would:
- couple mail acceptance latency to outbound provider health
- turn outbound provider failures into perceived inbound instability
- make retries and auditability much harder
- make `MOVE` semantics dangerous because failure handling would be unclear inside the request path

This repository already uses an in-process scheduled job pattern in `server/src/jobs/api-log-retention.ts`, so the first forwarding worker can follow the same operational style without adding Redis/BullMQ/Agenda.

## 5. Data model changes

## 5.1 New forwarding job model

Add a dedicated table instead of reusing `OutboundMessage`.

Suggested model: `MailboxForwardJob`

Fields:
- `id`
- `inboundMessageId`
- `mailboxId`
- `mode` (`COPY` | `MOVE`)
- `forwardTo`
- `status` (`PENDING` | `RUNNING` | `SENT` | `FAILED` | `SKIPPED`)
- `attemptCount`
- `lastError`
- `providerMessageId`
- `nextAttemptAt`
- `createdAt`
- `updatedAt`
- `processedAt`

Indexes:
- by `status, createdAt`
- by `inboundMessageId`
- unique constraint on `inboundMessageId` to prevent duplicate forwarding jobs for the same accepted inbound message

## 5.2 Inbound visibility state

Do not overload `isDeleted` for `MOVE`.

Add a dedicated portal visibility state to `InboundMessage`, for example:
- `portalState` (`VISIBLE` | `FORWARDED_HIDDEN`)

Reason:
- `MOVE` in this feature means “removed from mailbox portal workflow,” not “destroyed from system records”
- keeping the original inbound row supports audit, troubleshooting, duplicate suppression, and possible admin inspection
- portal filtering can exclude hidden records while admin tooling can retain full visibility if desired

## 6. Runtime behavior

## 6.1 Job creation

Inside `ingressService.receive()` after `InboundMessage.create()` succeeds:
- load mailbox forwarding settings from the resolved `DomainMailbox`
- if `forwardMode === DISABLED` or `forwardTo` is missing, stop
- otherwise create one `MailboxForwardJob(PENDING)` for that inbound message

Duplicate protection should remain anchored to inbound acceptance (`messageIdHeader` + domain/mailbox matching) and the forward job unique constraint should prevent duplicate forwarding when ingress duplicate detection already short-circuits.

## 6.2 Worker execution

Add a new job module under `server/src/jobs/`, started from `server/src/index.ts`, similar to API log retention.

Worker behavior per cycle:
1. claim a small batch of claimable jobs where `status IN ('PENDING', 'FAILED')` and `nextAttemptAt <= now()`
2. atomically transition each claimed job to `RUNNING`
3. load the linked `InboundMessage`, mailbox, domain, and sending config
4. re-check the current mailbox forwarding configuration; if forwarding is now disabled or the target changed away from this job's `forwardTo`, mark the job `SKIPPED`
5. build forwarding message body
6. send via existing provider path (`Resend` for v1)
7. update job state to `SENT` or `FAILED`
8. if `MOVE` and send succeeded, mark inbound portal state hidden

Concurrency guard:
- use an in-process `running` lock like the existing retention job to prevent overlapping loops inside one process
- use database claim semantics so multiple server replicas do not double-send the same job
- preferred claim pattern is row-level locking (`FOR UPDATE SKIP LOCKED`) or an equivalent atomic claim/update step
- limit batch size to keep startup/runtime simple

Retry policy (v1):
- maximum attempts: 3
- backoff: exponential, starting at 30 seconds and capped at 5 minutes
- retryable failures: provider timeout, transient network failure, 429/rate-limit style provider responses, temporary upstream 5xx failures
- permanent failures: invalid forwarding target format, missing active domain sending config, mailbox/domain no longer eligible to send
- when a job hits the attempt ceiling, keep it in `FAILED`, preserve the last error, and stop scheduling new attempts

## 6.3 Forwarded message content (v1)

Version 1 forwards preview content, not raw MIME replay.

Forward payload should contain:
- original sender address in the body metadata block
- matched/final mailbox address
- original subject (with `Fwd:` prefix if needed)
- `textPreview` and/or `htmlPreview`
- optional metadata block for received time and route kind

Header policy for v1:
- `From` uses the domain's configured sending identity
- `Reply-To` may use the original sender when safe and supported by the provider path
- the original sender is always shown in the forwarded body metadata even if direct header replay is restricted

This deliberately avoids raw MIME reconstruction because current storage/pathing does not yet provide a safe, reusable abstraction for replaying attachments and full message source.

## 7. COPY and MOVE semantics

## 7.1 COPY
- send forward message asynchronously
- keep original inbound message visible in portal
- mark forward job `SENT` on success

## 7.2 MOVE
- send forward message asynchronously
- only after successful send, set inbound portal state to hidden
- never hide before successful delivery
- if send fails, keep original message visible and mark job `FAILED`

## 7.3 Failure handling

If any of these fail, do **not** lose the original message:
- no active sending config for the domain
- provider API error
- invalid or rejected forwarding target
- transient network/provider timeout

`MOVE` therefore degrades safely to “message still visible until forward actually succeeds.”

## 8. Verification plan

Required tests before implementation is considered complete:

### 8.1 Ingress tests
- `DISABLED` mailbox creates no forwarding job
- `COPY` mailbox creates a pending forwarding job
- `MOVE` mailbox creates a pending forwarding job
- duplicate inbound acceptance does not create a second forwarding job

### 8.2 Worker tests
- `COPY` success -> job `SENT`, original message still visible
- `MOVE` success -> job `SENT`, original message hidden from portal
- forwarding disabled after job creation -> job `SKIPPED`, original message unchanged
- forward failure -> job `FAILED`, original message still visible
- retry increments attempt count, advances `nextAttemptAt`, and stops after the v1 ceiling of 3 attempts
- multi-worker claim path does not allow the same job to be executed twice

### 8.3 Portal tests
- mailbox portal message list excludes hidden moved messages
- mailbox portal detail cannot surface a message already hidden by successful `MOVE`
- admin-facing message views keep expected visibility semantics (explicitly verify desired behavior)

### 8.4 Verification commands
At minimum, the implementation phase must re-run:
- server tests
- web tests
- root `npm run check`
- any new forwarding worker tests added under `server/src/jobs` or forwarding modules

## 9. Rollout and rollback

## 9.1 Safe rollout
- default remains `DISABLED`
- first canary should enable forwarding for one mailbox/domain only
- monitor job failure rate, queue backlog growth, and retry volume through structured logs plus periodic database inspection

## 9.2 Rollback
Fast rollback options:
- stop the forwarding worker
- set affected mailbox `forwardMode` back to `DISABLED`

Because ingress acceptance is not coupled to forwarding success, rollback should not block inbound mail delivery.

## 10. Risks and open decisions

### 10.1 Accepted v1 tradeoff
The first version forwards preview content only. This is intentionally smaller in scope and avoids unsafe raw MIME replay.

### 10.2 Deferred enhancement
Later versions may add:
- full MIME forwarding with attachments
- richer retry/backoff policy beyond the v1 defaults
- per-domain or per-mailbox forwarding metrics
- admin UI for forward job inspection

### 10.3 Explicit implementation preference
For this repository, the preferred first implementation is:
- async outbox/job table
- in-process scheduled worker
- `COPY`/`MOVE` split via portal visibility state
- no history backfill
- no physical deletion of original inbound rows
