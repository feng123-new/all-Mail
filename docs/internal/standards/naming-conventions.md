# all-Mail Naming Conventions

This document keeps project naming consistent across code, docs, operators, and future subprojects.

## Primary project name

Use:

- `all-Mail`

Use this in:

- README and product docs
- contributor-facing docs
- UI copy when referring to the overall product
- public project descriptions

## Cloudflare-oriented branch name

Use:

- `all-Mail Cloud`

Use this only when referring to:

- the Cloudflare-oriented edge/deployment shape
- architecture discussions that separate the core control plane from the edge plane
- future standalone Cloudflare branch/subproject planning

Do not use it as the default name for the whole repository.

## Worker / technical identifier

Use:

- `allmail-edge`

Use this only for:

- Worker names
- ingress key IDs and deployment manifests
- routing actions and runtime identifiers

Do not use `allmail-edge` as the product name in README-level docs.

## Package and service metadata

Preferred patterns:

- `all-mail-server`
- `all-mail-web`
- `all-mail` for compose/project identifiers where kebab-case is needed

## Historical references

Historical upstream or legacy worker names may appear only when they are:

- part of a migration record
- needed to explain old infrastructure state
- explicitly acknowledged in `PROVENANCE.md`

Avoid using historical names in current product positioning.

## Quick rule of thumb

- Talking to users/contributors? -> `all-Mail`
- Talking about Cloudflare branch architecture? -> `all-Mail Cloud`
- Talking about a Worker/runtime identifier? -> `allmail-edge`
