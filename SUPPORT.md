# Support

`all-Mail` is free and open-source software licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`); see [`LICENSE`](./LICENSE). Community support is best effort and does not create a service-level agreement. Commercial use is permitted subject to the license terms.

## Supported target

Support requests should reproduce on the latest stable `2.1.x` release or on the exact current `main` commit when the issue is about unreleased development. Pre-2.0 Node/Fastify/Prisma deployments and retired migration branches are unsupported except as inputs to a documented upgrade or restore investigation.

## Where to ask

- **Bug or regression:** open a GitHub issue with a minimal reproduction.
- **Feature request:** open a GitHub issue describing the operator use case and expected outcome.
- **Security vulnerability:** follow [`SECURITY.md`](./SECURITY.md); never post sensitive details publicly.
- **Commercial deployment or paid service:** commercial use is permitted under `AGPL-3.0-only`; support, warranty, and hosted-service arrangements are separate from the open-source license. Modified versions offered to users over a network must satisfy the AGPL source-availability obligations.

## Required diagnostics

Include the smallest useful, redacted set:

```bash
docker compose ps -a
docker compose logs --no-color --timestamps \
  app go-business-api worker-forwarding worker-retention postgres redis

docker compose exec -T app allmail version --json
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Also include:

- the exact Git tag, commit SHA, or image digest;
- host OS, CPU architecture, Docker Engine, and Docker Compose versions;
- whether the deployment builds locally or uses the published GHCR image;
- the failing command, expected result, and actual result;
- relevant Cloudflare Worker, OAuth provider, SMTP/IMAP, PostgreSQL, or Redis context;
- whether the problem began after an upgrade, restore, secret rotation, or configuration change.

For frontend regressions, also include:

- the exact route and whether it occurs in the administrator console or mailbox portal;
- browser name/version and viewport size;
- whether the failure reproduces at 1440×900 or 390×844;
- a sanitized screenshot or Playwright trace that contains no mailbox credentials, tokens, raw messages, or private addresses.

Never include `.env`, database URL files, JWT/encryption/Redis secrets, OAuth client secrets, refresh tokens, API keys, bootstrap passwords, raw messages, or unredacted mailbox addresses.

## Support boundaries

The maintainer may ask you to:

- reproduce on `v2.1.2` or a later stable patch;
- validate `docker compose config --quiet`;
- run the four runtime doctors;
- follow the canonical upgrade, rollback, backup, or restore procedure;
- reproduce frontend issues with the release-required desktop/mobile browser smoke;
- provide a synthetic reproduction instead of production data.

Requests may be closed when they rely on modified security boundaries, unsupported revisions, incomplete diagnostics, requests outside the project's support scope, or secrets posted publicly.
