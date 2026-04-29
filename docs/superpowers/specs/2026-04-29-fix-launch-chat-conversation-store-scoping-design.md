# Fix Launch — Chat Conversation Store Scoping

**Date:** 2026-04-29
**Status:** Design
**Severity:** HIGH
**Source:** Pre-launch security audit, findings TI-5, TI-6 (`.audit/12-pre-launch-security-audit.md`)

## Problem

The chat-side `PrismaConversationStore` and the API's escalation route both read/write `ConversationState` rows by `threadId` only, without scoping by `organizationId`. The `ConversationState` model has a nullable `organizationId String?` (TI-9), which means rows can exist without org binding and may diverge from their parent Handoff's `organizationId`. Combined, this is a HIGH-severity defense-in-depth gap that, in the wrong combination, could leak conversation data across tenants.

Specifically:
- `apps/chat/src/conversation/prisma-store.ts:9-15` — `get(threadId)` queries by `threadId` alone.
- `apps/chat/src/conversation/prisma-store.ts:58-62` — `delete(threadId)` calls `deleteMany({ where: { threadId } })`.
- `apps/chat/src/conversation/prisma-store.ts:64-71` — `listActive()` returns conversations across **all** tenants with no filter.
- `apps/api/src/routes/escalations.ts:99-101, 183-185, 198-205, 227-229` — `conversationState.findUnique({ where: { threadId } })` and `update({ where: { threadId } })` rely on a prior Handoff orgId guard but do not include orgId on the conversation lookup itself.

`threadId` is `@unique` on the model, so the primary risk is not "two orgs with the same threadId" but: if a stale ConversationState row has a different (or null) `organizationId` than the Handoff that references it, the prior Handoff guard does not protect the conversation read.

## Goal

Every `ConversationState` read and write is scoped by `(threadId, organizationId)`. The chat-side Store API requires `organizationId` at construction or per-call. `listActive()` is either removed or scoped per org and clearly annotated as a recovery-orchestrator-only path.

## Approach

### 1. Chat-side Store: orgId on every operation

In `apps/chat/src/conversation/prisma-store.ts`:
- Change the `ConversationStore` interface to require `organizationId` on every method. Either constructor-inject (matching `packages/db/src/stores/prisma-conversation-store.ts:18-22`) or per-call.
- `get(threadId, organizationId)` → `findFirst({ where: { threadId, organizationId } })`.
- `save(state)` already includes `state.organizationId`; require it to be non-null at the type level (TS).
- `delete(threadId, organizationId)` → `deleteMany({ where: { threadId, organizationId } })`.
- `listActive(organizationId?)`:
  - If called for normal ops: require `organizationId`; return only that tenant's active conversations.
  - If called from a system-startup recovery path: rename to `listActiveAcrossAllTenants()` and add a comment + caller restriction (only the recovery orchestrator should call it; routes/handlers must use the org-scoped variant).

Update all callers in `apps/chat/src/` to pass `organizationId`.

### 2. API escalations route: orgId on conversation lookups

In `apps/api/src/routes/escalations.ts`:
- Replace `findUnique({ where: { threadId } })` with `findFirst({ where: { threadId, organizationId: orgId } })` at lines 99-101, 183-185, 227-229.
- Replace `update({ where: { threadId } })` with `update({ where: { threadId } })` followed by an explicit pre-update assertion — or use `updateMany({ where: { threadId, organizationId: orgId } })` and check `result.count === 1`. Prefer the `updateMany` form to keep the orgId enforcement explicit.

### 3. Tests

- `apps/chat/src/conversation/__tests__/prisma-store.test.ts`:
  - Cross-tenant test: two orgs, same `threadId` is impossible due to `@unique`, so test that a stale row with `organizationId = orgB` is not visible to `get(threadId, orgA)`.
  - `listActive(orgA)` returns only orgA's active conversations.
- `apps/api/src/routes/__tests__/escalations.test.ts`:
  - Cross-tenant test: with Org A's auth, attempt to read/reply to a Handoff that points to a ConversationState whose `organizationId` is null or `orgB`; assert 404.

## Acceptance criteria

- All `ConversationState` reads/writes in `apps/chat` and `apps/api` are scoped by `(threadId, organizationId)`.
- `listActive()` is either renamed-and-restricted or accepts a required `organizationId`.
- New cross-tenant tests pass.
- Existing `apps/chat` and `apps/api` tests continue to pass.
- `pnpm test` and `pnpm typecheck` green.

## Out of scope

- Migrating `ConversationState.organizationId` from `String?` to `String` (non-null) — covered by TI-9 fix-soon.
- Schema-level naming standardization (`orgId` vs `organizationId`) — TI-11 LOW.

## Verification

- `pnpm test --filter @switchboard/chat --filter @switchboard/api` passes including new cross-tenant tests.
- Manual: with two orgs in a dev DB, attempt cross-tenant reads via the escalations route; confirm 404.
- Audit report's Verification Ledger updated: TI-5, TI-6 marked "shipped" with PR link.
