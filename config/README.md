# Runtime configuration contract

`runtime-env.json` is the exact key set for the canonical production `.env.example` template. A change to the template must update the manifest in the same pull request.

`retired-env.json` lists configuration aliases and hidden fallbacks that are no longer accepted in production. The production validator rejects these names even when the supplied value is empty. Local-only settings such as `CORS_ORIGIN` remain valid when `NODE_ENV` is not `production`, but they must not be copied into the production environment.

Scopes in the manifest are process ownership, not documentation labels:

- `business-api` values are injected into the long-running internal API;
- `init` values are used only by the one-shot initializer;
- `init-import` values are legacy compatibility inputs that the initializer copies into encrypted or audited PostgreSQL state;
- `worker-deploy` values are consumed by the Cloudflare deployment tool, not the backend API.

The long-running API does not receive `SEND_ENABLED_DOMAINS`, provider OAuth credentials, or `INGRESS_SIGNING_SECRET`. After one successful initializer import and verification, populated compatibility values should be removed from the production `.env`.

Internal container variables such as `DATABASE_URL`, `REDIS_URL`, `ALL_MAIL_STATE_DIR`, `ALL_MAIL_STATIC_DIR`, `BUSINESS_API_URL`, and fixed secret-file paths are owned by Compose and are intentionally absent from the operator template.

Node.js 24 LTS is the repository runtime baseline. Docker, CI, and local version files must move together; Dependabot is configured not to advance the Docker image to a new Node major before an explicit LTS cutover.

The `BUSINESS_API_URL` and image override variables are internal Compose inputs. The retired `LEGACY_API_URL` and `ALL_MAIL_LEGACY_IMAGE` names are rejected.
