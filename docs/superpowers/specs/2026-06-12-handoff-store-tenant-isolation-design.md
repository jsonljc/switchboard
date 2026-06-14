# Handoff store tenant isolation (Alex audit F8 / Round-3 tenant-isolation #643)

Date: 2026-06-12
Status: design (approved-after-amendments; ready to implement)
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
- Impl (`packages/db/src/stores/handoff-store.ts`): `getById` -> `findUnique({where:{id}})`; `getBySessionId` -> `findFirst({where:{sessionId}, orderBy:{createdAt:"desc"}})`; `updateStatus` -> `update({where:{id}, data})` with the `#643` self-flag comment. `listPending` is already scoped (the template).
- Implementers of `HandoffStore` (exhaustive): `PrismaHandoffStore` (real) and `TestHandoffStore` (`apps/api/src/__tests__/test-stores.ts:358`, in-memory fake). Both must move in lockstep with the interface or typecheck breaks.
- Production callers of the three target methods (exhaustive, confirmed by `rg "\.getById\(|\.getBySessionId\(|\.updateStatus\("` across core/api/chat):
  - `getBySessionId` (a handoff-unique method name): exactly one production caller, `packages/core/src/skill-runtime/tools/escalate.ts:61`, where `ctx.orgId` is already in scope (used at lines 68-69). Typed via `Pick<HandoffStore, "save" | "getBySessionId">`.
  - `getById`: zero production callers (only the db test references it).
  - `updateStatus`: zero production callers (the `.updateStatus(` hits elsewhere are scheduler/task/connection stores, not Handoff).
- The audit guessed "API handoff routes and the respond/escalation lifecycle are the likely other callers." Partially corrected: no route calls the three `HandoffStore` methods (the api `decisions.ts` route and `dashboard-contact-detail.ts` use only the already-scoped `listPending`; `escalation-resolve.ts` does not touch handoffs). But `escalations.ts` reaches the `Handoff` table **directly** via `app.prisma.handoff.{findUnique,update,findMany}`, bypassing the store entirely. That direct surface is a separate access path from F8 (which is store-method-bounded). It is currently org-safe at the route level (each by-id read does `findUnique({where:{id}})` then `if (!handoff || handoff.organizationId !== orgId) return 404` before any PII is assembled; the two status mutations at `:183` release and `:312` resolve are `update({where:{id}})` gated by that same in-request guard). See the out-of-scope note below.

Net: tightening the interface forces a change at exactly one production call site (`escalate.ts`) plus the two store implementations and their tests. Small, contained, security-class. The `escalations.ts` direct-prisma surface is real but separate and already guarded; it is documented as out of scope, not silently ignored.

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
- `updateStatus` -> build the data object by exact inference (`const data = acknowledgedAt ? { status, acknowledgedAt } : { status }`), then `updateMany({ where: { id, organizationId }, data })`, then `if (result.count === 0) throw new Error("Handoff not found or does not belong to organization: " + id)`.
- Remove the `#643` self-flag comment once the method is actually scoped.

### Design decisions and rationale

