# all-Mail-Desktop Solution Plan

## 1. Goal

Create a dedicated Windows desktop product line named `all-Mail-Desktop` for the **unified mail console** use case.

This desktop track focuses on the core mailbox-management experience:

- Outlook / Gmail / QQ account management
- OAuth / app-password connection flows
- inbox / sent / junk reading
- sending and operational dashboard flows
- administrator and API-oriented control-plane operations

Cloudflare domain-mail, Worker ingress, Email Routing, and related developer-facing capabilities remain **extension features**, not the core desktop product.

## 2. Product positioning

`all-Mail-Desktop` is not a forked rebrand of the current repository. It is a dedicated Windows desktop edition of the `all-Mail` control plane.

Recommended product split:

- `all-Mail` → server-first / operator-first repository, keeps Docker, PostgreSQL, Redis, domain-mail, and Cloudflare extensions
- `all-Mail-Desktop` → Windows-first desktop distribution, optimized for day-to-day mailbox operations

## 3. Why split out a desktop repository

The current repository mixes:

- browser-first admin UI (`web/`)
- service/runtime logic (`server/`)
- Docker deployment (`docker-compose.yml`, `Dockerfile`)
- Cloudflare edge delivery (`cloudflare/workers/allmail-edge/`)
- provider helper scripts (`gmail_oauth/`, `oauth-temp/`)

That shape is good for the server product, but not ideal as the direct source tree for a Windows desktop product. A dedicated `all-Mail-Desktop` repository makes the following easier:

- desktop-specific packaging and installer logic
- desktop-only feature flags and UI trimming
- Windows update channel and release cadence
- local secure-storage integration
- gradual divergence of local runtime and storage strategy

## 4. Current repo assets that should be reused

### Directly reusable

- `web/` React + Ant Design admin UI foundations
- `server/src/app.ts` SPA serving structure and route topology
- `server/src/modules/email/*` mailbox account management flows
- `server/src/modules/mail/*` mail read / text extraction / API usage flows
- `server/src/modules/auth/*`, `server/src/modules/admin/*`, `server/src/modules/dashboard/*`
- provider OAuth concepts and helper logic in `server/src/modules/email/*`
- documentation tone, naming, and product positioning already established in `README.md`

### Reusable with adaptation

- `server/prisma/schema.prisma` → usable as the domain model source, but not yet desktop-local-storage-ready
- `oauth-temp/` and `gmail_oauth/` → usable as reference flows, but should become optional tools or be absorbed into desktop UI over time
- API routes under `/admin/*` and `/api/*` → good contract candidates for desktop runtime mode

### Not core to desktop v1

- `cloudflare/workers/allmail-edge/`
- `server/src/modules/domain/*`
- `server/src/modules/domain-mailbox/*`
- `server/src/modules/ingress/*`
- Cloudflare deployment docs and routing flow

These belong in a future extension lane, not in desktop v1.

## 5. Recommended technical direction

## Decision

Use **Electron** for `all-Mail-Desktop` v1.

Why Electron first:

- easiest way to reuse the current React SPA with minimal UI rewrite
- easiest way to embed a local Node/Fastify runtime when needed
- simplest Windows installer path for the first usable desktop release
- faster to validate the desktop product direction before optimizing package size

Why not Tauri first:

- Tauri is attractive long-term, but the current stack still assumes Node/Fastify + Prisma + PostgreSQL-oriented data modeling
- the product's first hard problem is runtime/storage packaging, not shell size
- Electron reduces first-release architecture risk

## 6. Recommended delivery stages

### Stage A — Desktop Shell Mode (recommended first release)

Goal: ship a Windows package quickly without rewriting the backend.

Shape:

- Electron desktop shell
- bundled or connectable React UI
- desktop app talks to an existing `all-Mail` server endpoint
- supports two connection choices:
  - **Local Server Edition**: user already runs `all-Mail` through Docker or another local service path
  - **Remote Server Edition**: user connects to an existing hosted instance

Benefits:

- fastest route to a usable Windows application
- zero data-model rewrite on day one
- zero Cloudflare coupling in the desktop product
- preserves the server product as the source of truth

Limits:

- not a fully standalone offline application
- still depends on a reachable server endpoint

### Stage B — Desktop Local Runtime Mode

