# all-Mail Provenance

`all-Mail` is the current personal open-source email operations project maintained in this repository.

## Positioning

This project is presented as an independent repository with its own product scope, documentation, deployment flow, and operator decisions.

Its current focus is:

- unified management of external mailbox providers
- domain mailbox operations and portal access
- ingress, sending, and operational tooling around the same control plane

## Acknowledgements

Several earlier open-source projects informed the evolution of this repository.

### `wjn6/GongXi-Mail`

This project provided early reference material for:

- Outlook mailbox pool management patterns
- Fastify + Prisma + React based control-plane structure
- external mailbox API surfaces and admin workflows

### `feng123-new/mailfree`

This project provided early reference material for:

- Cloudflare Email Routing / Worker based mail ingress ideas
- temporary and domain-mail product patterns
- edge-oriented deployment thinking

## What all-Mail adds today

Compared with those earlier references, the current repository has moved toward a broader unified control plane that includes:

- Outlook / Gmail / QQ multi-provider mailbox management
- provider-aware OAuth and app-password flows
- domain mailboxes, mailbox users, portal login, and message browsing
- signed ingress integration for Cloudflare worker delivery
- outbound sending and operational documentation for real deployments

## Repository policy

Upstream inspirations are acknowledged here so the main product documentation can stay focused on the current repository itself.

The main README, package metadata, helper scripts, and operator docs use `all-Mail` as the primary project identity.
