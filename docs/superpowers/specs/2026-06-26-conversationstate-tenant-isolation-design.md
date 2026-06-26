# ConversationState cross-tenant isolation (adversarial audit finding #2, High)

**Date:** 2026-06-26
**Status:** approved (autonomous build-loop; forks decided per session authority)
**Workstream:** 2026-06-26 adversarial audit — final deferred item

## Problem

`ConversationState.threadId` is globally `@unique`, and the gateway keys conversation
status on the bare customer MSISDN (`sessionId`). The gateway read
(`PrismaGatewayConversationStore.getConversationStatus`) does
`findUnique({ where: { threadId: sessionId } })` and the gateway write
(`gateway-bridge.ts setConversationStatus`) upserts/updates on the bare `threadId`
without ever setting `organizationId`. The API afterSkill adapter
(`skill-mode.ts`) does the same org-blind `updateMany`.

For a phone shared across two orgs this produces two defects:

1. **Info leak / silencing (read):** org A's `human_override` row is returned to
   org B's gateway, so org A's operator takeover silences org B's bot (and vice
   versa).
2. **Write-collision DoS (write):** every writer collides on the single global
   row per phone. Org B's status write clobbers org A's row; only one tenant's
   state can exist at a time.

Scoping only the read leaves the write-collision DoS. The complete fix changes the
uniqueness boundary to per-org and scopes every reader/writer by `organizationId`.

## Decisions (forks resolved)

### Fork 1 — Constraint shape: keep-nullable-compound

`threadId String @unique` → `threadId String` + `@@unique([organizationId, threadId])`,
leaving `organizationId` nullable.

- Postgres treats NULLs as **distinct** in a unique index (default `NULLS DISTINCT`),
  so legacy null-org rows never collide and impose no constraint on new rows.
- Every new row carries a non-null org (all writers populate it after this change),
  so two orgs sharing a phone get two distinct rows: `(orgA, phone)` and `(orgB, phone)`.
- Migration is a pure index swap — no data rewrite. Existing data cannot violate the
  new constraint because `threadId` is globally unique **today** (≤1 row per future
  `(org, threadId)`).
- **Rejected make-required:** forces a backfill whose correct value is un-inferable
  (a phone shared across orgs is exactly the ambiguous case).

Also drop the now-redundant standalone `@@index([organizationId])`: the compound
unique's leading column is `organizationId`, so org-prefix lookups
(`listActive`, `buildConversationList`) use it. Keeping both is write-amplifying
dead weight. Documented in the migration.

### Fork 2 — Backfill of existing null-org rows: derive org where unambiguous (else leave inert)

REVISED after code review. The original "leave-inert" reasoning was self-
contradictory: it rejected deleting null-org rows because that "drops a live
`human_override` (silent un-pause)" — but leaving them inert causes the **same**
silent un-pause via the now org-scoped read. The org column was added nullable with
no backfill and the old gateway write never set org, so existing rows — including
active safety-gate `human_override` escalations — are predominantly null-org; an
org-scoped read would stop honoring those pauses (the bot resumes mid-takeover).

Resolution: the migration backfills `organizationId` from the gateway's own
org-stamped `ConversationThread` (correlated on the same `sessionId`, which IS the
`ConversationState.threadId`), **single-org only**. This preserves the pause for the
common case (a phone used by one org) and can NEVER misassign: a sessionId mapping
to two+ orgs, or only to the identity-unresolved `"gateway"` literal, is left null.
A buggy/empty match degrades to leave-inert (null), never to a wrong tenant.

Correlating on the gateway's stored `sessionId` string (not a re-normalized phone)
sidesteps the phone-shape ambiguity entirely — no `buildPhoneMatchCandidates`-style
matching is needed. Genuinely multi-org-shared or un-derivable rows remain null and
un-pause (no org can be correctly inferred — an operator re-engages; unavoidable
without an org); nullable-compound + NULLS-distinct lets such a row coexist with a
fresh `(org, phone)` row, and the `expiresAt` TTL reaps it.

### Fork 3 — Writer consistency: required `organizationId` param + one shared write helper

Add a **required** `organizationId` parameter to the conversation-status write
interface so the compiler forces every call site to pass its in-scope org — no
unscoped write can survive typecheck. The two thin app-side adapters
(`gateway-bridge`, `skill-mode`) delegate to a single
`setConversationStatusScoped()` helper in `packages/db` (the layer both apps import,
where Prisma-touching code lives). The helper owns the compound-key upsert/updateMany
in exactly one place — the audit's "keep the writers consistent" requirement made
mechanical and testable in the existing real-PG tier.

The read path keeps its single inline implementation (one reader, no dedup benefit):
`getConversationStatus(sessionId, organizationId)` switches `findUnique` → `findFirst`.

## Components & changes

### Schema + migration (`packages/db`)

- `prisma/schema.prisma` `ConversationState`: drop `@unique` on `threadId`, add
  `@@unique([organizationId, threadId])`, drop `@@index([organizationId])`.
- Migration generated via `prisma migrate diff` and applied surgically (the shared
  dev DB carried pre-existing unrelated drift that would have made `migrate dev`
  reset it). The SQL documents the single-org backfill (Fork 2) and the null-org
  handling. Migration ships in the same commit as the schema change (CLAUDE.md).
  `pnpm db:check-drift` must be clean.

