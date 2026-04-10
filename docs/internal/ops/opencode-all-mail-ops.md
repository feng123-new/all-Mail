# OpenCode / OpenClaw all-Mail Ops

## What this integration is for

This integration turns `all-Mail` into a practical operator-facing mailbox tool inside OpenClaw/OpenCode.

It is designed for two common usage modes:

1. **Direct mailbox operations**
   - quickly allocate a mailbox
   - read the latest message
   - extract text or a verification code
   - inspect pool stats
   - reset scoped usage

2. **Primary + fallback mailbox strategy**
   - use a dedicated domain mailbox pool first
   - keep `test01` as the reserved fallback Outlook pool

## OpenClaw entrypoint

Use:

- `bash ~/.config/opencode/scripts/all_mail_ops.sh ...`

The underlying implementation lives at:

- `<repo-root>/tools/all_mail_ops.py`

## Local config

The first bootstrap writes a local config file here:

- `~/.config/opencode/all-mail-ops.json`

That file stores:
- all-Mail base URL
- primary domain
- primary batch tag
- fallback group
- scoped domain API key
- scoped external API key

## Bootstrap behavior

`bootstrap` does all of the following:
- login to all-Mail admin
- find the configured primary domain
- find the fallback group (`test01`)
- delete older `openclaw-all-mail-*` scoped keys
- create a fresh domain API key limited to the primary domain
- create a fresh external API key limited to `test01`
- ensure the primary domain API_POOL batch exists
- persist the resulting config locally

## Functional surface

### `status`
Returns:
- `/health`
- primary domain pool stats
- fallback group stats
- local config metadata

### `allocate --mode auto`
Behavior:
- check primary domain pool remaining count
- if remaining > 0, allocate from primary domain batch
- otherwise allocate from `test01`

### `latest --email <email>`
Fetch the latest message for a mailbox.

### `text --email <email>`
Return message text using the appropriate domain/external API.

### `code --email <email>`
Extract a verification code using the default regex:
- `\b(\d{6})\b`

### `list-domain`
List domain mailboxes in the configured primary batch.

### `list-external`
List external mailboxes visible to the scoped `test01` key.

### `reset-domain`
Reset allocation usage for the configured primary batch.

### `reset-fallback`
Reset allocation usage for the `test01` fallback group.

## Why `test01` is the fallback lane

`test01` is treated as the reserve lane because:
- it is already a dedicated external mailbox group
- it should not be the noisy default path
- it is useful when the primary domain pool is empty or temporarily unsuitable

## Recommended usage pattern

### Day-to-day mailbox use
1. `bootstrap`
2. `status`
3. `allocate --mode auto`
4. `latest` / `text` / `code`

### Registration support
- prefer domain mailboxes for normal attempts
- keep `test01` as fallback only
- if the target flow triggers human verification, stop escalating automation and keep the mailbox state visible for manual continuation

## Design boundary

This integration does **not** push campaign logic into `all-Mail`.

`all-Mail` remains the mailbox control plane.
OpenClaw/OpenCode side tooling decides:
- when to allocate
- when to read
- when to fallback
- when to pause for manual intervention
