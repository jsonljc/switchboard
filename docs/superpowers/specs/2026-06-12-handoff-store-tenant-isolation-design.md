# Handoff store tenant isolation (Alex audit F8 / Round-3 tenant-isolation #643)

Date: 2026-06-12
Status: design (awaiting approval before implementation)
Branch: `fix/handoff-tenant-isolation`
Origin: Alex Capability & Architecture Audit 2026-06-10, finding F8 (security); audit doc README section 6 item 7.

## Problem

`HandoffStore` reads and the status mutation are not tenant-scoped. The interface

```
getById(id): Handoff | null
getBySessionId(sessionId): Handoff | null
updateStatus(id, status, acknowledgedAt?): void
```

take no `organizationId`. A `Handoff` embeds `leadSnapshot` (lead PII: name, channel, contact context), `qualificationSnapshot`, and `conversationSummary`. So a leaked or guessed handoff `id` or `sessionId` lets any path that reaches the store read another tenant's lead PII, and `updateStatus` can mutate another tenant's handoff lifecycle. `listPending(organizationId)` is already org-scoped and is the in-store pattern to mirror. The implementation carries a self-flag at `handoff-store.ts:66` deferring this to "Round-3 tenant-isolation sweep #643"; that round is now current.

This is the standing tenant-isolation hardening theme also seen in `creative-job-store` (#635) and workflow routes (#965). Those are different findings; this slice touches only the Handoff store.

## Verified finding (against origin/main 60a6bb49)

- Schema (`packages/db/prisma/schema.prisma:700-720`): `Handoff` already has `organizationId String` plus `@@index([organizationId, status])` and `@@index([sessionId])`. **No migration is needed.**
- Interface (`packages/core/src/handoff/types.ts:22-28`): the three methods take no `organizationId`; `listPending(organizationId)` already does.
- Impl (`packages/db/src/stores/handoff-store.ts`): `getById` -> `findUnique({where:{id}})`; `getBySessionId` -> `findFirst({where:{sessionId}, orderBy})`; `updateStatus` -> `update({where:{id}, data})` with the `#643` self-flag comment. `listPending` is already scoped (the template).
- Implementers of `HandoffStore` (exhaustive): `PrismaHandoffStore` (real) and `TestHandoffStore` (`apps/api/src/__tests__/test-stores.ts:358`, in-memory fake). Both must move in lockstep with the interface or typecheck breaks.
- Production callers of the three target methods (exhaustive grep across core/api/chat):
  - `getBySessionId`: exactly one, `packages/core/src/skill-runtime/tools/escalate.ts:61`, where `ctx.orgId` is already in scope (used at lines 68-69). Typed via `Pick<HandoffStore, "save" | "getBySessionId">`.
  - `getById`: zero production callers (only the db test references it).
  - `updateStatus`: zero production callers (the `.updateStatus(` hits elsewhere are scheduler/task/connection stores, not Handoff).
- The audit guessed "API handoff routes and the respond/escalation lifecycle are the likely other callers." Verified false: the escalation routes (`escalations.ts`, `escalation-resolve.ts`) use `conversationStateStore`/`workTraceStore`, not `HandoffStore`; the api `decisions.ts` route and `dashboard-contact-detail.ts` use only the already-scoped `listPending`.

Net: tightening the interface forces a change at exactly one production call site (`escalate.ts`) plus the two store implementations and their tests. Small, contained, security-class.

## Design

Add `organizationId` as the **first** parameter of all three methods (house convention: `creative-job-store.updateStage(organizationId, id, ...)`, `contact-store.findById(orgId, id)`, `owner-task-store.updateStatus(orgId, taskId, status, ...)` all lead with org). New interface:

```ts
getById(organizationId: string, id: string): Promise<Handoff | null>;
getBySessionId(organizationId: string, sessionId: string): Promise<Handoff | null>;
updateStatus(
  organizationId: string,
  id: string,
  status: HandoffStatus,
  acknowledgedAt?: Date,
): Promise<void>;
```

Impl changes in `PrismaHandoffStore`:

- `getById` -> `findFirst({ where: { id, organizationId } })` (was `findUnique`; a compound non-unique where requires `findFirst`).
- `getBySessionId` -> `findFirst({ where: { sessionId, organizationId }, orderBy: { createdAt: "desc" } })` (keep the ordering).
- `updateStatus` -> `updateMany({ where: { id, organizationId }, data })` then `if (result.count === 0) throw new Error("Handoff not found or does not belong to organization: " + id)`.
- Remove the `#643` self-flag comment once the method is actually scoped.

### Design decisions and rationale

1. **`organizationId` first.** Unanimous house convention across the tenant-isolation siblings (creative-job, contact, owner-task stores). Keeps reviewers' expectations and grep-ability intact.
2. **Reads return `null` on wrong-org (no throw).** Makes a cross-tenant access indistinguishable from "not found", so there is no oracle that confirms a foreign id/sessionId exists, and it preserves the existing caller contract: `escalate.ts` treats `null` as "no live handoff for this session, create one." A wrong-org caller simply cannot read the PII.
3. **`updateStatus` uses `updateMany` + `count === 0` throw (loud failure).** `updateMany`/`deleteMany` silently drop Prisma's P2025 "record not found" and return `{count:0}` (`[[feedback_updatemany_drops_nomatch_abort]]`); without the guard a wrong-org or missing update would no-op-succeed. The current `update()` already throws P2025 on a missing row, so the guard preserves "loud on missing" while adding "loud on wrong-org." Not inside a `$transaction([])`, so a plain `updateMany` + guard is sufficient (no interactive tx needed).
4. **Throw a plain `Error`, not `StaleVersionError`.** `StaleVersionError(-1,-1)` is used by CAS/version-column stores (creative-job, workflow, deployment-memory). `updateStatus` is a blind status set with no version column; the exact semantic analog is `owner-task-store.updateStatus`, which throws a plain `Error("... not found or does not belong to organization: <id>")`. Mirror it.
5. **No migration.** The column and the `(organizationId, status)` index already exist; the existing `@@index([sessionId])` covers `getBySessionId` (org is a cheap residual filter). Confirmed against the schema.
6. **`TestHandoffStore` becomes a faithful double.** Its `getById`/`getBySessionId` filter by org (return null otherwise) and `updateStatus` throws when no row matches id+org, mirroring the real store's new contract. No api test calls these three directly, so this only sharpens the fake; it does not change any existing api test outcome.

### Approaches considered (and rejected)

- **A. Scope only the reads, leave `updateStatus` unscoped.** Rejected: status mutation across tenants is also part of F8 and is cheap to close in the same slice; leaving it is exactly the "ship clean, don't defer" anti-pattern.
- **B. Keep `update()` and rely on P2025.** Rejected for the cross-org case: `update({where:{id}})` ignores org entirely, so a wrong-org caller with a real id would _succeed_. We must put `organizationId` in the where-clause, and once we do, `updateMany` is the org-scoped primitive, which then needs the `count===0` guard.
- **C. Throw `StaleVersionError` for consistency with creative-job-store.** Rejected: semantically wrong (no version), see decision 4.

## Test strategy (the security proof)

db tests use a mocked Prisma client (CI has no Postgres); mirror the existing `packages/db/src/stores/__tests__/handoff-store.test.ts`.

Per-method tenant-denial tests (the durable proof):

- `getById(WRONG_ORG, id)` -> resolves `null`; assert the `findFirst` where-clause carries `{ id, organizationId: WRONG_ORG }`. `getById(RIGHT_ORG, id)` still returns the mapped `Handoff`.
- `getBySessionId(WRONG_ORG, sessionId)` -> `null`; assert where-clause carries `organizationId` (and keeps the `createdAt desc` ordering). `getBySessionId(RIGHT_ORG, sessionId)` returns the row.
- `updateStatus(WRONG_ORG, id, status)` with `updateMany` resolving `{count:0}` -> **throws** (the `count===0` guard); assert no silent success. `updateStatus(RIGHT_ORG, id, status)` with `{count:1}` resolves; assert the `updateMany` where-clause carries `{ id, organizationId: RIGHT_ORG }` and the data carries status (+ acknowledgedAt when passed).

Update existing db tests to the new arity. Update `escalate.test.ts` to assert `getBySessionId` is called with `(ctx.orgId, ctx.sessionId)`. Because signature tightening can pass typecheck yet red app suites that pass old arity, run the full gate: `pnpm --filter @switchboard/{db,core,api,chat} test` plus `pnpm typecheck` and `pnpm build`.

## Scope

In scope: org-scope the three Handoff store methods, thread `organizationId` through the one production caller (`escalate.ts`), update both store implementations and all affected tests, add per-method tenant-denial tests, remove the `#643` self-flag.

Out of scope (do not touch): F11 (activityStatus time-decay), `listPending` (already scoped), any other store, any migration, the other tenant-isolation PRs (#635, #965, #971).

## Done when

`getById`/`getBySessionId`/`updateStatus` are `organizationId`-scoped; a wrong-org id or sessionId cannot read lead PII or mutate status (proven by per-method tenant-denial tests, the `updateStatus` one via the `count===0` guard); the single caller threads `organizationId`; no migration; `#643` self-flag removed; typecheck + db/core/api/chat tests + build + lint + format:check green; a focused PR to main with this rationale in the spec and PR body.
