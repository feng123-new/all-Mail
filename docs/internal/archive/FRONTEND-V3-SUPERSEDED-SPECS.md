# Frontend V3 superseded specification record

Date: 2026-08-04
Current contract: [`../../FRONTEND-REFACTOR-PLAN.md`](../../FRONTEND-REFACTOR-PLAN.md)
Completed release: v2.1.0

## Purpose

This record preserves the relationship between three earlier frontend specifications and the completed Frontend V3 implementation. The source files remain in their original locations for traceability, but they are historical inputs rather than active implementation or acceptance contracts.

## Superseded specifications

| Historical specification | Original focus | Final disposition |
| --- | --- | --- |
| [`../superpowers/specs/2026-03-27-all-mail-frontend-redesign-design.md`](../superpowers/specs/2026-03-27-all-mail-frontend-redesign-design.md) | Deep frontend architecture, design system, and contract-layer migration | Superseded by the PR #51–#59 execution record. Contract modules already existed in the stable Go-only baseline; Frontend V3 retained them and concentrated on shells, semantic workspaces, and regression gates. |
| [`../superpowers/specs/2026-03-28-all-mail-frontend-hardening-redesign-design.md`](../superpowers/specs/2026-03-28-all-mail-frontend-hardening-redesign-design.md) | Cookie authentication, route protection, frontend hardening, and test enforcement | Cookie-first sessions and most hardening were already implemented before Frontend V3. The completed program preserved those boundaries and added permanent source/browser contracts. |
| [`../superpowers/specs/2026-04-05-all-mail-ui-aesthetic-upgrade-design.md`](../superpowers/specs/2026-04-05-all-mail-ui-aesthetic-upgrade-design.md) | Visual hierarchy, shell quieting, Dashboard and portal polish | Implemented through semantic tokens, grouped responsive shells, explainable Dashboard state, Inbox-first portal context, and restrained operational surfaces. |

## Current source of truth

For current frontend behavior, architecture, acceptance, and verification, use:

1. [`../../FRONTEND-REFACTOR-PLAN.md`](../../FRONTEND-REFACTOR-PLAN.md) — completed PR #51–#59 execution record;
2. [`../../../web/README.md`](../../../web/README.md) — developer workflow and frontend boundaries;
3. [`../../../scripts/frontend-v3-contract.test.mjs`](../../../scripts/frontend-v3-contract.test.mjs) — source-level non-regression contract;
4. [`../../../web/e2e/frontend-v3.spec.ts`](../../../web/e2e/frontend-v3.spec.ts) — release-required desktop/mobile browser smoke;
5. [`../../../CHANGELOG.md`](../../../CHANGELOG.md) — v2.1.0 release boundary.

## Historical-use rule

The superseded specifications may be cited to explain design history, but new implementation work must not use them to override current route, authentication, security, visual, or verification contracts. When historical guidance conflicts with v2.1.0 source or tests, the current source and completed execution record win.
