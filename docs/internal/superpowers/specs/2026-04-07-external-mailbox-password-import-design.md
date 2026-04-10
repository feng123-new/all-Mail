# External mailbox login password and batch import redesign

## Goal

Align the external mailbox connection flow with real operator expectations:

- preserve existing connection credentials used by IMAP/SMTP and OAuth flows
- add a separate persisted field for the mailbox account's own login password
- allow 2FA-gated reveal and later补录 of that login password
- support a mainstream batch import base format first, while keeping old provider-token formats compatible

## Problem statement

The current implementation overloads `EmailAccount.password` with different meanings:

- for IMAP/SMTP profiles it is the actual connection credential
- for some historical OAuth imports it may also contain an appended mailbox login password

This causes two operator-facing problems:

1. the UI cannot honestly describe what the stored password means across all providers
2. the import format is biased toward provider-prefixed tokens like `OUTLOOK_OAUTH----...`, which is not the mainstream format operators naturally have on hand

## Approved design

### 1. Split connection credential from account login password

Add a new persisted field on `EmailAccount` for `accountLoginPassword`.

- `password` remains the live connection credential used by IMAP/SMTP adapters
- `accountLoginPassword` stores the mailbox account's own login password as optional supplemental data
- OAuth mailboxes may store `accountLoginPassword` even though they authenticate with refresh tokens

This avoids breaking existing mailbox connectivity while fixing the operator-facing semantics.

### 2. Reveal and edit semantics

The admin UI exposes two separate concepts:

- connection credential / authorization code / app password
- account login password (optional)

`accountLoginPassword` is revealable only after the existing 2FA step-up flow. The same short-lived reveal grant can also unlock later补录 inside the edit form.

Behavior:

- if no account login password is stored, row action should explain that none is stored yet
- edit mode should offer an explicit field to save or replace the account login password after step-up approval
- OAuth mailbox rows may reveal account login password if stored
- connection credentials keep their existing provider-specific behavior and help text

### 3. Batch import redesign

Batch import becomes layered:

#### Preferred mainstream base formats

- `email----password`
- `email----password----clientId----refreshToken`
- `email----password----clientId----refreshToken----clientSecret`

Interpretation:

- for IMAP/SMTP profiles inferred from the email domain, `password` fills both connection password and account login password by default
- for OAuth profiles inferred from the email domain, `password` fills `accountLoginPassword`, while OAuth fields continue to drive connectivity

#### Still-supported legacy formats

- provider-token forms like `OUTLOOK_OAUTH----...`
- older exported formats already supported by the current parser

UI guidance should lead with the mainstream base format and mention provider-token format only as compatibility mode.

### 4. Provider inference rules

Introduce deterministic domain-based provider/profile inference for common domains:

- `outlook.com`, `hotmail.com`, `live.com`, `msn.com` -> Outlook OAuth
- `gmail.com` -> Gmail OAuth by default for 4+/5-column import, Gmail app password for 2-column import only when explicitly selected in UI guidance fallback or legacy token path
- `qq.com` -> QQ IMAP/SMTP
- `163.com` -> 163 IMAP/SMTP
- `126.com` -> 126 IMAP/SMTP
- `icloud.com`, `me.com`, `mac.com` -> iCloud IMAP/SMTP
- `yahoo.com` -> Yahoo IMAP/SMTP
- `zoho.com` -> Zoho IMAP/SMTP
- `fastmail.com` -> Fastmail IMAP/SMTP
- `aol.com` -> AOL IMAP/SMTP
- `gmx.com` -> GMX IMAP/SMTP
- `mail.com` -> Mail.com IMAP/SMTP
- `yandex.com`, `yandex.ru`, `ya.ru` -> Yandex IMAP/SMTP

Unknown domains continue to require explicit legacy token formats or manual form entry.

### 5. Export behavior

Existing export should remain stable for backward compatibility. If raw secrets are exported for OAuth, append the account login password from the new field instead of overloading connection password semantics.

## Backend changes

- Prisma: add `account_login_password` nullable encrypted field on `email_accounts`
- schema/service: accept `accountLoginPassword` in create/update/import/export/reveal flows
- reveal rules: allow revealing `accountLoginPassword` for any provider when stored
- keep `password` reveal behavior for connection-credential scenarios only
- parser: accept mainstream formats before tokenized legacy parsing

## Frontend changes

- emails page: rename and separate labels between connection credential and account login password
- row action: reveal account login password instead of reusing connection-password semantics
- edit modal: add 2FA-gated account login password section for all external mailboxes
- import modal: show base formats first, legacy token formats second

## Verification plan

- backend unit tests for parser, reveal rules, create/update/import/export
- frontend page tests for row action, 2FA gating, no-password state, and import guidance
- Docker-backed repo verification using the existing project gates after implementation