Goal: make the desktop app usable without an externally managed server stack.

Shape:

- Electron shell remains
- local Fastify runtime packaged with the desktop app
- Redis removed or made entirely optional in desktop mode
- storage strategy migrated for desktop-local use

Key requirement:

- introduce a dedicated desktop data strategy instead of assuming current PostgreSQL production/runtime shape

### Stage C — Developer Extension Mode

Goal: expose advanced extension capabilities without polluting the core desktop experience.

Includes:

- Cloudflare domain-mail
- Worker ingress / Email Routing related controls
- advanced operator diagnostics
- provider-specific recovery tools

This stage should remain hidden behind a desktop feature flag or extension center.

## 7. Data strategy recommendation

This is the main architectural risk.

The current schema is PostgreSQL-oriented and contains many provider-specific field definitions and DB annotations. Therefore:

- do **not** promise "single-file local database" in the first desktop milestone
- do **not** try to ship PostgreSQL + Redis as the primary desktop experience
- do **not** merge Cloudflare extension requirements into desktop storage decisions

Recommended path:

1. v1 uses server-backed mode
2. v1.5 creates a desktop-storage compatibility spike
3. only after the spike, decide between:
   - SQLite-compatible Prisma split
   - dedicated desktop persistence layer
   - lightweight local server mode backed by an alternative data adapter

## 8. Proposed repository structure for `all-Mail-Desktop`

```text
all-Mail-Desktop/
├── desktop/                 # Electron shell
├── web/                     # desktop-facing React UI (initially copied/adapted from all-Mail/web)
├── packages/
│   ├── api-client/          # typed desktop API client
│   ├── shared-types/        # contracts shared with server edition
│   ├── core-mail/           # provider-agnostic mailbox operations
│   └── extension-cloud/     # optional Cloudflare extension package
├── docs/
│   ├── architecture.md
│   ├── runtime-modes.md
│   └── release-plan.md
└── installer/
    └── windows/             # NSIS / electron-builder related assets
```

## 9. Runtime modes

`all-Mail-Desktop` should define three explicit runtime modes.

### 9.1 Core desktop mode

- desktop UI only shows core mailbox features
- no domain-mail or Cloudflare menus
- suitable for normal Windows users

### 9.2 Connected server mode

- desktop connects to local or remote `all-Mail` server
- preferred first release mode

### 9.3 Extension-enabled mode

- developer toggles advanced features
- Cloudflare menus become visible only after explicit enablement
- unsupported features remain clearly labeled as advanced/server-side

## 10. Security model for desktop

- desktop shell must not expose raw secrets in renderer storage
- OAuth app config should prefer secure OS-backed storage where possible
- desktop logs must avoid writing refresh tokens or client secrets in plaintext
- extension credentials remain disabled by default in core mode

## 11. Packaging and release direction

- package target: Windows installer (`.exe`) via Electron tooling
- updater: phased in after first stable installer
- first release should avoid tray icons, OS-native mail integration, or background service complexity

## 12. Explicit non-goals for v1

- full standalone local Postgres + Redis bundle
- Cloudflare domain-mail as a default menu
- native Windows notification integration
- Outlook / Gmail helper-script parity inside desktop on day one
- mobile / macOS / Linux parity

## 13. Phase plan

### Phase 0 — planning and extraction

- define desktop scope
- define shared API contract
- define feature flags for extension modules

### Phase 1 — Windows shell prototype

- bootstrap Electron repo
- load desktop web build inside Electron
- support server connection settings
- login, dashboard, mailbox list, mailbox detail, send mail

### Phase 2 — desktop-first UX cleanup

- remove irrelevant server/developer menus from default desktop mode
- add Windows-friendly onboarding and connection wizard
- add update channel and installer polish

### Phase 3 — local runtime research

- validate local service packaging
- assess desktop data adapter strategy
- decide whether standalone offline mode is worth shipping

### Phase 4 — extension center

- add optional Cloudflare extension
- keep it opt-in and developer-focused

## 14. Go / no-go recommendation

Go forward with `all-Mail-Desktop`, but keep the first release intentionally narrow:

- desktop shell first
- server-backed first
- core mailbox console first
- Cloudflare extension later

That is the cleanest way to turn `all-Mail` into a practical Windows product without collapsing the current server edition into an over-scoped installer project.
