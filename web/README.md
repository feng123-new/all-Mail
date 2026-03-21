# all-Mail Web Console

`web/` contains the React + Ant Design admin console for `all-Mail`.

## Scope

- dashboard and provider overview
- mailbox management for Outlook / Gmail / QQ
- domain mailbox, portal user, and domain message operations
- API Key, operation log, and system settings pages
- sending configuration pages for outbound mail workflows

## Local development

```bash
npm ci
npm run lint
npm run build
```

By default the frontend talks to the backend through the root deployment or `VITE_DEV_PROXY_TARGET` in `.env.example`.

## Notes

- product-facing naming should stay aligned with the root repository branding (`all-Mail`)
- do not add demo data, screenshots with live secrets, or one-off local assets into this directory
- sanitized repository screenshots can be added under `../docs/screenshots/` after manual review/redaction
