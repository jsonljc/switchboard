# Fix Launch — Auth Trust Binding

**Date:** 2026-04-29
**Status:** Design
**Severity:** CRITICAL
**Source:** Pre-launch security audit, findings TI-1, TI-2, TI-3, TI-4 (`.audit/12-pre-launch-security-audit.md`)

## Problem

Multiple route handlers and the `assertOrgAccess` helper allow `organizationId` to be derived from request body or treated as "no auth configured" when an unscoped API key is presented. Combined, they form a tenant-impersonation primitive: an authenticated user (or the holder of a static API key without `API_KEY_METADATA` mapping) can submit work, halt deployments, or operate against any organization by setting `body.organizationId`.

Specifically:
- `apps/api/src/routes/ingress.ts:21-36` — `/api/ingress/submit` reads `organizationId` purely from the request body, with no auth-derived check.
- `apps/api/src/routes/governance.ts:161` — uses `body.organizationId ?? request.organizationIdFromAuth` (body wins).
- `apps/api/src/routes/actions.ts:62, 351`, `apps/api/src/routes/execute.ts:62` — `request.organizationIdFromAuth ?? body.organizationId` (body fallback).
- `apps/api/src/middleware/auth.ts:114-121` — static API keys without `API_KEY_METADATA` produce `request.organizationIdFromAuth = undefined`. `apps/api/src/utils/org-access.ts:13-19` then treats this as "auth disabled (dev mode)" and allows all orgs.

This is the launch's single biggest existential risk: one cross-tenant data leak ends the company at 10 customers.

## Goal

Make `request.organizationIdFromAuth` the **only** trusted source of organization binding for every mutation route. Reject any request whose authenticated org cannot be determined (in production), and reject any request whose body claims an org that differs from the authenticated org. `assertOrgAccess` distinguishes "auth disabled (dev)" from "auth succeeded but no org bound".

## Approach

### 1. Auth middleware — require scoped keys in production

In `apps/api/src/middleware/auth.ts`:
- After matching a static API key, if the matched entry has no `metadata.organizationId` and `NODE_ENV === "production"`, reject with 401 ("API key is not scoped to an organization"). Static keys without `API_KEY_METADATA` cannot be used in production.
- Add a startup validation: if `API_KEYS` is set but `API_KEY_METADATA` does not include an `organizationId` for every key, log a warning and (in production) refuse to start.

### 2. `assertOrgAccess` — distinguish dev mode from missing-binding

In `apps/api/src/utils/org-access.ts`:
- Replace the single "no auth configured (dev mode) — allow all" branch with a runtime mode flag:
  - In dev mode (no auth middleware registered, indicated by a new `app.authDisabled === true` flag set at registration time): allow.
  - In auth-enabled mode with `request.organizationIdFromAuth === undefined`: deny with 403 ("Authenticated request has no organization binding"). Never allow.
- The mode flag is set explicitly in `apps/api/src/app.ts` based on whether the auth middleware actually registered keys.

### 3. Mutation routes — drop body-orgId fallbacks

For each affected route, rewrite the org-derivation logic to:
- Use only `request.organizationIdFromAuth`.
- If a route accepts `organizationId` in the body, treat any mismatch with `request.organizationIdFromAuth` as a 400 error ("organizationId in body does not match authenticated context").
- The `?? body.organizationId` fallback pattern is forbidden.

Routes to fix (full list):
- `apps/api/src/routes/ingress.ts:21-36`
- `apps/api/src/routes/governance.ts:161`
- `apps/api/src/routes/actions.ts:62, 351`
- `apps/api/src/routes/execute.ts:62`
- Any other route that grep finds matching `body.organizationId` outside an explicit `assertOrgAccess` check.

### 4. Cross-tenant integration test

Add `apps/api/src/__tests__/cross-tenant-isolation.test.ts`:
- Boots the API with two API keys, each scoped to a different org.
- For every mutation route (ingress/submit, governance/emergency-halt, actions, execute, plus the existing `/api/sessions`, `/api/approvals`, etc.), attempts to use Org A's key to operate on an Org B entity ID. Asserts 403 or 404 every time.
- For each route, attempts to send Org B's `organizationId` in the body with Org A's auth. Asserts 400 (org mismatch).
- Run as part of the standard `pnpm test` flow.

## Acceptance criteria

- All four route changes shipped; no remaining `?? body.organizationId` fallback in any mutating route.
- `apps/api/src/middleware/auth.ts` rejects unscoped static keys in production.
- `apps/api/src/utils/org-access.ts` denies on `organizationIdFromAuth === undefined` when auth is enabled.
- `apps/api/src/__tests__/cross-tenant-isolation.test.ts` exists, passes, covers every mutating route.
- `apps/api/src/__tests__/ingress-boundary.test.ts` continues to pass.
- `pnpm test` and `pnpm typecheck` green.

## Out of scope

- The nullable `organizationId String?` schema fix (TI-9) — separate fix-soon migration.
- IdempotencyRecord orgId namespacing (TI-10) — separate fix-soon migration.
- Approval-store and lifecycle-store `updateMany` orgId scoping (TI-7, TI-8) — separate fix-soon spec.

## Verification

- `pnpm test --filter @switchboard/api` passes including the new cross-tenant test.
- `pnpm typecheck` clean.
- Manual smoke: with `API_KEYS` containing one unscoped key in `NODE_ENV=production`, server fails to start (or rejects requests with that key). With `API_KEY_METADATA` correctly set, server starts and rejects body-supplied org overrides.
- Audit report's Verification Ledger updated: TI-1, TI-2, TI-3, TI-4 marked "shipped" with PR link.
