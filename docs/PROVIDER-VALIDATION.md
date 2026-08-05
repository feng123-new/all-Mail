# Provider validation and evidence policy

This document records what the public `all-Mail` repository can prove about external providers and what still requires an operator-owned live account. It applies to the personal, single-host deployment supported by v2.1.2.

## Evidence levels

| Level | What it proves | Where it runs |
| --- | --- | --- |
| Source contract | Provider identifiers, defaults, folders, capability flags, OAuth profiles, and import formats agree across Go, React, schema, and documentation | Required public CI |
| Protocol fixture | Gmail API, Microsoft Graph, IMAP, SMTP, OAuth refresh, paging, send, delete, and error handling work against deterministic local or mocked endpoints | Required public CI |
| Stateful integration | Provider operations agree with PostgreSQL records, encrypted credentials, API routes, and mailbox state transitions | Required public CI with synthetic data |
| Live provider canary | The current provider account policy, regional endpoint, subscription tier, consent screen, folders, and anti-abuse controls accept the configured operation | Operator-owned private environment only |

Public CI intentionally contains **no real provider credentials, mailbox addresses, refresh tokens, app passwords, Cloudflare tokens, or live-account evidence**. A green public workflow proves the implementation and its synthetic contracts; it does not prove that every third-party service will continue accepting every new or existing account.

## External mailbox matrix

| Provider identifier | Primary path | Public evidence | Live acceptance required before production use |
| --- | --- | --- | --- |
| `OUTLOOK` | Microsoft OAuth + Graph; optional separately consented IMAP fallback | Graph list/send/delete fixtures, OAuth profile normalization, refresh-token and PostgreSQL integration | Authorize a disposable Microsoft account with the selected `minimal`, `send`, `manage`, or `full` profile and verify the intended operations |
| `GMAIL` | Google OAuth + Gmail API, or app-password IMAP/SMTP | Gmail list/send/trash fixtures, OAuth profile normalization, refresh-token and PostgreSQL integration | Authorize a disposable Google account or use an app password and verify the intended folders and operations |
| `QQ` | IMAP/SMTP authorization code | Canonical host/port/default-folder contracts and local IMAP/SMTP fixtures | Enable IMAP/SMTP in QQ Mail, generate an authorization code, and verify read/send with a synthetic message |
| `NETEASE_163` | IMAP/SMTP client authorization code | Canonical defaults and local IMAP/SMTP fixtures | Enable client access, generate an authorization code, and verify read/send |
| `NETEASE_126` | IMAP/SMTP client authorization code | Canonical defaults and local IMAP/SMTP fixtures | Enable client access, generate an authorization code, and verify read/send |
| `ICLOUD` | IMAP/SMTP app-specific password | Canonical defaults and local IMAP/SMTP fixtures | Generate an Apple app-specific password and verify read/send |
| `YAHOO` | IMAP/SMTP app password | Canonical defaults and local IMAP/SMTP fixtures | Generate a Yahoo app password and verify read/send |
| `ZOHO` | IMAP/SMTP password or app password according to account policy | Canonical defaults and local IMAP/SMTP fixtures | Confirm the account/region endpoints and verify read/send |
| `ALIYUN` | Aliyun Mail IMAP/SMTP credentials | Canonical defaults and local IMAP/SMTP fixtures | Confirm that third-party protocol access is enabled and verify read/send |
| `AMAZON_WORKMAIL` | Region-specific IMAP/SMTP credentials | Manual-server validation, timeout, and local IMAP/SMTP fixtures | Enter the region-specific endpoints and verify read/send |
| `FASTMAIL` | IMAP/SMTP app password | Canonical defaults and local IMAP/SMTP fixtures | Generate an app password and verify read/send |
| `AOL` | IMAP/SMTP app password | Canonical defaults and local IMAP/SMTP fixtures | Generate an app password and verify read/send |
| `GMX` | IMAP/SMTP account credentials | Canonical defaults, SMTP 587/STARTTLS behavior, and local fixtures | Enable third-party access when required and verify read/send |
| `MAILCOM` | Premium-only IMAP/SMTP account credentials | IMAP 993/TLS, SMTP 587/STARTTLS, `Sent Items`, and `Junk email` regression contracts | Use a Mail.com Premium account, enable POP3/IMAP in web settings, and verify all three folders plus send |
| `YANDEX` | IMAP/SMTP app password or account credential according to account policy | Canonical defaults and local IMAP/SMTP fixtures | Enable protocol access and verify read/send from the deployment region |
| `CUSTOM_IMAP_SMTP` | Operator-supplied public IMAP/SMTP endpoints | Input validation, TLS modes, local protocol fixtures, timeout handling, and SSRF/DNS-pinning tests | Verify the exact hosts, ports, certificates, folders, and authentication method; private and special-use network targets are intentionally rejected |

The hosted domain-mailbox path is separate from these external providers. It is validated through signed Cloudflare ingress, PostgreSQL persistence, mailbox-portal access, forwarding, and outbound sending contracts rather than through the external-provider enum.

## OAuth permission profiles

New Gmail and Outlook OAuth configuration defaults to `minimal`.

| Profile | Mail read | Send | Modify/delete | Provider extensions |
| --- | --- | --- | --- | --- |
| `minimal` | Yes | No | No | No |
| `send` | Yes | Yes | No | No |
| `manage` | Yes | Yes | Yes | No |
| `full` | Yes | Yes | Yes | Gmail provider-wide access, or Microsoft contacts/calendar/mailbox settings |

Changing a saved profile changes future authorization requests. Existing mailbox refresh tokens do not automatically gain broader consent; complete OAuth authorization again before treating newly selected capabilities as available.

## Signed ingress and sending-provider evidence

### Cloudflare Email Routing and R2

Public CI verifies MIME parsing, size limits, deterministic delivery keys, HMAC-SHA256 signing, timestamp skew, Redis replay protection, PostgreSQL deduplication, raw-object compensation, and synthetic mailbox routing. A live deployment must still verify its own Zone, MX records, Email Routing rule, Worker binding, ingress endpoint, and optional R2 lifecycle.

### Resend forwarding and hosted-domain sending

Public CI verifies the forwarding claim/lease state machine, retry classification, idempotency keys, encrypted API-key use, terminal states, and synthetic send responses. A live deployment must verify the sending domain, provider API key, sender identity, regional/network access, and actual delivery to a disposable recipient.

## Personal deployment canary procedure

Run this procedure after adding a provider, changing credentials/scopes/endpoints, upgrading all-Mail, or receiving a provider policy notice:

1. Use a disposable account and synthetic addresses; never use the canary against mail you do not own.
2. Add or reauthorize the account with the narrowest profile that supports the intended operation.
3. Read `INBOX`, sent mail, and junk/spam when the provider exposes those folders.
4. Send a uniquely titled message to a disposable recipient when the selected profile permits sending.
5. Confirm that a deliberate invalid credential produces an actionable provider error without exposing the secret.
6. Run the single-mailbox check and confirm the account returns to `ACTIVE` after valid credentials are restored.
7. Record the provider, account tier, region, selected profile, endpoint, result, and date in a private operator runbook. Do not commit the evidence or credentials to this repository.

A provider should be described as **implementation-tested** when only public contracts and fixtures pass, and **live-validated for this deployment** only after the private canary succeeds. These are deliberately different claims.
