# GongXi-Mail Rewrite Boundary Checklist

This document maps which areas of `all-Mail` are most likely to retain structural similarity to the earlier `GongXi-Mail` reference shape, and which areas already look more independent.

The goal is not cosmetic distancing. If upstream redistribution rights remain unresolved, the practical priority is:

1. rewrite service logic and workflow shape
2. rename models / endpoints / product terms
3. then restyle the frontend

UI restyling alone is **not** enough.

Current implementation note: this repository now exposes new primary automation paths such as `/api/mailboxes/*`, `/api/messages/*`, and `/api/domain-mail/mailboxes/*`, while earlier script-style paths remain as compatibility aliases during migration.

## A. Highest priority rewrite before public release

These areas most strongly resemble a classic external mailbox pool + automation API product shape and should be treated as the first rewrite boundary.

### 1. External mailbox automation API surface

**Files**

- `server/src/modules/mail/mail.routes.ts`
- `server/src/modules/mail/mail.service.ts`
- `server/src/modules/mail/pool.service.ts`
- `server/src/modules/mail/mail.schema.ts`
- `server/src/modules/mail/mail.actions.ts`

**Why high risk**

- historically retained script-oriented compatibility endpoints such as `/api/get-email`, `/api/mail_new`, `/api/mail_text`, `/api/mail_all`, `/api/process-mailbox`, `/api/pool-stats`, `/api/reset-pool`; the new primary surface now uses `/api/mailboxes/*` and `/api/messages/*`
- keeps a pool-allocation model centered on “unused email → mark used → reset pool”
- reads like a mailbox-pool product core, not just an incidental compatibility layer

**Rewrite target**

- redesign route names and resource model around explicit mailbox allocation / fetch jobs / message queries instead of `mail_*`
- replace pool allocation semantics with a clearer capability model
- rebuild the service layer so allocation, usage tracking, and access checks are no longer shaped like a traditional email pool API

### 2. Admin external mailbox management flow

**Files**

- `server/src/modules/email/email.routes.ts`
- `server/src/modules/email/email.service.ts`
- `server/src/modules/email/group.routes.ts`
- `server/src/modules/email/group.service.ts`
- `server/src/modules/email/email.schema.ts`
- `web/src/pages/emails/index.tsx`

**Why high risk**

- this is the main admin control surface for external mailbox CRUD, mailbox fetch, mailbox clear, import/export, batch operations, and provider-specific handling
- the page and routes still strongly orbit the “mailbox pool management” mental model
- the UI information architecture still uses `邮箱管理`, grouping, batch check, batch clear, import/export, and provider tabs in a way that likely preserves earlier product DNA

**Rewrite target**

- reframe this area as “provider accounts / mailbox connectors / sync policies” instead of “pool management”
- split provider onboarding, mailbox operations, and automation exposure into different views
- rewrite batch behaviors and naming so the workflow is no longer visually or structurally anchored to a mailbox-pool console

### 3. API key + allocation binding management

**Files**

- `server/src/modules/api-key/apiKey.routes.ts`
- `server/src/modules/api-key/apiKey.service.ts`
- `web/src/pages/api-keys/index.tsx`

**Why high risk**

- the current route set historically exposed pool usage concepts such as `/:id/usage`, `/:id/reset-pool`, `/:id/pool-emails`; the new primary admin surface now uses `/:id/allocation-stats`, `/:id/allocation-reset`, `/:id/assigned-mailboxes`
- the frontend page is tightly coupled to rate-limit + pool-email assignment + usage reset flows
- this is very close to the operating model of an automation mailbox service

**Rewrite target**

- recast API keys around scoped access policies and mailbox/domain capabilities rather than pool ownership
- remove or redesign `pool-*` terminology
- move from “API key controls a mailbox pool” to “API key grants explicit capabilities on resources”

### 4. Dashboard and default admin information architecture

**Files**

- `server/src/modules/dashboard/dashboard.routes.ts`
- `server/src/modules/dashboard/dashboard.service.ts`
- `web/src/pages/dashboard/index.tsx`
- `web/src/layouts/MainLayout.tsx`

**Why high risk**

- the dashboard foregrounds mailbox totals, API usage, provider counts, and API-key activity in the first screen
- the left-nav order still places mailbox management, API key, and operations near the top of the product identity
- even with a new coat of paint, the product still reads like an email-pool admin system if this IA stays the same

**Rewrite target**

- redesign the first-run information architecture around domains, ingress health, portal usage, and provider connectivity instead of mailbox pool stats
- change page grouping, labels, and default landing priorities

## B. Mixed / should be renamed or partially redesigned

These areas are not automatically unsafe, but they still inherit naming or compatibility patterns that should be cleaned up during a rewrite.

### 5. Domain mailbox external API compatibility layer

**Files**

