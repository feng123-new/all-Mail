# PR 6 one-shot administrator bootstrap status

## Stack

This change is based on PR #5 and must be merged after it.

## Ownership changes

| Capability | Before | After |
| --- | --- | --- |
| Initial admin creation | API startup and login fallback | `legacy-init` only |
| Bootstrap credential | Mixed into long-lived secret bundle | Separate `bootstrap-admin.env` |
| JWT/encryption secrets | `bootstrap-secrets.env` | `runtime-secrets.env` |
| API environment | Received admin username/password and legacy 2FA | Receives none of them |
| Initial password retirement | Plaintext persisted indefinitely | File removed after first rotation |
| Admin 2FA | DB plus environment legacy path | DB only |
| Existing-admin behavior | Environment credential could recreate/fallback | Initializer never overwrites existing admin |

## Removed compatibility paths

```text
DOMAIN_BOOTSTRAP_ADMIN_USERNAME
DOMAIN_BOOTSTRAP_ADMIN_PASSWORD
ADMIN_2FA_SECRET
ensureBootstrapAdmin()
login-time administrator creation
environment password authentication
adminId=0
legacyEnv
```

## Upgrade migration

The old `bootstrap-secrets.env` is split atomically. Historical files may not contain the custom bootstrap username, so the initializer compares the preserved password with pending administrator hashes and rewrites the matched username before keeping the one-time file.

## Security invariants

- only `legacy-init` can create the initial administrator;
- creation is protected by a PostgreSQL advisory transaction lock;
- long-running Fastify has no bootstrap username/password;
- every administrator token maps to an active DB row with a positive ID;
- runtime secret files contain no administrator plaintext;
- one-time plaintext disappears after the forced password rotation;
- rerunning the initializer cannot create another administrator or restore plaintext;
- environment-managed administrator 2FA cannot be re-enabled.

## Required evidence

- runtime secret split tests;
- real PostgreSQL bootstrap integration;
- Fastify lint/test/build;
- web lint/test/build;
- Docker first-login and forced-rotation flow;
- API environment inspection;
- post-rotation initializer idempotency;
- existing Go, worker, migration, audit and Docker release gates after retargeting to `main`.

## Rollback

Preserve PostgreSQL, `runtime-secrets.env`, `bootstrap-admin.env`, and a pre-upgrade copy of `bootstrap-secrets.env`. Restore the file layout expected by the target revision before starting it. Never run old and new initializers concurrently.

## Remaining authentication migration

Fastify still owns database-backed admin login, JWT/cookies, password changes, 2FA setup/verification, authorization checks, and session validity. Those business semantics remain until the final vertical authentication port to Go; this PR removes only the obsolete environment identity and unsafe creation lifecycle.
