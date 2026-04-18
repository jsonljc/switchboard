# Creative Pipeline Extraction

**Date:** 2026-04-18
**Status:** Approved
**Priority:** High leverage, low risk

## Goal

Extract `packages/core/src/creative-pipeline/` into `packages/creative-pipeline/` as a standalone package `@switchboard/creative-pipeline`. Pure move — no logic changes.

## Why

- creative-pipeline has zero inbound or outbound dependencies on core siblings
- Not re-exported from core's root barrel
- Only 2 consumers (both in apps/api, both use sub-path import)
- 66 files, ~3,200 lines removed from core
- Sets the architectural precedent: platform logic = core, vertical capabilities = separate packages

## What Changes

1. Move `packages/core/src/creative-pipeline/` to `packages/creative-pipeline/src/`
2. Create `packages/creative-pipeline/package.json` with dependencies: `@switchboard/schemas`, `inngest`, `@anthropic-ai/sdk`, `openai`, `zod`, `@paralleldrive/cuid2`
3. Create `packages/creative-pipeline/tsconfig.json` and `vitest.config.ts`
4. Update 2 consumer files in `apps/api/` to import from `@switchboard/creative-pipeline` instead of `@switchboard/core/creative-pipeline`
5. Remove sub-path export from `packages/core/package.json`
6. Add ESLint and dependency-cruiser rules for the new package
7. Update Dockerfile COPY if needed

## Constraint

Dependency direction must be one-way: `creative-pipeline -> schemas`. Core must NOT depend on creative-pipeline. No new cross-dependencies introduced.

## What Does NOT Change

- Internal creative-pipeline logic
- Test assertions (only import paths)
- Runtime behavior
- Schema definitions (stay in @switchboard/schemas)
- Prisma models (stay in @switchboard/db)
- Dashboard (already decoupled via HTTP)
