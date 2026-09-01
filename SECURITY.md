# Security policy

`all-Mail` is free and open-source software distributed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). Security reports are welcome from users, researchers, operators, and contributors regardless of deployment model.

## Supported versions

| Version | Security support |
| --- | --- |
| `2.1.x` | Supported stable line |
| `2.0.x` | Limited compatibility support; reproduce on the latest `2.1.x` release when possible |
| `< 2.0.0` | Unsupported; reproduce against the latest `2.1.x` release before reporting |
| Unreleased commits | Best effort; not a stable deployment target |

Security fixes are released from the current stable `2.1.x` line. Historical pre-Go and migration-era revisions do not receive patches. A report that also affects `2.0.x` may be assessed for upgrade guidance, but the supported remediation target is the latest stable `2.1.x` release.

## Report a vulnerability privately

Do **not** disclose sensitive details in a public issue, discussion, pull request, commit message, or log attachment.

Use GitHub's private **Report a vulnerability** entry on the repository Security page when it is available. Include:

- affected release, commit, image digest, and deployment topology;
- impact and the security boundary crossed;
- minimal reproduction steps or a proof of concept;
- whether real mailbox data, credentials, or provider accounts were touched;
- suggested mitigation, if known;
- a safe way to contact you for follow-up.

When the private reporting entry is unavailable, open a minimal public issue asking the maintainer to establish a private channel. Do not include exploit details in that issue.

## Response targets

These targets are best effort for a maintainer-run project:

- acknowledgement within 72 hours;
- initial triage within 7 days;
- status updates at least every 14 days while a confirmed issue is being handled;
- coordinated disclosure after a fix or mitigation is available.

A report may be closed as unsupported when it affects only an obsolete revision, requires intentionally unsafe local configuration, or does not cross a documented trust boundary.

## In-scope security boundaries

Reports are especially useful for:

- administrator or mailbox authentication, session revocation, 2FA, and password handling;
- API-key authentication, permissions, rate limiting, and usage accounting;
- OAuth authorization, state handling, scope policy, token refresh, and encrypted storage;
- signed ingress validation, replay protection, mailbox routing, and message persistence;
- forwarding, outbound sending, provider calls, and secret decryption;
- PostgreSQL role isolation, Redis authentication, Docker networks, secret volumes, and private ports;
- trusted-proxy identity, browser same-origin enforcement, CSP, clickjacking protection, and metrics exposure;
- migration, backup, restore, or rollback behavior that can expose or corrupt protected data;
- secrets, tokens, mailbox content, or personal data committed to the repository or emitted in logs.

## Good-faith testing

- Test only systems, mailboxes, accounts, and data you own or are explicitly authorized to use.
- Prefer a disposable local Compose deployment and synthetic messages.
- Stop when you encounter data that is not yours.
- Do not persist, exfiltrate, publish, or use credentials or message content.
- Do not degrade provider services, bypass rate limits at scale, or perform denial-of-service testing.
- Redact secrets and personal data from all evidence.

Good-faith research that follows these rules will not be treated as malicious by the maintainer.

## Secret incident response

When a real secret or protected artifact is exposed:

1. rotate or revoke it immediately;
2. stop distributing the affected artifact or image;
3. preserve the minimum evidence needed for investigation;
4. remove the secret from the active tree and prevent recurrence;
5. assess repository history, release assets, container layers, logs, and backups;
6. document the remediation privately before coordinated disclosure.

Deleting a committed secret is not sufficient; rotation is required.
