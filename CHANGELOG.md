# Changelog

All notable changes to this project should be documented in this file.

The format is inspired by Keep a Changelog, and this project aims to use semantic versioning for public releases.

## [Unreleased]

- latest bootstrap-login and license updates currently live on `feat/bootstrap-admin-password-change` / PR #1 until they are merged into `main`
- startup now prints the first-login URL, bootstrap admin username, and bootstrap password on first boot, with an explicit localhost replacement warning for remote deployments
- repository licensing has moved from MIT wording to the custom `all-Mail Non-Commercial License`, which blocks commercial use without prior permission
- hardened production dependency tree and reduced `npm audit --omit=dev` to zero known vulnerabilities across `web`, `server`, and `cloudflare/workers/allmail-edge`
- upgraded core runtime packages including `axios`, `react-router-dom`, `fastify`, `mailparser`, `nodemailer`, `undici`, `prisma`, and `@prisma/client`
- added safe public screenshots for dashboard and Outlook OAuth setup to improve repository presentation
- documented publish-readiness and open-source release closure guidance in the main README
- made backend static asset registration degrade gracefully when local `public/` assets are absent during tests or non-Docker runtimes
