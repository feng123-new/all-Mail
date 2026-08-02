# Runtime configuration contract

`runtime-env.json` is the exact key set for the canonical production `.env.example` template. A change to the template must update the manifest in the same pull request.

`retired-env.json` lists configuration aliases and hidden fallbacks that are no longer accepted in production. The production validator rejects these names even when the supplied value is empty. Local-only settings such as `CORS_ORIGIN` remain valid when `ALL_MAIL_RUNTIME_ENV` is not `production`, but they must not be copied into the production environment.

`route-ownership.json` is the canonical public route-family ownership contract. It is loaded by the Go gateway before the listener starts and drives routing, response ownership headers, and bounded Prometheus metrics. Ownership changes are committed revisions, not environment toggles.

Scopes in the environment manifest are process ownership, not documentation labels:

- `go-business-api` values are injected into the long-running private Go API;
- `init` values are used only by the one-shot initializer;
- `init-import` values are compatibility inputs that the initializer copies into encrypted or audited PostgreSQL state;
- `worker-deploy` values are consumed by the Cloudflare deployment tool, not the backend API.

The long-running API does not receive `SEND_ENABLED_DOMAINS`, provider OAuth credentials, or `INGRESS_SIGNING_SECRET`. After one successful initializer import and verification, populated compatibility values should be removed from the production `.env`.

Internal container variables such as `DATABASE_URL`, `REDIS_URL`, `ALL_MAIL_RUNTIME_ENV`, `ALL_MAIL_STATE_DIR`, `ALL_MAIL_STATIC_DIR`, `GO_BUSINESS_API_URL`, `ALL_MAIL_ROUTE_OWNERSHIP_FILE`, and fixed secret-file paths are owned by images or Compose and are intentionally absent from the operator template.

Node.js 24 LTS is the Web and Cloudflare Worker build-tool baseline; it is not present in the production runtime image. The old `NODE_ENV` name is retired from the Go production contract.

The Go image override variables are internal Compose inputs. Retired legacy API aliases remain rejected.

Production startup uses `./scripts/compose-up.sh`, which runs the `init` scope in a temporary `app init` container before starting the six long-running Compose services. There is no initializer service or alternate production API image.

Runtime database ownership is file-backed: the initializer exports independent API, forwarding, and retention URLs to `database_runtime_data`. The owner `POSTGRES_PASSWORD` remains an initializer-only operator input.