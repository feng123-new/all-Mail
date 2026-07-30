# Runtime configuration contract

`runtime-env.json` is the exact key set for the canonical production `.env.example` template. A change to the template must update the manifest in the same pull request.

`retired-env.json` lists configuration aliases and hidden fallbacks that are no longer accepted in production. The production validator rejects these names even when the supplied value is empty. Local-only settings such as `CORS_ORIGIN` remain valid when `NODE_ENV` is not `production`, but they must not be copied into the production environment.

Internal container variables such as `DATABASE_URL`, `REDIS_URL`, `ALL_MAIL_STATE_DIR`, `ALL_MAIL_STATIC_DIR`, `LEGACY_API_URL`, and fixed secret-file paths are owned by Compose and are intentionally absent from the operator template.

Node.js 24 LTS is the repository runtime baseline. Docker, CI, and local version files must move together; Dependabot is configured not to advance the Docker image to a new Node major before an explicit LTS cutover.
