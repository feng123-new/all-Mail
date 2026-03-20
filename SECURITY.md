# Security Policy

## Supported scope

Security reports are welcome for the current `all-Mail` repository, including:

- admin authentication and session handling
- mailbox portal authentication and authorization
- API key handling
- OAuth callback and token storage flows
- ingress signature validation
- email sending and provider integration paths
- secret exposure in docs, scripts, or committed artifacts

## Reporting a vulnerability

Please do **not** open a public issue for sensitive vulnerabilities.

Instead, report privately to the maintainer with:

- affected area
- impact
- reproduction steps
- proof-of-concept if available
- mitigation ideas if you have them

If a private contact channel is not yet documented publicly, open a minimal issue asking for a secure reporting path without disclosing details.

## Response targets

- initial acknowledgement target: within 72 hours
- follow-up status target: within 7 days when possible

These targets are best-effort for an open-source maintenance workflow and may vary during holidays or maintainer unavailability.

## Good-faith testing rules

- Do not access data you do not own.
- Do not target real production mailboxes without permission.
- Do not exfiltrate secrets, tokens, or message content.
- Prefer local reproduction against your own environment.

## Secrets hygiene

If you discover committed secrets or runtime artifacts:

1. Stop sharing the repository snapshot further.
2. Rotate the affected secret.
3. Remove the artifact from the repository and ignore future outputs.
4. Document the cleanup in the relevant PR.

## Out of scope

The following are usually out of scope unless they create a real exploitable path:

- self-inflicted local misconfiguration
- outdated historical docs that do not affect runtime behavior
- missing hardening suggestions without a concrete exploit path

## Dependency and provider risk

Please also report issues involving:

- OAuth scope misuse
- provider token refresh weaknesses
- weak ingress signing assumptions
- dangerous default credentials or example configs