### Shared write helper (`packages/db`, new file)

`setConversationStatusScoped(prisma, { sessionId, organizationId, status, upsertContext? })`:

- With `upsertContext` (`{ channel, principalId }`): `upsert` keyed on
  `{ organizationId_threadId: { organizationId, threadId: sessionId } }`; `create`
  populates `organizationId`, `channel`, `principalId`, `status`, `expiresAt`
  (30-day TTL, matching the current gateway adapter).
- Without `upsertContext`: `updateMany({ where: { threadId: sessionId, organizationId }, data: { status } })`.

### Read path

- `packages/core/.../channel-gateway/types.ts`: `GatewayConversationStore.getConversationStatus?(sessionId, organizationId)`.
- `apps/chat/.../gateway-conversation-store.ts`: `findFirst({ where: { threadId: sessionId, organizationId }, select: { status: true } })`.
- `packages/core/.../channel-gateway.ts` (2 callers): pass `resolved.organizationId`.

### Write interfaces + callers (core)

- `GatewayConversationStatusSetter.setConversationStatus` (channel-gateway/types.ts)
  and `ConversationStatusSetter.setConversationStatus`
  (skill-runtime/hooks/deterministic-safety-gate.ts): add required `organizationId`
  → `(sessionId, organizationId, status, upsertContext?)`.
- Callers pass in-scope org:
  - `channel-gateway/pre-input-gate.ts` ×2 → `organizationId`
  - `consent/consent-service.ts` → `effectiveOrgId`
  - `skill-runtime/hooks/claim-classifier.ts` ×2 → `ctx.orgId`
  - `skill-runtime/hooks/price-claim-gate.ts` → `ctx.orgId`
  - `skill-runtime/hooks/pdpa-consent-gate.ts` → `ctx.orgId`
  - `skill-runtime/hooks/deterministic-safety-gate.ts` ×2 → `orgId`

### Write adapters (apps)

- `apps/chat/.../gateway-bridge.ts`: adapter delegates to `setConversationStatusScoped`
  (org from the new param, `upsertContext` as today).
- `apps/api/.../skill-mode.ts`: adapter delegates to `setConversationStatusScoped`
  (org from the new param, no `upsertContext`).

### `apps/chat/.../conversation/prisma-store.ts` (chat lifecycle `save`)

Compile-forced by the constraint swap:

- sticky-override read `findUnique({ where: { threadId } })` → `findFirst({ where: { threadId, organizationId }, select: { status: true } })`.
- `upsert({ where: { threadId } })` → `upsert({ where: { organizationId_threadId: { organizationId, threadId } } })`.
  This store already org-scopes `get`/`delete`/`listActive`; this closes the `save` seam.

### Verified already-correct (no change)

These use a generic `where` with `organizationId`, unaffected by the constraint swap:
`apps/api/.../routes/conversations.ts` (findFirst/findMany/count),
`packages/db/.../prisma-conversation-state-store.ts` (#643 findFirst/updateMany ×N),
`packages/db/.../prisma-contact-store.ts` erasure (`principalId in [...]` + org).

## Test plan (TDD)

1. **Headline real-PG integration test** (new, `packages/db/src/stores/__tests__`,
   `describe.skipIf(!DATABASE_URL)`): two orgs A/B share phone P. (Placed in `db`,
   not `apps/api`: importing the chat read class across apps violates `rootDir`, so
   the test exercises the helper + replicates the exact gateway `findFirst` read,
   whose query shape is pinned separately by the chat unit test.)
   - A writes `human_override` (helper + upsertContext) → row `(A, P)`.
   - B reads status `findFirst({ threadId: P, organizationId: B })` (the query
     `PrismaGatewayConversationStore.getConversationStatus` issues) → `null` (A's
     pause does **not** suppress B's bot).
   - B writes `active` (helper) → creates `(B, P)`, does **not** clobber `(A, P)`.
   - A reads `(P, A)` → still `human_override`.
   - Two distinct rows exist. RED on old code (global unique → 2nd write throws /
     clobbers; cross-read leaks); GREEN after the fix.
2. **Helper unit test** (mock Prisma): upsert uses the compound key + populates org;
   updateMany scopes org.
3. **Read unit test update** (`gateway-conversation-store.test.ts`): `getConversationStatus`
   uses `findFirst({ where: { threadId, organizationId } })`.
4. **Erasure integration** unchanged green (no regression on PDPA purge).

## Risks / rollback

- Compound-unique on a nullable column: Prisma 6.19 generates the
  `organizationId_threadId` selector; all writers pass non-null org, so the upsert
  conflict target is real. (Null only appears in inert legacy rows, never written again.)
- Rollback = revert the PR; the migration is additive-shaped (index swap) but a true
  rollback needs a down-migration restoring `threadId @unique`, which would fail if
  per-org duplicates exist by then. Forward-fix preferred.

## Out of scope

No standalone backfill job (the single-org backfill rides inside the migration, Fork
2); no change to already-org-scoped operator/erasure/route paths beyond verification;
no consolidation of the read path into the helper.