- `server/src/modules/domain-mailbox/domainMailbox.api.routes.ts`
- `server/src/modules/domain-mailbox/domainMailbox.pool.service.ts`

**Why mixed**

- the underlying capability is more original (domain mailboxes, batch tags, domain selectors)
- but route naming historically mirrored old automation patterns: `/get-mailbox`, `/mail_new`, `/mail_all`, `/mail_text`, `/pool-stats`, `/reset-pool`; the new primary surface now uses `/mailboxes/allocate`, `/messages/latest`, `/messages`, `/messages/text`, `/mailboxes/allocation-stats`, `/mailboxes/allocation-reset`

**Rewrite target**

- keep the domain-mailbox capability
- rename the public route model so it no longer mirrors the classic mailbox-pool compatibility surface

### 6. Outlook-centric external mailbox flow

**Files**

- `server/src/modules/mail/providers/outlook.adapter.ts`
- `server/src/modules/email/email.oauth.service.ts`
- `server/src/modules/email/email.oauth.routes.ts`
- `web/src/pages/emails/index.tsx` (Outlook-specific onboarding sections)

**Why mixed**

- Outlook support itself is not the problem
- the risk is keeping Outlook as the dominant historical center of the product narrative and external mailbox workflow

**Rewrite target**

- preserve Outlook support, but flatten it into a provider-neutral connector model
- avoid letting Outlook-specific mailbox pool behavior define the rest of the system

## C. Lower-risk / already stronger standalone identity

These areas already look meaningfully broader than a generic mailbox-pool project and are the best foundation for a public standalone identity.

### 7. Domain mailbox operations and management

**Files**

- `server/src/modules/domain/domain.routes.ts`
- `server/src/modules/domain/domain.service.ts`
- `server/src/modules/domain-mailbox/domainMailbox.routes.ts`
- `web/src/pages/domains/index.tsx`
- `web/src/pages/domain-mailboxes/index.tsx`

**Why lower risk**

- domain lifecycle and domain mailbox CRUD move the product beyond external mailbox pooling
- this area reads like mail operations infrastructure, not just mailbox allocation

### 8. Mailbox portal users and portal session flows

**Files**

- `server/src/modules/mailbox-user/mailboxUser.routes.ts`
- `server/src/modules/mailbox-user/mailboxPortal.routes.ts`
- `server/src/modules/mailbox-user/mailboxUser.service.ts`
- `web/src/layouts/MailboxLayout.tsx`
- `web/src/pages/mail-portal/*`

**Why lower risk**

- mailbox-user login, portal session handling, sent-message access, password changes, and forwarding are a different product layer from classic pool APIs

### 9. Domain messages, ingress, and worker-based inbound flow

**Files**

- `server/src/modules/message/*`
- `server/src/modules/ingress/*`
- `cloudflare/workers/allmail-edge/src/index.ts`
- `CLOUDFLARE-DEPLOY.md`

**Why lower risk**

- signed ingress, Cloudflare Email Routing integration, and domain message persistence make the project look like a mail control plane rather than a mailbox-list allocator

### 10. Outbound sending and delivery operations

**Files**

- `server/src/modules/send/*`
- `server/src/modules/send/providers/resend.ts`
- `web/src/pages/sending-configs/index.tsx`

**Why lower risk**

- outbound configs, message history, and send operations add a control-plane dimension that is broader than the earlier external-mailbox focus

### 11. Multi-provider provider abstraction

**Files**

- `server/src/modules/mail/providers/gmail.adapter.ts`
- `server/src/modules/mail/providers/qq.adapter.ts`
- `server/src/modules/mail/providers/outlook.adapter.ts`
- `server/src/modules/mail/providers/registry.ts`

**Why lower risk**

- Gmail + QQ + Outlook adapters, OAuth/app-password splits, and fetch strategy handling are meaningfully broader than a single Outlook-first product shape

## Rewrite order recommendation

If you want to reduce GongXi-Mail-adjacent derivative risk before public release, rewrite in this order:

1. `server/src/modules/mail/*`
2. `server/src/modules/email/*` + `web/src/pages/emails/index.tsx`
3. `server/src/modules/api-key/*` + `web/src/pages/api-keys/index.tsx`
4. dashboard + main admin information architecture
5. domain mailbox public API route naming
6. visual redesign across admin pages

## What matters most

### Effective changes

- service logic rewrite
- domain model / terminology rewrite
- external route redesign
- information architecture change
- workflow and state-model change

### Helpful but secondary

- new visual language
- different component styling
- different icons / spacing / color system

## Short answer

If you **fully rewrite the GongXi-Mail-adjacent service layer**, **rename the public API and product model**, and **change the frontend information architecture + visual style**, the repository will become meaningfully more independent in practice.

If you only change the frontend style, it will still read like the same product with a different skin.

Even after a rewrite, unresolved upstream license risk is still a release blocker until you have a clean legal basis for public redistribution.