1. **`organizationId` first.** Unanimous house convention across the tenant-isolation siblings (creative-job, contact, owner-task stores). Keeps reviewers' expectations and grep-ability intact.
2. **Reads return `null` on wrong-org (no throw).** Makes a cross-tenant access indistinguishable from "not found", so there is no oracle that confirms a foreign id/sessionId exists, and it preserves the existing caller contract: `escalate.ts` treats `null` as "no live handoff for this session, create one." A wrong-org caller simply cannot read the PII.
3. **`updateStatus` uses `updateMany` + `count === 0` throw (loud failure).** `updateMany`/`deleteMany` silently drop Prisma's P2025 "record not found" and return `{count:0}` (`[[feedback_updatemany_drops_nomatch_abort]]`); without the guard a wrong-org or missing update would no-op-succeed. The current `update()` already throws P2025 on a missing row, so the guard preserves "loud on missing" while adding "loud on wrong-org." Not inside a `$transaction([])`, so a plain `updateMany` + guard is sufficient (no interactive tx needed).
4. **Throw a plain `Error`, not `StaleVersionError`.** `StaleVersionError(-1,-1)` is used by CAS/version-column stores (creative-job, workflow, deployment-memory). `updateStatus` is a blind status set with no version column; the exact semantic analog is `owner-task-store.updateStatus`, which throws a plain `Error("... not found or does not belong to organization: <id>")`. Mirror it.
5. **Build the mutation `data` by exact inference, not `Record<string, unknown>`.** `const data = acknowledgedAt ? { status, acknowledgedAt } : { status }` gives Prisma the precise `HandoffUpdateManyMutationInput` shape and omits `acknowledgedAt` when absent. `Record<string, unknown>` is needlessly broad and weakens the typecheck of the mutation payload.
6. **No migration.** The column and the `(organizationId, status)` index already exist; the existing `@@index([sessionId])` covers `getBySessionId` (org is a cheap residual filter). Confirmed against the schema.
7. **`TestHandoffStore` becomes a faithful double.** Its `getById`/`getBySessionId` filter by org (return null otherwise), `getBySessionId` returns the **newest** matching row by `createdAt` (mirroring the real store's `orderBy createdAt desc`, not first-insert), and `updateStatus` throws when no row matches id+org. No api test calls these three directly, so this only sharpens the fake; it does not change any existing api test outcome. TypeScript does not force this (fewer-param methods stay assignable), so it is a deliberate correctness change.

### `save()` is out of the F8 threat model (audited, not changed)

F8 is about reading/mutating an existing handoff by a leaked/guessed `id` or `sessionId`. `save()` (an `upsert` keyed by `id`) is audited and deliberately left unchanged, because it cannot be used for a cross-tenant takeover:

- **Ids are server-generated and unguessable.** Both producers generate the id internally: `package-assembler.ts:30` (`handoff_${randomUUID()}`) and `build-handoff-package.ts:19` (`createId()`, cuid2). No `save()` path accepts a client-supplied id, so a colliding-id upsert against another tenant's row is not reachable by an attacker.
- **Ownership is immutable on update.** The upsert's `update` branch writes only `status`, the snapshots, `slaDeadlineAt`, and `acknowledgedAt`. It does **not** write `organizationId` (or `sessionId`), so `save()` cannot move an existing handoff to another tenant even if an id collided.
- **Every caller sets its own org.** Each `save()` caller builds the package with `organizationId: ctx.orgId`.

We pin the load-bearing half of this (the `update` branch never carries `organizationId`/`sessionId`) with a regression test, so a future edit that adds `organizationId` to the update clause is caught. Actually re-scoping the `upsert` is out of scope (and would require a compound-unique or a find-then-write, since `upsert`'s `where` must be a unique selector).

### Approaches considered (and rejected)

- **A. Scope only the reads, leave `updateStatus` unscoped.** Rejected: status mutation across tenants is also part of F8 and is cheap to close in the same slice; leaving it is exactly the "ship clean, don't defer" anti-pattern.
- **B. Keep `update()` and rely on P2025.** Rejected for the cross-org case: `update({where:{id}})` ignores org entirely, so a wrong-org caller with a real id would succeed. We must put `organizationId` in the where-clause, and once we do, `updateMany` is the org-scoped primitive, which then needs the `count===0` guard.
- **C. Throw `StaleVersionError` for consistency with creative-job-store.** Rejected: semantically wrong (no version), see decision 4.

## Test strategy (the security proof)

db tests use a mocked Prisma client (CI has no Postgres); mirror the existing `packages/db/src/stores/__tests__/handoff-store.test.ts`. The rewrite preserves the original coverage (listPending x2; the getById row-mapping assertions: `acknowledgedAt` null -> undefined, `leadSnapshot.name`) and adds the security proofs below. No prior assertion is dropped.

1. **Per-method where-clause + null-contract tests.** `getById(WRONG_ORG, id)` resolves `null` and the `findFirst` where-clause carries `{ id, organizationId: WRONG_ORG }`; `getById(RIGHT_ORG, id)` returns the mapped `Handoff`. Same for `getBySessionId` (where-clause carries `organizationId`, keeps `createdAt desc`). `updateStatus(WRONG_ORG, id, status)` with `updateMany` resolving `{count:0}` **throws**; `updateStatus(RIGHT_ORG, ...)` with `{count:1}` resolves and the `updateMany` where-clause carries `{ id, organizationId }` (data carries status, and acknowledgedAt when passed).
2. **Behavioral isolation test (the honest-filter proof).** Because the bare mock returns whatever you tell it, also drive `mockFindFirst` with a `mockImplementation` that actually applies the store's where-clause and `orderBy` to a seeded array. Seed two orgs that share a `sessionId` (and a same-id case), then assert: `getBySessionId("org_A","s1")` returns only A's row, `("org_B","s1")` only B's, `("org_C","s1")` null; and within an org the **newest** `createdAt` wins. This proves the store's clause isolates tenants, not just that we asserted a clause shape, without needing Postgres.
3. **`save()` ownership-immutability guard.** Assert the `upsert` is called with `create.organizationId` set and an `update` clause that does **not** contain `organizationId` or `sessionId`.
4. **Caller assertion.** Update `escalate.test.ts` to assert `getBySessionId` is called with `(ctx.orgId, ctx.sessionId)`.

Because signature tightening can pass typecheck yet red app suites that pass old arity, run the full gate: `pnpm --filter @switchboard/{db,core,api,chat} test` plus `pnpm typecheck` and `pnpm build`. Add a repo-wide grep gate (`rg "\.getById\(|\.getBySessionId\(|\.updateStatus\("` over `packages apps`) and manually confirm every handoff-store call passes `organizationId` first (the names `getById`/`updateStatus` are shared by other stores, so the grep is filtered by hand), guarding weakly-typed/`any`/fake paths that typecheck does not force.

## Scope

In scope: org-scope the three Handoff store methods, thread `organizationId` through the one production caller (`escalate.ts`), update both store implementations and all affected tests, add per-method tenant-denial + behavioral-isolation + save-immutability tests, remove the `#643` self-flag.

Out of scope (do not touch): F11 (activityStatus time-decay), `listPending` (already scoped), `save()` behavior (audited safe; only a regression test added), any other store, any migration, the other tenant-isolation PRs (#635, #965, #971).

Adjacent surface, documented out of scope (surfaced by the F8 code review): `apps/api/src/routes/escalations.ts` accesses the `Handoff` table directly via `app.prisma.handoff` rather than through `HandoffStore`, so the store-method F8 fix does not reach it. It is currently org-safe (guarded reads return 404 cross-tenant; the two status mutations are gated by the same in-request org guard), so this is a defense-in-depth gap, not a live hole. Hardening it is a route refactor, not a store change: Prisma `update` cannot take a non-unique `{ id, organizationId }` where, so the by-id mutations would become `updateMany({ where: { id, organizationId } })` + a `count === 0` guard + a refetch for the response body (the route currently uses the `update` return row). That is a separate, properly-scoped change and is deliberately not folded into this focused store PR.

## Follow-up note (non-blocking)

`getBySessionId(organizationId, sessionId)` orders by `createdAt desc` and is served by the existing `@@index([sessionId])` with `organizationId` as a residual filter (rows per session are typically one). If handoff volume per session/org grows, consider a `@@index([organizationId, sessionId, createdAt])`. Not required for this security PR and intentionally not added here (it would be a migration).

## Done when

`getById`/`getBySessionId`/`updateStatus` are `organizationId`-scoped; a wrong-org id or sessionId cannot read lead PII or mutate status (proven by per-method tenant-denial + behavioral-isolation tests, the `updateStatus` one via the `count===0` guard); the single caller threads `organizationId`; `save()` ownership-immutability is pinned; no migration; `#643` self-flag removed; typecheck + db/core/api/chat tests + build + lint + format:check green; a focused PR to main with this rationale in the spec and PR body.
