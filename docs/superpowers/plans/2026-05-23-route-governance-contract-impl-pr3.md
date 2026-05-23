# Route Governance Contract v1 — Impl PR-3 Plan: Store-Layer Mutation Contract Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Section 10 store-layer mutation contract (required `organizationId` argument + tenant-scoped `updateMany` WHERE + typed `StaleVersionError` on `count === 0`) to the tightenable Round-2 candidates in [issue #601](https://github.com/jsonljc/switchboard/issues/601), tighten `GovernanceVerdict` persistence types to remove the 5 `verdictStore.save as any` casts (Cat 3.14), and ship a warning-mode `check-routes` advisory that flags un-scoped store mutations.

**Architecture:** PR #590 (`d7a402b6`) + PR #598 (`d21fb738`) established the contract for `packages/db/src/storage/**`. The exemplar is `PrismaApprovalStore.updateState` (`packages/db/src/storage/prisma-approval-store.ts:39-58`). PR-3 extends the exact same pattern to `packages/db/src/stores/**` (a different directory PR #598 never touched) plus one missed method in `storage/prisma-lifecycle-store.ts`. Three WHERE shapes recur: **direct-column** (`where: { id, organizationId }`), **relation-filter** (`where: { id, <fk>: { organizationId } }` for models whose org is reached through an FK relation), and a Prisma type constraint forces every single-row tightening through `updateMany` (Prisma's `update` only accepts unique selectors in `where`, and `{ id, organizationId }` is not a unique tuple). The verdict-types slice and the check-rule slice are independent of the store sweep and of each other.

**Tech Stack:** TypeScript (strict, ESM, `.js` import extensions), Prisma ORM (mocked in unit tests — CI has no Postgres), Vitest (TDD), ts-morph (AST walking for the advisory — already in `.agent/tools/`), pnpm/Turborepo monorepo, GitHub Actions (CI advisory wiring).

**Consumes:** `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` Sections 10 (store contract) + 11 (Cat 3 crosswalk, rows 3.14) + 12 (PR-3 envelope). Builds on:

- PR-1 (#614, merged 2026-05-22 → `5617dbf0`) — supplies the `check-routes --mode=warn-touched` CLI branch this plan extends.
- PR-2 (#624, merged 2026-05-23 → `f99d0c6f`) — cross-app type relocation. No direct dependency; PR-3 is backend-store-only.
- PR-2.5 (#627, merged 2026-05-23 → `295e95ab`) — landed `.agent/tools/cross-app-types-check.ts` and the **two-advisory merge block** in `check-routes.ts:174-190`. This plan's check rule (`store-mutation-check.ts`) mirrors that advisory verbatim and slots in as a **third** advisory in the same merge block.

**Independence:** Entirely backend (`packages/db/**`, `packages/core/**`, `packages/schemas/**`, `.agent/tools/**`). Touches **no** `apps/dashboard/**` or `apps/chat/**` route/UI code. Can land before or after any other Phase 3A PR. PR-4 backfills `@route-class` headers and flips all three advisories (route-class, cross-app-types, store-mutation) from warning to error together.

---

## Scope decisions (locked during plan-writing)

These three boundary calls were made deliberately and shape the task count. They are recorded here so reviewers can audit them.

1. **DispatchRecord (`storage/prisma-lifecycle-store.ts:261`) and CreatorIdentity (`stores/prisma-creator-identity-store.ts`) are DEFERRED, not tightened.** Both reach `organizationId` only through an FK that has **no Prisma `@relation` declared** (`DispatchRecord.executableWorkUnitId → ExecutableWorkUnit.lifecycleId → ApprovalLifecycle.organizationId`, none of which are `@relation` fields; `CreatorIdentity.deploymentId` has no `deployment` relation). A clean relation-filter WHERE is impossible without a schema migration that adds the relation + FK constraint, which carries its own data-integrity risk. Issue #601 explicitly marks DispatchRecord "defer-able." PR-3 stays **migration-free**. See "Known smells (deferred)."

2. **AgentListing (`stores/prisma-listing-store.ts`) and OutboxEvent (`stores/prisma-outbox-store.ts`) are EXEMPT — genuinely platform-global.** Neither model has an org column; `AgentListing` is the cross-tenant marketplace catalog and `OutboxEvent` is an infra delivery queue drained by a system worker. Per §10.1 ("nullable only for resources without a tenant binding"), these have _no_ tenant binding at all. PR-3 adds the **inline suppression directive** to their mutators so the new advisory does not false-positive, and documents the rationale. No signature change.

3. **PR-3 closes Cat 3.14 only. Cat 3.15 (typed Graph API response wrapper) and 3.16 (agentContext null guard via §9 typed outputs) are DEFERRED** to a PR-3-tail or PR-4 follow-up. The prompt-stated PR-3 envelope is "store sweep + 3.14 + check rule"; 3.15/3.16 are heterogeneous concerns (a fetch-wrapper type and a reader null-guard) that do not share the store-contract theme and would dilute review. Flagged in "Known smells (deferred)."

---

## Schema boundary rule

This plan touches `@switchboard/schemas` in exactly **one** place: widening `GovernanceVerdictDetails` (Task 18). That type lives in core (`packages/core/src/governance/governance-verdict-store/types.ts`), **not** in the schemas package — it is a plain TypeScript interface, not a Zod schema. No Zod schema is added or modified. No `z.coerce.date()` / Date-vs-string boundary decision is made anywhere in PR-3.

If a Task code-block shows a new `z.object(...)` or `z.infer`, that is a plan bug — flag and skip. The store sweep is pure Prisma-call + method-signature surgery; the verdict slice is a TypeScript interface widening.

---

## Pre-flight verification — done during plan-writing

Captured so the implementing agent does not redo it and reviewers can audit the assumptions. Verified on `main` at the PR-3 baseline (re-confirm exact SHA in Task 0).

| Question                                                                  | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is issue #601's candidate list still current after PR-2 / PR-2.5?         | **Yes.** A fresh grep of `packages/db/src/stores/**` for `.update(` / `.updateMany(` / `.delete(` confirms every listed candidate still carries a bare `where: { id }` mutation. PR-2 / PR-2.5 touched only `packages/core/**`, `packages/schemas/**`, `apps/api/**`, `docs/**`, `.agent/tools/**` — zero store files.                                                                                                                                                                                                                                                                                                                                           |
| What is the canonical exemplar shape?                                     | `PrismaApprovalStore.updateState` (`packages/db/src/storage/prisma-approval-store.ts:32-58`): required `organizationId: string \| null` arg, `updateMany({ where: { id, version, organizationId }, data })`, `if (result.count === 0) throw new StaleVersionError(...)`.                                                                                                                                                                                                                                                                                                                                                                                         |
| Where do `StaleVersionError` / `TenantMismatchError` live?                | `packages/core/src/approval/state-machine.ts:13` + `:26`, re-exported from `packages/core/src/approval/index.ts:6-7` and reachable as `import { StaleVersionError } from "@switchboard/core"`. `TenantMismatchError extends StaleVersionError`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Why must single-row updates use `updateMany`?                             | Prisma's `update({ where })` accepts **only unique selectors**. `{ id, organizationId }` is not a declared unique tuple on any candidate model, so `update` would be a compile error. `updateMany` accepts arbitrary filters and returns `{ count }`; `count === 0` is the security-correct conflation of "missing / stale / wrong-tenant."                                                                                                                                                                                                                                                                                                                      |
| Org-binding shape per model?                                              | **Direct `organizationId` column:** Contact, Opportunity, Booking, OperatorCommandRecord, ExecutionTrace, WorkflowExecution, PendingActionRecord, AgentTask, CreativeJob, DeploymentMemory, KnowledgeChunk, AgentDeployment. **Different column name:** OrgAgentEnablement uses `orgId` (not `organizationId`). **Relation-filter:** DeploymentConnection → `deployment.organizationId`; ApprovalCheckpointRecord → `workflow.organizationId`. **No org binding (exempt):** AgentListing, OutboxEvent. **No `@relation` to walk (deferred):** DispatchRecord, CreatorIdentity.                                                                                   |
| Which candidate stores already accept an org arg on the relevant mutator? | `contact-store` (all mutators take `orgId`, but pre-fetch+`update` — must collapse to `updateMany`), `opportunity-store.updateStage` (takes `orgId`), `opportunity-store.updateRevenueTotal` (has **`_orgId`** unused — un-prefix and use it), `deployment-memory-store` list methods (org-aware) but `delete(id)` is not. **No org arg at all on mutator:** agent-task, creative-job, deployment-store, booking (confirm/markFailed), command (updateCommandStatus), execution-trace (linkOutcome), org-agent-enablement.setStatus (takes `orgId`), whatsapp-test-send.updateWebhookStatus, deployment-connection. These require threading org from the caller. |
| Why are the 5 `verdictStore.save as any` casts there?                     | All 5 sites pass `details: Record<string, unknown>` but `GovernanceVerdictDetails` (`governance-verdict-store/types.ts:3-9`) is a **closed** struct (`matchCategory?`, `matchId?`, `matchedText?`, `sentence?`). Adding an index signature `[key: string]: unknown` to that interface accepts the call-site shapes and removes every cast. The cascade is confined to 3 files: `consent/consent-service.ts:130`, `skill-runtime/hooks/pdpa-consent-gate.ts:233`, `skill-runtime/hooks/claim-classifier.ts:294,341,388`. No Prisma regen, no schema migration.                                                                                                    |
| Does the check infra support a third advisory?                            | **Yes.** `.agent/tools/check-routes.ts:174-190` (`--mode=warn-touched`) already runs `runRouteClassAdvisory` + `runCrossAppTypesAdvisory` via `Promise.all` and merges warnings. PR-3 adds `runStoreMutationAdvisory` as a third element. The CI step (`continue-on-error: true`) needs no workflow edit.                                                                                                                                                                                                                                                                                                                                                        |
| Where does the 3a cron caller get org?                                    | `meta-token-refresh` cron (`apps/api/src/services/cron/meta-token-refresh.ts`) iterates connections platform-wide via the `MetaTokenRefreshDeps` adapter (`apps/api/src/bootstrap/inngest.ts:327-332`). The `DeploymentConnectionRecord` it iterates carries `deploymentId` but **not** `organizationId`. The OAuth caller (`apps/api/src/routes/google-calendar-oauth.ts:188`) is request-scoped and has org available. See Task 1 for the threading strategy.                                                                                                                                                                                                  |

### 3a caller-org tension (important)

The `deployment-connection` mutators are called from a system cron that legitimately operates across all tenants and has no single "caller org" to mismatch against. The contract still applies: the cron derives `organizationId` from the connection's deployment (it already holds `deploymentId`) and passes it. Even though a self-derived org "always matches," the relation-filter WHERE remains valuable defense-in-depth — it guarantees the row being written actually correlates to the deployment/org pair the caller believes it does, catching id-confusion bugs. This is the same posture issue #601 endorses ("plumb from the already-fetched-row's org at every caller").

---

## Known smells (deferred)

Captured for the PR description and PR-4 follow-up. None block PR-3.

- **DispatchRecord** (`storage/prisma-lifecycle-store.ts:261`, `updateDispatchRecord`) — org reachable only via `executableWorkUnitId → ExecutableWorkUnit.lifecycleId → ApprovalLifecycle.organizationId`, none declared as Prisma `@relation`. Tightening needs a schema migration adding the relations + FK constraints. **Deferred** to a focused migration PR. The new advisory will warn on it (expected); PR-4 either resolves or allowlists it.
- **CreatorIdentity** (`stores/prisma-creator-identity-store.ts`, mutators at `:50,60,67,74,81`) — `deploymentId` column with no `deployment` relation. Same migration requirement. **Deferred.** Advisory will warn (expected).
- **AgentListing** (`stores/prisma-listing-store.ts:64,74`) + **OutboxEvent** (`stores/prisma-outbox-store.ts:28,35`) — platform-global, no tenant binding. **Exempt** via inline suppression directive (Task 17 wires the directive into the advisory; the directive comments are added in Task 16). Documented, not tightened.
- **Cat 3.15** — untyped Graph API response casts. Belongs in a typed fetch-wrapper per spec §8.6. **Deferred.**
- **Cat 3.16** — `agentContext` null guard in the re-engagement reader, captured via §9 typed outputs. **Deferred.**

---

## Contract patterns (defined once; referenced by store tasks)

Every store task applies exactly one of these. The store-specific WHERE + signature is spelled out in each task; the boilerplate below is identical everywhere.

**Pattern A — direct-column, void-returning mutator.** Used when the mutator returns `void` and the model has a direct `organizationId` (or `orgId`) column.

```ts
import { StaleVersionError } from "@switchboard/core";

async someMutator(organizationId: string, id: string, /* ...payload */): Promise<void> {
  const result = await this.prisma.<model>.updateMany({
    where: { id, organizationId }, // org column name varies; OrgAgentEnablement uses `orgId`
    data: {
      /* ...payload fields */
    },
  });
  if (result.count === 0) {
    throw new StaleVersionError(id, -1, -1);
  }
}
```

**Pattern B — direct-column, row-returning mutator.** Used when the mutator currently does pre-fetch (`findFirst`) + `update` and returns the mapped row. Collapse the pre-fetch into the `updateMany` guard, then read the row back. The pre-fetch is removed (its tenant check is now in the `updateMany` WHERE — the dead pre-fetch is the foot-gun §10.1 says to delete).

```ts
import { StaleVersionError } from "@switchboard/core";

async someMutator(organizationId: string, id: string, /* ...payload */): Promise<Entity> {
  const result = await this.prisma.<model>.updateMany({
    where: { id, organizationId },
    data: { /* ...payload */ },
  });
  if (result.count === 0) {
    throw new StaleVersionError(id, -1, -1);
  }
  const row = await this.prisma.<model>.findFirstOrThrow({ where: { id, organizationId } });
  return mapRowToEntity(row);
}
```

**Pattern C — relation-filter mutator.** Used when org is reached through a declared `@relation`. The WHERE filters on the relation. Caller passes `organizationId`.

```ts
import { StaleVersionError } from "@switchboard/core";

async someMutator(organizationId: string, id: string, /* ...payload */): Promise<void> {
  const result = await this.prisma.<model>.updateMany({
    where: { id, <relationField>: { organizationId } }, // e.g. deployment / workflow
    data: { /* ...payload */ },
  });
  if (result.count === 0) {
    throw new StaleVersionError(id, -1, -1);
  }
}
```

**Error semantics (all patterns).** Prisma stores throw the parent `StaleVersionError` on `count === 0` (cannot distinguish stale-vs-missing-vs-tenant without an extra read). `TenantMismatchError` is reserved for in-memory stores that can observe the distinction; **no in-memory store is touched in PR-3** (the issue #601 candidates are all Prisma stores), so PR-3 throws only `StaleVersionError`.

**`delete` methods** follow Pattern A/C but use `deleteMany` instead of `updateMany`, same `count === 0` guard. Where a `delete` runs inside a `$transaction` with a cascade (contact-store), the guarded `deleteMany` of the root row replaces the final `tx.contact.delete({ where: { id } })`.

---

## File structure

### Create

| Path                                                                          | Responsibility                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.agent/tools/store-mutation-check.ts`                                        | New advisory: `runStoreMutationAdvisory({ touchedFiles, repoRoot })` returns `{ warnings: ValidatorWarning[], exitCode: 0 }`. Scans `packages/db/src/{stores,storage}/**/*.ts` (excluding `__tests__/`) for `.update(` / `.updateMany(` / `.delete(` / `.deleteMany(` Prisma calls whose surrounding ±10 lines contain no `organizationId` / `orgId` reference, honoring the inline suppression directive. |
| `.agent/tools/__tests__/store-mutation-check.test.ts`                         | TDD tests: flags un-scoped `update`, passes scoped `updateMany`, honors suppression directive, skips test files, scopes to `packages/db/src/{stores,storage}/`, message format.                                                                                                                                                                                                                            |
| `packages/db/src/stores/__tests__/prisma-deployment-connection-store.test.ts` | Prisma-mock regression tests for the relation-filter WHERE shape + `count===0` throw (mirror `storage/__tests__/prisma-pause-store.test.ts`).                                                                                                                                                                                                                                                              |

Each store task that lacks a co-located test file creates one under `packages/db/src/stores/__tests__/`. Stores that already have a test file get new `describe` blocks appended. Test-file existence is checked per task.

### Modify

| Path                                                             | Change                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db/src/stores/prisma-deployment-connection-store.ts`   | `updateStatus`, `updateCredentials`, `delete` gain required `organizationId: string` first arg; Pattern C via `deployment` relation.                                                                                                                               |
| `apps/api/src/services/cron/meta-token-refresh.ts`               | `MetaTokenRefreshDeps.updateCredentials` / `.updateStatus` signatures gain `organizationId`; `DeploymentConnectionRecord` already carries `deploymentId` — derive org via a deployment lookup (added to deps) or thread the connection's resolved org. See Task 1. |
| `apps/api/src/bootstrap/inngest.ts`                              | The adapter closures (`:327-332`) pass org through to `connectionStore.updateCredentials/updateStatus`.                                                                                                                                                            |
| `apps/api/src/routes/google-calendar-oauth.ts`                   | Request-scoped caller (`:188`) passes its `organizationId`.                                                                                                                                                                                                        |
| `packages/db/src/stores/prisma-contact-store.ts`                 | `updateStage`, `updateLastActivity`, `recordMessagingOptOut`, `delete` — collapse pre-fetch+update into Pattern B / guarded `deleteMany`. Mutators already take `orgId`.                                                                                           |
| `packages/db/src/stores/prisma-opportunity-store.ts`             | `updateStage` (Pattern B, orgId present), `updateRevenueTotal` (un-prefix `_orgId` → `orgId`, Pattern A).                                                                                                                                                          |
| `packages/db/src/stores/prisma-deployment-memory-store.ts`       | `incrementConfidence`, `delete` gain `organizationId`; Pattern A.                                                                                                                                                                                                  |
| `packages/db/src/stores/prisma-owner-memory-store.ts`            | `correctMemory`, `deleteMemory` (DeploymentMemory) + KnowledgeChunk update/delete gain `organizationId`; Pattern A.                                                                                                                                                |
| `packages/db/src/stores/prisma-workflow-store.ts`                | Interface + 3 sub-store `update` methods: WorkflowExecution (Pattern A direct), PendingActionRecord (Pattern A direct), ApprovalCheckpointRecord (Pattern C via `workflow` relation).                                                                              |
| `packages/db/src/stores/prisma-agent-task-store.ts`              | `updateStatus`, `submitOutput`, `review` gain `organizationId`; Pattern A/B.                                                                                                                                                                                       |
| `packages/db/src/stores/prisma-creative-job-store.ts`            | 8 mutators gain `organizationId`; Pattern B.                                                                                                                                                                                                                       |
| `packages/db/src/stores/prisma-deployment-store.ts`              | `updateStatus`, `update`, `delete` gain `organizationId`; Pattern B / guarded `deleteMany`.                                                                                                                                                                        |
| `packages/db/src/stores/prisma-booking-store.ts`                 | `confirm`, `markFailed` gain `organizationId`; Pattern B.                                                                                                                                                                                                          |
| `packages/db/src/stores/prisma-command-store.ts`                 | `updateCommandStatus` gains `organizationId`; Pattern A.                                                                                                                                                                                                           |
| `packages/db/src/stores/prisma-execution-trace-store.ts`         | `linkOutcome` gains `organizationId`; Pattern A.                                                                                                                                                                                                                   |
| `packages/db/src/stores/prisma-org-agent-enablement-store.ts`    | `setStatus` (takes `orgId`) → Pattern A with `where: { id, orgId }` (note column name).                                                                                                                                                                            |
| `packages/db/src/stores/prisma-whatsapp-test-send-store.ts`      | `updateWebhookStatus` gains `organizationId`; Pattern B.                                                                                                                                                                                                           |
| `packages/db/src/stores/prisma-listing-store.ts`                 | `update`, `delete` — **exempt**; add `// route-governance: store-mutation-global` suppression directive comment above each Prisma call + a 1-line rationale. No signature change.                                                                                  |
| `packages/db/src/stores/prisma-outbox-store.ts`                  | `markPublished`, `recordFailure` — **exempt**; same suppression directive + rationale. No signature change.                                                                                                                                                        |
| `packages/core/src/governance/governance-verdict-store/types.ts` | Add `[key: string]: unknown` index signature to `GovernanceVerdictDetails`.                                                                                                                                                                                        |
| `packages/core/src/consent/consent-service.ts`                   | Remove `as any` at `:130`; drop the eslint-disable.                                                                                                                                                                                                                |
| `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`     | Remove `as any` at `:233`; drop the eslint-disable.                                                                                                                                                                                                                |
| `packages/core/src/skill-runtime/hooks/claim-classifier.ts`      | Remove `as any` at `:294,341,388`; drop the three eslint-disables.                                                                                                                                                                                                 |
| `.agent/tools/check-routes.ts`                                   | Import `runStoreMutationAdvisory`; add it as a third element in the `--mode=warn-touched` `Promise.all` + merge its warnings.                                                                                                                                      |
| `.agent/tools/__tests__/check-routes-warn-mode.test.ts`          | New test: a touched store file with an un-scoped mutation surfaces in the merged advisory output.                                                                                                                                                                  |

### Untouched but worth noting

- `packages/db/src/storage/prisma-lifecycle-store.ts:261` (`updateDispatchRecord`) — deferred (no `@relation`; see Known smells). PR-3 does **not** touch this file.
- `packages/db/src/stores/prisma-creator-identity-store.ts` — deferred (no `deployment` relation). Advisory will warn; that is expected and documented.
- All `packages/db/src/storage/**` stores other than the (deferred) lifecycle method — already tightened by PR #590 / #598.
- In-memory store siblings — none are issue #601 candidates; `TenantMismatchError` is not introduced anywhere in PR-3.

---

## Implementation tasks

### Task 0: Preflight — confirm baseline + candidate-list freshness

**Files:** none (verification-only).

- [ ] **Step 1: Confirm `main` HEAD and capture the baseline SHA.**

Run: `git fetch origin main && git log --oneline origin/main -3`
Expected: top commit is `295e95ab` (PR-2.5) or newer. Record `git rev-parse origin/main` as the PR-3 baseline in the PR description.

- [ ] **Step 2: Re-grep the store candidate list for un-scoped mutations.**

Run:

```bash
rg -n "\.(update|updateMany|delete|deleteMany)\(" packages/db/src/stores --type ts | grep -v __tests__
```

Expected: every method named in the File structure "Modify" table appears. If any candidate already carries `organizationId` in its WHERE (i.e. was tightened by a parallel PR), strike it from this plan inline and note it in the PR description.

- [ ] **Step 3: Confirm the exemplar + error class locations.**

Run:

```bash
sed -n '32,58p' packages/db/src/storage/prisma-approval-store.ts
rg -n "class StaleVersionError|class TenantMismatchError" packages/core/src/approval/state-machine.ts
```

Expected: `updateState` uses `updateMany({ where: { id, version, organizationId } })` + `StaleVersionError`; both error classes exist at the cited lines.

- [ ] **Step 4: Confirm the verdict cast sites are unchanged.**

Run:

```bash
rg -n "verdictStore.save as any|verdictStore\.save\(.*as any" packages/core/src
```

Expected: 5 hits — `consent/consent-service.ts:130`, `skill-runtime/hooks/pdpa-consent-gate.ts:233`, `skill-runtime/hooks/claim-classifier.ts:294,341,388`. If counts differ, re-derive the Task 18 edit list.

- [ ] **Step 5: Confirm the check-routes warn-touched merge block.**

Run: `sed -n '170,190p' .agent/tools/check-routes.ts`
Expected: `mode === "warn-touched"` runs `runRouteClassAdvisory` + `runCrossAppTypesAdvisory` via `Promise.all` and merges warnings. This is the block Task 19 extends.

- [ ] **Step 6: No commit.** Verification only. If anything diverged, fix the affected task inline before proceeding.

---

### Task 1: 3a — `prisma-deployment-connection-store` (relation-filter, Pattern C) + caller cascade

**Highest priority — live production hot path via the Inngest webhook + Meta token-refresh cron.**

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-connection-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-deployment-connection-store.test.ts`
- Modify: `apps/api/src/services/cron/meta-token-refresh.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`
- Modify: `apps/api/src/routes/google-calendar-oauth.ts`

- [ ] **Step 1: Write the failing store test.**

```ts
// packages/db/src/stores/__tests__/prisma-deployment-connection-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentConnectionStore } from "../prisma-deployment-connection-store.js";

function createMockPrisma() {
  return {
    deploymentConnection: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaDeploymentConnectionStore tenant isolation", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentConnectionStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Prisma client
    store = new PrismaDeploymentConnectionStore(prisma as any);
  });

  describe("updateStatus", () => {
    it("scopes WHERE by relation-filter deployment.organizationId", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 1 });
      await store.updateStatus("org_1", "conn_1", "expired");
      const args = prisma.deploymentConnection.updateMany.mock.calls[0]![0];
      expect(args.where).toEqual({ id: "conn_1", deployment: { organizationId: "org_1" } });
      expect(args.data).toEqual({ status: "expired" });
    });

    it("throws StaleVersionError on count=0 (missing/tenant mismatch)", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.updateStatus("org_X", "conn_1", "expired")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("updateCredentials", () => {
    it("scopes WHERE by relation-filter and writes credentials + metadata", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 1 });
      await store.updateCredentials("org_1", "conn_1", "enc", { foo: "bar" });
      const args = prisma.deploymentConnection.updateMany.mock.calls[0]![0];
      expect(args.where).toEqual({ id: "conn_1", deployment: { organizationId: "org_1" } });
      expect(args.data).toEqual({ credentials: "enc", metadata: { foo: "bar" } });
    });

    it("throws StaleVersionError on count=0", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.updateCredentials("org_X", "conn_1", "enc")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("delete", () => {
    it("scopes deleteMany WHERE by relation-filter and throws on count=0", async () => {
      prisma.deploymentConnection.deleteMany.mockResolvedValue({ count: 0 });
      await expect(store.delete("org_X", "conn_1")).rejects.toThrow(/Stale version/);
      const args = prisma.deploymentConnection.deleteMany.mock.calls[0]![0];
      expect(args.where).toEqual({ id: "conn_1", deployment: { organizationId: "org_X" } });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/db test prisma-deployment-connection-store`
Expected: FAIL — current `updateStatus(id, status)` signature rejects the 3-arg call / WHERE shape mismatch.

- [ ] **Step 3: Tighten the store (Pattern C).**

Replace the three mutators in `packages/db/src/stores/prisma-deployment-connection-store.ts`:

```ts
import { StaleVersionError } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";

// ... create / listByDeployment / findByDeploymentAndType unchanged ...

  async updateStatus(organizationId: string, id: string, status: string): Promise<void> {
    const result = await this.prisma.deploymentConnection.updateMany({
      where: { id, deployment: { organizationId } },
      data: { status },
    });
    if (result.count === 0) {
      throw new StaleVersionError(id, -1, -1);
    }
  }

  async updateCredentials(
    organizationId: string,
    id: string,
    credentials: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.prisma.deploymentConnection.updateMany({
      where: { id, deployment: { organizationId } },
      data: {
        credentials,
        ...(metadata ? { metadata: metadata as object } : {}),
      },
    });
    if (result.count === 0) {
      throw new StaleVersionError(id, -1, -1);
    }
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const result = await this.prisma.deploymentConnection.deleteMany({
      where: { id, deployment: { organizationId } },
    });
    if (result.count === 0) {
      throw new StaleVersionError(id, -1, -1);
    }
  }
```

Note: the previous `updateStatus`/`updateCredentials` returned the updated row; their callers (Step 5) discard it (`await connectionStore.updateCredentials(...)`), so the return type narrows to `Promise<void>` with no caller impact. Confirm with the grep in Step 5.

- [ ] **Step 4: Run the store test to verify it passes.**

Run: `pnpm --filter @switchboard/db test prisma-deployment-connection-store`
Expected: PASS.

- [ ] **Step 5: Trace + thread org through every caller.**

Run:

```bash
rg -n "updateStatus|updateCredentials|connectionStore\.delete|deploymentConnection.*\.delete" apps packages --type ts | grep -iv test | grep -i "connection\|credential\|status"
```

Expected callers: `apps/api/src/bootstrap/inngest.ts:327,330`, `apps/api/src/routes/google-calendar-oauth.ts:188`, `apps/api/src/services/cron/meta-token-refresh.ts:78,84`. For each:

(a) `apps/api/src/services/cron/meta-token-refresh.ts` — widen the deps interface and pass org. The iterated `DeploymentConnectionRecord` carries `deploymentId` but not org; add a `resolveOrgId(deploymentId) => Promise<string>` to the deps (the cron already has deployment-store access at the bootstrap site) **or** add `organizationId` to `DeploymentConnectionRecord` and populate it in `listMetaConnections`. Prefer adding `organizationId` to the record (the bootstrap adapter's `listMetaConnections` maps from rows that can join the deployment). Update:

```ts
interface DeploymentConnectionRecord {
  id: string;
  deploymentId: string;
  organizationId: string; // NEW — required for store-layer tenant scoping
  type: string;
  status: string;
  credentials: string;
  metadata: Record<string, unknown> | null;
}

export interface MetaTokenRefreshDeps {
  listMetaConnections: () => Promise<DeploymentConnectionRecord[]>;
  updateCredentials: (organizationId: string, id: string, credentials: string) => Promise<void>;
  updateStatus: (organizationId: string, id: string, status: string) => Promise<void>;
  // ...rest unchanged
}
```

Then at the call sites in the same file: `await deps.updateCredentials(conn.organizationId, conn.id, encrypted);` and `await deps.updateStatus(conn.organizationId, conn.id, "needs_reauth");`.

(b) `apps/api/src/bootstrap/inngest.ts:327-332` — the adapter closures forward org:

```ts
    updateCredentials: async (organizationId, id, credentials) => {
      await connectionStore.updateCredentials(organizationId, id, credentials);
    },
    updateStatus: async (organizationId, id, status) => {
      await connectionStore.updateStatus(organizationId, id, status);
    },
```

And `listMetaConnections` (the adapter mapping at `:312-325`) must include `organizationId`. The source rows come from `connectionStore.listByDeployment` (no org) — join the deployment: for each connection, resolve org via `deploymentStore.findById(c.deploymentId)` (available in the bootstrap scope) and map `organizationId: deployment.organizationId`. If `listMetaConnections` aggregates across deployments, batch the deployment lookups.

(c) `apps/api/src/routes/google-calendar-oauth.ts:188` — request-scoped; pass the route's resolved org: `await connectionStore.updateCredentials(organizationId, existing.id, credentials, { ... })`. Confirm the route already resolves `organizationId` (it is an authed dashboard route; grep for `organizationId` / `req` org in the handler).

- [ ] **Step 6: Typecheck db + api.**

Run: `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/api typecheck`
Expected: PASS. If api typecheck reports missing exports from `@switchboard/db`/`@switchboard/core`, run `pnpm reset` first (per CLAUDE.md), then re-run.

- [ ] **Step 7: Run db + api test suites.**

Run: `pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test`
Expected: PASS (excluding the known pre-existing flakes: `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` advisory-lock failures, and api `bootstrap-smoke` / `db-sanity` npm-warning flakes — these reproduce on clean main and do not block).

- [ ] **Step 8: Commit.**

```bash
git add packages/db/src/stores/prisma-deployment-connection-store.ts \
  packages/db/src/stores/__tests__/prisma-deployment-connection-store.test.ts \
  apps/api/src/services/cron/meta-token-refresh.ts \
  apps/api/src/bootstrap/inngest.ts \
  apps/api/src/routes/google-calendar-oauth.ts
git commit -m "fix(db): tenant-scope deployment-connection mutations (audit Round-2 3a, #601)"
```

---

### Task 2: `prisma-contact-store` (Pattern B — collapse pre-fetch into guarded write)

**Files:**

- Modify: `packages/db/src/stores/prisma-contact-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts` (create if absent)

The mutators already take `orgId` and pre-fetch `findFirst({ where: { id, organizationId: orgId } })` then `update({ where: { id } })`. Collapse each into a single guarded `updateMany`; remove the pre-fetch.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaContactStore } from "../prisma-contact-store.js";

function createMockPrisma() {
  return {
    contact: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaContactStore tenant isolation", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaContactStore;
  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock
    store = new PrismaContactStore(prisma as any);
  });

  it("updateStage scopes updateMany by id+organizationId and reads the row back", async () => {
    prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    prisma.contact.findFirstOrThrow.mockResolvedValue({
      id: "c_1",
      organizationId: "org_1",
      stage: "qualified",
      // ...minimal fields mapRowToContact needs; fill from existing fixture helper
    });
    await store.updateStage("org_1", "c_1", "qualified");
    expect(prisma.contact.updateMany.mock.calls[0]![0].where).toEqual({
      id: "c_1",
      organizationId: "org_1",
    });
  });

  it("updateStage throws StaleVersionError on count=0", async () => {
    prisma.contact.updateMany.mockResolvedValue({ count: 0 });
    await expect(store.updateStage("org_X", "c_1", "qualified")).rejects.toThrow(/Stale version/);
  });
});
```

Add equivalent `it` blocks for `updateLastActivity` and `recordMessagingOptOut`. For `delete`, assert the final root `tx.contact.deleteMany({ where: { id, organizationId } })` throws on `count===0` (mock the `$transaction` to invoke the callback with the mock tx).

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm --filter @switchboard/db test prisma-contact-store`
Expected: FAIL (current code calls `findFirst` + `update`, not `updateMany`).

- [ ] **Step 3: Tighten each mutator (Pattern B).**

For `updateStage`:

```ts
  async updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact> {
    const result = await this.prisma.contact.updateMany({
      where: { id, organizationId: orgId },
      data: { stage, updatedAt: new Date() },
    });
    if (result.count === 0) {
      throw new StaleVersionError(id, -1, -1);
    }
    const row = await this.prisma.contact.findFirstOrThrow({
      where: { id, organizationId: orgId },
    });
    return mapRowToContact(row);
  }
```

`updateLastActivity` (void) and `recordMessagingOptOut` (void) follow Pattern A — `updateMany({ where: { id, organizationId: orgId }, data })` + throw, drop the `findFirst`. For `delete`, replace the trailing `await tx.contact.delete({ where: { id } })` with a guarded `deleteMany`:

```ts
const del = await tx.contact.deleteMany({ where: { id, organizationId: orgId } });
if (del.count === 0) {
  throw new StaleVersionError(id, -1, -1);
}
```

Keep the existing pre-fetch in `delete` **only** if `phone` is needed for the cascade (it is — `existing.phone` drives the phone-keyed `deleteMany`s). The pre-fetch already filters by org, so the org guard is preserved; the trailing `deleteMany` guard is added defense-in-depth. Import `StaleVersionError` at the top.

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm --filter @switchboard/db test prisma-contact-store`
Expected: PASS.

- [ ] **Step 5: Caller check (no signature change expected).**

Run: `rg -n "contactStore\.(updateStage|updateLastActivity|recordMessagingOptOut|delete)\(" apps packages --type ts | grep -v __tests__`
Expected: callers already pass `orgId` first (the signature was unchanged). Confirm zero compile breaks.

- [ ] **Step 6: Typecheck + test db.**

Run: `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/db test`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-contact-store.ts packages/db/src/stores/__tests__/prisma-contact-store.test.ts
git commit -m "fix(db): collapse contact-store pre-fetch into tenant-scoped updateMany (audit Round-2, #601)"
```

---

### Task 3: `prisma-opportunity-store`

**Files:**

- Modify: `packages/db/src/stores/prisma-opportunity-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts` (create if absent)

`updateStage` already takes `orgId`. `updateRevenueTotal(_orgId, id)` has the org **unused** (`_`-prefixed) — un-prefix and use it.

- [ ] **Step 1: Write the failing test.** Assert `updateStage` and `updateRevenueTotal` both call `updateMany({ where: { id, organizationId: <orgId> }, ... })` and throw `StaleVersionError` on `count===0`. Mirror the Task 2 test shape (mock `opportunity.updateMany` + `findFirstOrThrow`).

```ts
it("updateRevenueTotal scopes by id+organizationId", async () => {
  prisma.opportunity.updateMany.mockResolvedValue({ count: 1 });
  await store.updateRevenueTotal("org_1", "opp_1");
  expect(prisma.opportunity.updateMany.mock.calls[0]![0].where).toEqual({
    id: "opp_1",
    organizationId: "org_1",
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @switchboard/db test prisma-opportunity-store` → FAIL.

- [ ] **Step 3: Tighten.** `updateStage` → Pattern B. `updateRevenueTotal(orgId, id)` → Pattern A (`updateMany({ where: { id, organizationId: orgId }, data })` + throw). Rename `_orgId` → `orgId` in the signature.

- [ ] **Step 4: Run to verify it passes.** PASS.

- [ ] **Step 5: Caller check.** `rg -n "opportunityStore\.(updateStage|updateRevenueTotal)\(" apps packages --type ts | grep -v __tests__`. `updateStage` callers unchanged; `updateRevenueTotal` callers already pass a (currently-ignored) org first arg — confirm.

- [ ] **Step 6: Typecheck + test.** `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/db test` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-opportunity-store.ts packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts
git commit -m "fix(db): tenant-scope opportunity-store mutations (audit Round-2, #601)"
```

---

### Task 4: `prisma-deployment-memory-store` + `prisma-owner-memory-store` (DeploymentMemory + KnowledgeChunk)

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-memory-store.ts`
- Modify: `packages/db/src/stores/prisma-owner-memory-store.ts`
- Test: co-located test files (create if absent)

Both DeploymentMemory and KnowledgeChunk have a direct `organizationId` column. `deployment-memory-store.decayStale` (`:99`) is a deliberate platform-wide batch decay with **no** org filter — leave it; add the suppression directive (Task 16 directive form) so the advisory does not flag it, with a 1-line rationale (`// route-governance: store-mutation-global — cross-org confidence decay batch`).

- [ ] **Step 1: Write failing tests.** For `deployment-memory-store`: `incrementConfidence(organizationId, id, newConfidence)` and `delete(organizationId, id)` scope `updateMany`/`deleteMany` by `{ id, organizationId }` and throw on `count===0`. For `owner-memory-store`: `correctMemory(organizationId, id, content)` (DeploymentMemory) + `deleteMemory(organizationId, id)` + KnowledgeChunk update/delete same shape.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @switchboard/db test prisma-deployment-memory-store prisma-owner-memory-store` → FAIL.

- [ ] **Step 3: Tighten.** Pattern A for all (void returns). Add `organizationId: string` as the first arg to `incrementConfidence`, `delete`, `correctMemory`, `deleteMemory`, and the KnowledgeChunk mutators. Convert `update`/`delete` → `updateMany`/`deleteMany` with `where: { id, organizationId }` + throw. Import `StaleVersionError`.

- [ ] **Step 4: Run to verify they pass.** PASS.

- [ ] **Step 5: Caller cascade.** Run:

```bash
rg -n "(deploymentMemoryStore|ownerMemoryStore|memoryStore)\.(incrementConfidence|delete|correctMemory|deleteMemory)\(" apps packages --type ts | grep -v __tests__
```

Thread `organizationId` from each caller. Owner-memory callers (FAQ/memory operator flows) are dashboard-API routes with request org; deployment-memory callers (creative/owner-memory services) have deployment org in scope.

- [ ] **Step 6: Typecheck + test.** `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/db test` → PASS. Run dependent packages if cascade reached them: `pnpm --filter @switchboard/api typecheck`.

- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-deployment-memory-store.ts packages/db/src/stores/prisma-owner-memory-store.ts packages/db/src/stores/__tests__/prisma-deployment-memory-store.test.ts packages/db/src/stores/__tests__/prisma-owner-memory-store.test.ts
git commit -m "fix(db): tenant-scope deployment+owner memory mutations (audit Round-2, #601)"
```

---

### Task 5: `prisma-workflow-store` (interface + 3 sub-stores; mixed Pattern A + C)

**Files:**

- Modify: `packages/db/src/stores/prisma-workflow-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-workflow-store.test.ts` (append; existing test referenced in memory as the mocked-Prisma exemplar)

Three `update` methods on the sub-store interfaces (`:40,52,65`) + impls (`:124,191,260`): WorkflowExecution (direct org → Pattern A), PendingActionRecord (direct org → Pattern A), ApprovalCheckpointRecord (**no direct org column** — relation-filter via `workflow` → Pattern C).

- [ ] **Step 1: Write failing tests.**

```ts
it("workflowExecution.update scopes by id+organizationId", async () => {
  prisma.workflowExecution.updateMany.mockResolvedValue({ count: 1 });
  await store.workflowExecutions.update("org_1", "wf_1", { status: "completed" });
  expect(prisma.workflowExecution.updateMany.mock.calls[0]![0].where).toEqual({
    id: "wf_1",
    organizationId: "org_1",
  });
});

it("approvalCheckpoint.update scopes by relation-filter workflow.organizationId", async () => {
  prisma.approvalCheckpointRecord.updateMany.mockResolvedValue({ count: 1 });
  await store.approvalCheckpoints.update("org_1", "cp_1", { status: "resolved" });
  expect(prisma.approvalCheckpointRecord.updateMany.mock.calls[0]![0].where).toEqual({
    id: "cp_1",
    workflow: { organizationId: "org_1" },
  });
});
```

Plus `count===0` throws for each.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @switchboard/db test prisma-workflow-store` → FAIL.

- [ ] **Step 3: Tighten.** Update the three interface signatures (`:40,52,65`) to `update(organizationId: string, id: string, updates: Partial<...>): Promise<void>`. In the impls: WorkflowExecution + PendingActionRecord use `updateMany({ where: { id, organizationId }, data })` (Pattern A); ApprovalCheckpointRecord uses `updateMany({ where: { id, workflow: { organizationId } }, data })` (Pattern C). Each throws `StaleVersionError` on `count===0`. Import `StaleVersionError`.

- [ ] **Step 4: Run to verify they pass.** PASS.

- [ ] **Step 5: Caller cascade (largest in the sweep — workflow runtime in core).** Run:

```bash
rg -n "\.(workflowExecutions|pendingActions|approvalCheckpoints)\b.*\.update\(|WorkflowStore" packages/core apps --type ts | grep -v __tests__
```

Workflow execution runs inside `packages/core` orchestration where deployment/org is in scope. Thread org at each call.

- [ ] **Step 6: Typecheck + test (db + core + api).** `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/core test` → PASS (mind the pre-existing core flakes).

- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-workflow-store.ts packages/db/src/stores/__tests__/prisma-workflow-store.test.ts <core caller files>
git commit -m "fix(db): tenant-scope workflow-store mutations (audit Round-2, #601)"
```

---

### Task 6: `prisma-agent-task-store`

**Files:** Modify `packages/db/src/stores/prisma-agent-task-store.ts`; create/append `__tests__/prisma-agent-task-store.test.ts`.

Mutators `updateStatus`, `submitOutput`, `review` (`:69,76,83`) currently take **no** org arg — AgentTask has a direct `organizationId` column.

- [ ] **Step 1: Write failing tests** asserting each mutator calls `updateMany({ where: { id, organizationId }, ... })` (Pattern B — they return the task) + `findFirstOrThrow` read-back + `StaleVersionError` on `count===0`.
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-agent-task-store`.
- [ ] **Step 3: Tighten** — add `organizationId: string` first arg to all three; Pattern B. Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller cascade.** `rg -n "taskStore\.(updateStatus|submitOutput|review)\(|agentTaskStore\." apps packages --type ts | grep -v __tests__`. Note `inngest.ts:244,270` calls `taskStore.updateStatus(task.id, "completed")` inside contexts where `deployment.organizationId` is in scope (see `:234,260`) — thread it.
- [ ] **Step 6: Typecheck + test (db + api).** PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-agent-task-store.ts packages/db/src/stores/__tests__/prisma-agent-task-store.test.ts apps/api/src/bootstrap/inngest.ts <other callers>
git commit -m "fix(db): tenant-scope agent-task-store mutations (audit Round-2, #601)"
```

---

### Task 7: `prisma-creative-job-store` (8 mutators)

**Files:** Modify `packages/db/src/stores/prisma-creative-job-store.ts`; create/append `__tests__/prisma-creative-job-store.test.ts`.

8 mutators (`updateStage`, `stop`, `updateProductionTier`, `updateUgcPhase`, `failUgc`, `stopUgc`, `attachIdentityRefs`, `markRegistryBackfilled` at `:101,116,123,159,174,185,195,209`) — none take org; CreativeJob has a direct `organizationId` column. All return the job (Pattern B).

- [ ] **Step 1: Write failing tests** — one `it` per mutator asserting `updateMany({ where: { id, organizationId } })` + read-back + throw. (Eight short blocks; the WHERE is identical, the `data` differs per method.)
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-creative-job-store`.
- [ ] **Step 3: Tighten** — add `organizationId: string` first arg to all 8; Pattern B. Note `assertMode` (`:45`) is a read helper — leave it. Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller cascade (creative-pipeline package + api).** `rg -n "creativeJobStore\.|jobStore\.(updateStage|stop|updateProductionTier|updateUgcPhase|failUgc|stopUgc|attachIdentityRefs|markRegistryBackfilled)\(" apps packages --type ts | grep -v __tests__`. Creative jobs are per-deployment; org is reachable from deployment context at callers.
- [ ] **Step 6: Typecheck + test (db + creative-pipeline + api).** `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/creative-pipeline typecheck && pnpm --filter @switchboard/api typecheck` + tests → PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts <callers>
git commit -m "fix(db): tenant-scope creative-job-store mutations (audit Round-2, #601)"
```

---

### Task 8: `prisma-deployment-store` (AgentDeployment)

**Files:** Modify `packages/db/src/stores/prisma-deployment-store.ts`; create/append test.

`updateStatus`, `update`, `delete` (`:57,64,85`) take no org; AgentDeployment has a direct `organizationId` column.

- [ ] **Step 1: Write failing tests** — `updateStatus`/`update` (Pattern B, return the deployment) and `delete` (guarded `deleteMany`) scope by `{ id, organizationId }` + throw on `count===0`.
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-deployment-store`.
- [ ] **Step 3: Tighten** — add `organizationId: string` first arg; Pattern B for `updateStatus`/`update`, guarded `deleteMany` for `delete`. Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller cascade.** `rg -n "deploymentStore\.(updateStatus|update|delete)\(" apps packages --type ts | grep -v __tests__`. Provisioning/lifecycle callers have org. Note: `findById(id)` (read) is unchanged.
- [ ] **Step 6: Typecheck + test (db + api).** PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-deployment-store.ts packages/db/src/stores/__tests__/prisma-deployment-store.test.ts <callers>
git commit -m "fix(db): tenant-scope deployment-store mutations (audit Round-2, #601)"
```

---

### Task 9: `prisma-booking-store`

**Files:** Modify `packages/db/src/stores/prisma-booking-store.ts`; create/append test.

`confirm`, `markFailed` (`:43,66`) take no org; Booking has a direct `organizationId` column.

- [ ] **Step 1: Write failing tests** — both scope `updateMany({ where: { id, organizationId } })` + read-back (they return the booking) + throw.
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-booking-store`.
- [ ] **Step 3: Tighten** — add `organizationId: string` first arg; Pattern B. Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller cascade.** `rg -n "bookingStore\.(confirm|markFailed)\(" apps packages --type ts | grep -v __tests__`. Booking flows are org-scoped (calendar tool + lifecycle).
- [ ] **Step 6: Typecheck + test (db + core + api as cascade reaches).** PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts <callers>
git commit -m "fix(db): tenant-scope booking-store mutations (audit Round-2, #601)"
```

---

### Task 10: `prisma-command-store`

**Files:** Modify `packages/db/src/stores/prisma-command-store.ts`; create/append test.

`updateCommandStatus` (`:56`, update at `:61`) takes no org; OperatorCommandRecord has a direct `organizationId` column.

- [ ] **Step 1: Write failing test** — `updateCommandStatus` scopes `updateMany({ where: { id, organizationId }, data })` + throw on `count===0`. (Verify the method's `where` keys on `commandId`/`id` — match the existing arg name.)
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-command-store`.
- [ ] **Step 3: Tighten** — add `organizationId: string` first arg; Pattern A (void). Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller cascade.** `rg -n "commandStore\.updateCommandStatus\(" apps packages --type ts | grep -v __tests__`. Operator-command flows are org-scoped.
- [ ] **Step 6: Typecheck + test.** PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-command-store.ts packages/db/src/stores/__tests__/prisma-command-store.test.ts <callers>
git commit -m "fix(db): tenant-scope command-store mutation (audit Round-2, #601)"
```

---

### Task 11: `prisma-execution-trace-store`

**Files:** Modify `packages/db/src/stores/prisma-execution-trace-store.ts`; create/append test.

`linkOutcome` (`:83`, update at `:87`) takes no org; ExecutionTrace has a direct `organizationId` column. (`findById(orgId, traceId)` at `:76` already takes org — read, unchanged.)

- [ ] **Step 1: Write failing test** — `linkOutcome` scopes `updateMany({ where: { id, organizationId }, data })` + throw.
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-execution-trace-store`.
- [ ] **Step 3: Tighten** — add `organizationId: string` first arg; Pattern A. Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller cascade.** `rg -n "executionTraceStore\.linkOutcome\(|traceStore\.linkOutcome\(" apps packages --type ts | grep -v __tests__`. Execution-trace writers run in deployment context.
- [ ] **Step 6: Typecheck + test.** PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-execution-trace-store.ts packages/db/src/stores/__tests__/prisma-execution-trace-store.test.ts <callers>
git commit -m "fix(db): tenant-scope execution-trace-store mutation (audit Round-2, #601)"
```

---

### Task 12: `prisma-org-agent-enablement-store` (note: `orgId` column)

**Files:** Modify `packages/db/src/stores/prisma-org-agent-enablement-store.ts`; create/append test.

`setStatus(orgId, agentKey, status)` (`:29`, update at `:30`) already takes `orgId`. The OrgAgentEnablement model column is **`orgId`**, not `organizationId` — the WHERE must use `orgId`. The model's unique tuple is `[orgId, agentKey]`, so the `updateMany` WHERE is `{ orgId, agentKey }` (not `id`).

- [ ] **Step 1: Write failing test.**

```ts
it("setStatus scopes updateMany by orgId+agentKey", async () => {
  prisma.orgAgentEnablement.updateMany.mockResolvedValue({ count: 1 });
  await store.setStatus("org_1", "alex", "disabled");
  expect(prisma.orgAgentEnablement.updateMany.mock.calls[0]![0].where).toEqual({
    orgId: "org_1",
    agentKey: "alex",
  });
});
```

Plus `count===0` throw.

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-org-agent-enablement-store`.
- [ ] **Step 3: Tighten** — Pattern A but WHERE is `{ orgId, agentKey }`. Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller check** — signature unchanged (`orgId` was already first); `rg -n "enablementStore\.setStatus\(|orgAgentEnablement.*setStatus" apps packages --type ts | grep -v __tests__` → confirm no breaks.
- [ ] **Step 6: Typecheck + test.** PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-org-agent-enablement-store.ts packages/db/src/stores/__tests__/prisma-org-agent-enablement-store.test.ts
git commit -m "fix(db): tenant-scope org-agent-enablement setStatus (audit Round-2, #601)"
```

---

### Task 13: `prisma-whatsapp-test-send-store`

**Files:** Modify `packages/db/src/stores/prisma-whatsapp-test-send-store.ts`; create/append test.

`updateWebhookStatus(input)` (`:66`, update at `:72`) — WhatsAppTestSend has a direct `organizationId` column. The method takes an `UpdateWebhookStatusInput` object; add `organizationId` to that input type (or as a separate arg — match the surrounding convention; the input-object form is cleaner here).

- [ ] **Step 1: Write failing test** — `updateWebhookStatus` scopes `updateMany({ where: { id, organizationId }, ... })` + (returns the row → read-back) + throw. Note current return is `WhatsAppTestSendRow | null`; preserve `null`-on-miss **or** switch to throw — pick throw for contract consistency and update the one caller.
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/db test prisma-whatsapp-test-send-store`.
- [ ] **Step 3: Tighten** — add `organizationId` to `UpdateWebhookStatusInput`; Pattern B. Import `StaleVersionError`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Caller cascade.** `rg -n "updateWebhookStatus\(" apps packages --type ts | grep -v __tests__`. The WhatsApp test-send route (Tech Provider verification surface) is org-scoped.
- [ ] **Step 6: Typecheck + test (db + api).** PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/stores/prisma-whatsapp-test-send-store.ts packages/db/src/stores/__tests__/prisma-whatsapp-test-send-store.test.ts <callers>
git commit -m "fix(db): tenant-scope whatsapp-test-send updateWebhookStatus (audit Round-2, #601)"
```

---

### Task 14: Exempt global stores — `prisma-listing-store` + `prisma-outbox-store` + `decayStale`

**Files:** Modify `packages/db/src/stores/prisma-listing-store.ts`, `packages/db/src/stores/prisma-outbox-store.ts`, `packages/db/src/stores/prisma-deployment-memory-store.ts` (the `decayStale` directive only — the rest of that file was tightened in Task 4).

No signature change. Add the inline suppression directive + a 1-line rationale above each genuinely-global Prisma mutation so the Task 16 advisory does not flag them.

- [ ] **Step 1: Annotate `prisma-listing-store.ts`.** Above the `update` (`:64`) and `delete` (`:74`) Prisma calls:

```ts
// route-governance: store-mutation-global — AgentListing is the cross-tenant
// marketplace catalog; no organizationId binding by design.
```

- [ ] **Step 2: Annotate `prisma-outbox-store.ts`.** Above `markPublished` (`:28`) and `recordFailure` (`:35`):

```ts
// route-governance: store-mutation-global — OutboxEvent is a system delivery
// queue drained by the publisher worker; no organizationId binding.
```

- [ ] **Step 3: Annotate `decayStale` (`prisma-deployment-memory-store.ts:99`).**

```ts
// route-governance: store-mutation-global — cross-org confidence decay batch.
```

- [ ] **Step 4: Typecheck.** `pnpm --filter @switchboard/db typecheck` → PASS (comments only).
- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/stores/prisma-listing-store.ts packages/db/src/stores/prisma-outbox-store.ts packages/db/src/stores/prisma-deployment-memory-store.ts
git commit -m "docs(db): mark genuinely-global store mutations exempt from tenant contract (#601)"
```

---

### Task 15: Full store-sweep regression gate

**Files:** none (verification-only).

- [ ] **Step 1: Run the full db package suite.** `pnpm --filter @switchboard/db test` → PASS (minus the documented advisory-lock flakes).
- [ ] **Step 2: Typecheck the dependency closure.** `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/creative-pipeline typecheck && pnpm --filter @switchboard/api typecheck` → PASS. If any reports stale missing-export errors, run `pnpm reset` and re-run.
- [ ] **Step 3: Confirm every tightened store now references org in its mutation WHERE.** Run:

```bash
rg -n "\.(update|updateMany|delete|deleteMany)\(" packages/db/src/stores --type ts | grep -v __tests__
```

Manually confirm each non-exempt, non-deferred hit is now `updateMany`/`deleteMany` with an org or relation filter. The only bare `where: { id }` mutations remaining should be the exempt (annotated) and deferred (CreatorIdentity) ones.

- [ ] **Step 4: No commit.** Gate only.

---

### Task 16: Tighten `GovernanceVerdictDetails` + remove the 5 `as any` casts (Cat 3.14)

**Files:**

- Modify: `packages/core/src/governance/governance-verdict-store/types.ts`
- Modify: `packages/core/src/consent/consent-service.ts`
- Modify: `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`
- Modify: `packages/core/src/skill-runtime/hooks/claim-classifier.ts`
- Test: the existing verdict-store / classifier / consent test files (append a compile-level assertion)

- [ ] **Step 1: Write a failing test** that constructs a `SaveGovernanceVerdictInput` with an extra `details` key and passes it to a typed `GovernanceVerdictStore["save"]` reference **without a cast**. Put it in `packages/core/src/governance/governance-verdict-store/__tests__/types.test.ts` (create if absent):

```ts
import { describe, it, expect } from "vitest";
import type { SaveGovernanceVerdictInput } from "../types.js";

describe("SaveGovernanceVerdictInput.details accepts extra keys", () => {
  it("compiles with arbitrary detail keys (no cast needed)", () => {
    const input: SaveGovernanceVerdictInput = {
      action: "block",
      reasonCode: "consent_missing",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "consent_gate",
      auditLevel: "warning",
      decidedAt: new Date().toISOString(),
      conversationId: "conv_1",
      deploymentId: "dep_1",
      details: { event: "jurisdiction_stamped", arbitrary: 123 },
    };
    expect(input.details?.["event"]).toBe("jurisdiction_stamped");
  });
});
```

- [ ] **Step 2: Run → FAIL** (typecheck error: `arbitrary` not assignable to `GovernanceVerdictDetails`). Run: `pnpm --filter @switchboard/core typecheck`.
- [ ] **Step 3: Widen the interface.** In `packages/core/src/governance/governance-verdict-store/types.ts`:

```ts
export interface GovernanceVerdictDetails {
  matchCategory?: string;
  matchId?: string;
  matchedText?: string;
  /** Input gate only — sentence containing the match. */
  sentence?: string;
  /** Guards persist guard-specific context; keys are not enumerated. */
  [key: string]: unknown;
}
```

- [ ] **Step 4: Remove the 5 casts.** In each site drop `as any` + the adjacent `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and the justification comment:
  - `consent/consent-service.ts:130` → `await verdictStore.save({ ... });`
  - `skill-runtime/hooks/pdpa-consent-gate.ts:233` → `await this.deps.verdictStore.save({ ... });`
  - `skill-runtime/hooks/claim-classifier.ts:294` → `await this.deps.verdictStore.save({ ...verdict, deploymentId: ctx.deploymentId });`
  - `skill-runtime/hooks/claim-classifier.ts:341` + `:388` → `await this.deps.verdictStore.save(saveInput);`

  Note `saveInput` at `:339,386` is `{ ...verdict, deploymentId, details: a.details }` where `a.details: Record<string, unknown>` — now assignable to the widened `details`.

- [ ] **Step 5: Run → PASS.** `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/core test` (mind pre-existing core flakes).
- [ ] **Step 6: Confirm zero casts remain.** `rg -n "verdictStore.save as any|verdictStore\.save\(.*as any" packages/core/src` → 0 hits.
- [ ] **Step 7: Lint to confirm no orphaned eslint-disable directives.** `pnpm --filter @switchboard/core lint` → PASS (an unused `eslint-disable` for `no-explicit-any` would itself warn).
- [ ] **Step 8: Commit.**

```bash
git add packages/core/src/governance/governance-verdict-store/types.ts packages/core/src/governance/governance-verdict-store/__tests__/types.test.ts packages/core/src/consent/consent-service.ts packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts packages/core/src/skill-runtime/hooks/claim-classifier.ts
git commit -m "refactor(core): widen GovernanceVerdictDetails, remove verdictStore.save casts (Cat 3.14)"
```

---

### Task 17: Implement the `store-mutation-check` advisory (TDD)

**Files:**

- Create: `.agent/tools/store-mutation-check.ts`
- Create: `.agent/tools/__tests__/store-mutation-check.test.ts`

Mirror `.agent/tools/cross-app-types-check.ts` exactly: same `runXAdvisory({ touchedFiles, repoRoot })` → `{ warnings: ValidatorWarning[], exitCode: 0 }` shape, same warning-only posture, same inline suppression directive mechanism (a different directive token: `store-mutation-global`).

The rule: for each touched file matching `packages/db/src/(stores|storage)/**/*.ts` (excluding `__tests__/`), find Prisma mutation call expressions (`.update(`, `.updateMany(`, `.delete(`, `.deleteMany(`) and warn when the surrounding window (the enclosing statement/method ±10 lines) contains **no** `organizationId` or `orgId` token, **unless** the call is preceded by the `// route-governance: store-mutation-global` directive.

- [ ] **Step 1: Write failing tests** covering: (a) flags a bare `prisma.contact.update({ where: { id } })`; (b) passes `prisma.contact.updateMany({ where: { id, organizationId } })`; (c) passes a relation-filter `where: { id, deployment: { organizationId } }`; (d) suppression directive silences a flagged call; (e) skips `__tests__/` files; (f) only scans `packages/db/src/{stores,storage}/`; (g) message format. Use ts-morph in-memory project fixtures (mirror `cross-app-types-check.test.ts`).

```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { scanStoreFileForTest } from "../store-mutation-check.js";

function scan(src: string, path = "packages/db/src/stores/x.ts") {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(path, src);
  return scanStoreFileForTest(sf, path);
}

describe("store-mutation advisory", () => {
  it("flags a bare where:{id} update", () => {
    const w = scan(`export class S {
      async f(id: string) { await this.prisma.contact.update({ where: { id }, data: {} }); }
    }`);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/organizationId/);
  });

  it("passes an org-scoped updateMany", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.contact.updateMany({ where: { id, organizationId }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes a relation-filter where", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.deploymentConnection.updateMany({ where: { id, deployment: { organizationId } }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("honors the suppression directive", () => {
    const w = scan(`export class S {
      async f(id: string) {
        // route-governance: store-mutation-global
        await this.prisma.agentListing.update({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("skips __tests__ files via the advisory entrypoint", async () => {
    // covered by runStoreMutationAdvisory scope filter — see entrypoint test below
    expect(true).toBe(true);
  });
});
```

Plus a `runStoreMutationAdvisory` entrypoint test asserting scope-filter (only `packages/db/src/{stores,storage}/` non-test `.ts` files are scanned).

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @switchboard/agent-tools test store-mutation-check` (or the `.agent/tools` test command — match how `cross-app-types-check.test.ts` is run; check `.agent/tools/package.json`).
- [ ] **Step 3: Implement `.agent/tools/store-mutation-check.ts`** mirroring `cross-app-types-check.ts`:

```ts
import { Project, type SourceFile, SyntaxKind, type CallExpression } from "ts-morph";
import { join } from "path";
import type { ValidatorWarning } from "./route-class-validator.js";

const STORE_SRC_RX = /^packages\/db\/src\/(stores|storage)\//;
const TESTS_RX = /\/__tests__\//;
const MUTATION_METHODS = new Set(["update", "updateMany", "delete", "deleteMany"]);
const SUPPRESS_DIRECTIVE_RX = /\/\/\s*route-governance:\s*store-mutation-global\b/;
const ORG_TOKEN_RX = /\b(organizationId|orgId)\b/;
const WINDOW_LINES = 10;

export interface StoreMutationAdvisoryOptions {
  touchedFiles: string[];
  repoRoot: string;
}
export interface StoreMutationAdvisoryResult {
  warnings: ValidatorWarning[];
  exitCode: 0;
}

export async function runStoreMutationAdvisory(
  opts: StoreMutationAdvisoryOptions,
): Promise<StoreMutationAdvisoryResult> {
  const inScope = opts.touchedFiles.filter(
    (f) => STORE_SRC_RX.test(f) && !TESTS_RX.test(f) && f.endsWith(".ts"),
  );
  if (inScope.length === 0) return { warnings: [], exitCode: 0 };

  const project = new Project({ useInMemoryFileSystem: false });
  const warnings: ValidatorWarning[] = [];
  for (const repoPath of inScope) {
    const abs = join(opts.repoRoot, repoPath);
    let sf: SourceFile;
    try {
      sf = project.addSourceFileAtPath(abs);
    } catch {
      continue;
    }
    warnings.push(...scanStoreFileForTest(sf, repoPath));
  }
  return { warnings, exitCode: 0 };
}

// Exported for unit tests.
export function scanStoreFileForTest(sf: SourceFile, repoPath: string): ValidatorWarning[] {
  const out: ValidatorWarning[] = [];
  const fullText = sf.getFullText();
  const lines = fullText.split("\n");

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const method = getMutationMethod(call);
    if (!method) continue;

    const callStartLine = call.getStartLineNumber(); // 1-based
    if (hasSuppressDirectiveAbove(lines, callStartLine)) continue;
    if (windowHasOrgToken(lines, callStartLine)) continue;

    out.push({
      path: repoPath,
      message: `Prisma '${method}' near line ${callStartLine} has no organizationId/orgId in its tenant filter — scope the WHERE clause (audit §10) or annotate '// route-governance: store-mutation-global' if genuinely global`,
    });
  }
  return out;
}

function getMutationMethod(call: CallExpression): string | null {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const name = expr.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  return MUTATION_METHODS.has(name) ? name : null;
}

function hasSuppressDirectiveAbove(lines: string[], callLine: number): boolean {
  // scan up to 3 lines above the call for the directive
  for (let i = Math.max(0, callLine - 4); i < callLine; i++) {
    if (SUPPRESS_DIRECTIVE_RX.test(lines[i] ?? "")) return true;
  }
  return false;
}

function windowHasOrgToken(lines: string[], callLine: number): boolean {
  const start = Math.max(0, callLine - 1 - WINDOW_LINES);
  const end = Math.min(lines.length, callLine + WINDOW_LINES);
  return ORG_TOKEN_RX.test(lines.slice(start, end).join("\n"));
}
```

Note: the `delete`/`update` etc. method-name match is broad (any `.update(` property call). The org-token window keeps false positives low; the suppression directive covers the rest. This is advisory-only — over-flagging is acceptable in warning mode and tuned before PR-4's error flip.

- [ ] **Step 4: Run → PASS.** Re-run the advisory test command.
- [ ] **Step 5: Typecheck `.agent/tools`.** Run the tools tsconfig typecheck (match the `cross-app-types-check` workflow; e.g. `pnpm --filter @switchboard/agent-tools typecheck` or `tsc -p .agent/tools/tsconfig.json --noEmit`).
- [ ] **Step 6: Smoke-test against the real db tree.** Run a one-off invocation feeding `touchedFiles` = the full `packages/db/src/{stores,storage}/**/*.ts` list and confirm: the deferred `CreatorIdentity` + `prisma-lifecycle-store` `updateDispatchRecord` warn (expected), the exempt annotated ones do **not**, and the tightened ones do **not**.
- [ ] **Step 7: Commit.**

```bash
git add .agent/tools/store-mutation-check.ts .agent/tools/__tests__/store-mutation-check.test.ts
git commit -m "feat(audit): add store-mutation tenant-scope advisory (warning mode)"
```

---

### Task 18: Wire the advisory into `check-routes --mode=warn-touched`

**Files:**

- Modify: `.agent/tools/check-routes.ts`
- Modify: `.agent/tools/__tests__/check-routes-warn-mode.test.ts`

- [ ] **Step 1: Write a failing integration test.** In `check-routes-warn-mode.test.ts`, add: when `touchedFiles` includes a `packages/db/src/stores/<fixture>.ts` with an un-scoped mutation, the merged advisory output contains a store-mutation warning. Mirror the existing cross-app-types integration test in the same file.
- [ ] **Step 2: Run → FAIL.** Run the warn-mode test.
- [ ] **Step 3: Extend the merge block.** In `.agent/tools/check-routes.ts`:

```ts
import { runStoreMutationAdvisory } from "./store-mutation-check.js";
```

and in the `mode === "warn-touched"` branch (`:174-190`):

```ts
const [routeClass, crossAppTypes, storeMutation] = await Promise.all([
  runRouteClassAdvisory({ repoRoot, touchedFiles: touched }),
  runCrossAppTypesAdvisory({ repoRoot, touchedFiles: touched }),
  runStoreMutationAdvisory({ repoRoot, touchedFiles: touched }),
]);
const merged = [...routeClass.warnings, ...crossAppTypes.warnings, ...storeMutation.warnings];
for (const w of merged) {
  console.warn(`::warning file=${w.path}::${w.message}`);
}
if (merged.length > 0) {
  console.warn(
    `\n${merged.length} advisory warning(s) — ${routeClass.warnings.length} route-class, ${crossAppTypes.warnings.length} cross-app-types, ${storeMutation.warnings.length} store-mutation.`,
  );
}
process.exit(0);
```

- [ ] **Step 4: Run → PASS.** Re-run the warn-mode test.
- [ ] **Step 5: Confirm the other two advisories' warn-mode tests still pass.** Run the full `.agent/tools` test suite.
- [ ] **Step 6: Smoke-test the CLI.** Run `node .agent/tools/check-routes <built> --mode=warn-touched` against the current branch diff (or invoke via the configured tools runner). Confirm exit code `0` and the merged summary line names all three advisories.
- [ ] **Step 7: Commit.**

```bash
git add .agent/tools/check-routes.ts .agent/tools/__tests__/check-routes-warn-mode.test.ts
git commit -m "feat(audit): wire store-mutation advisory into check-routes warn-touched"
```

---

### Task 19: End-to-end verification

**Files:** none (gate; open the PR after this passes).

- [ ] **Step 1: Branch sanity (subagent-drift guard).** Run `git branch --show-current` (expect `worktree-route-gov-pr3-plan`) + `git status --short`. Confirm every commit landed on this branch and no stray files.
- [ ] **Step 2: Full monorepo build.** `pnpm build` → PASS.
- [ ] **Step 3: Full test suite.** `pnpm test` → PASS, modulo the documented pre-existing flakes (`prisma-work-trace-store-integrity`, `prisma-ledger-storage`, `prisma-greeting-signal-store` advisory-lock; api `bootstrap-smoke` / `db-sanity` npm-warning). Confirm each failure reproduces on clean `main` before dismissing.
- [ ] **Step 4: Full typecheck.** `pnpm typecheck` → PASS. If stale missing-export errors appear, `pnpm reset` then re-run.
- [ ] **Step 5: Format check (CI runs this; local `pnpm lint` does not).** `pnpm format:check` → PASS. Run `pnpm format` if needed.
- [ ] **Step 6: Confirm zero residual `as any` on verdict saves.** `rg -n "verdictStore.save as any" packages/core/src` → 0.
- [ ] **Step 7: Confirm the advisory's expected steady-state.** Re-run the warn-touched advisory against the full `packages/db/src/{stores,storage}/**` set; the only store-mutation warnings should be the two **deferred** sites (CreatorIdentity, `updateDispatchRecord`). Record this in the PR description as the expected baseline PR-4 will resolve.
- [ ] **Step 8: No new commit.** Open the PR. Title: `feat(audit): Route Governance Contract v1 — Impl PR-3 (store-layer mutation contract sweep)`. Body references issue #601, the deferred sites, the exempt sites, and Cat 3.14 closure.

---

## Self-review

**1. Spec coverage.**

- §10.1 contract (required org arg + `updateMany` WHERE + `StaleVersionError` + remove unversioned branch) → Patterns A/B/C + Tasks 1–13.
- §10.2 exemplar reuse → Task 0 Step 3 + every store task imports `StaleVersionError`.
- §10.3 Cat 3.14 (verdict casts) → Task 16.
- §10.4 / §11 row 3.14 → Task 16; the advisory (§10.4 bullet 2) → Tasks 17–18.
- §12 PR-3 envelope (3a → 3b → 3c) → Task 1 (3a), Tasks 2–14 (3b), 3c deferred with rationale (Scope decision 1).
- §11 rows 3.15 + 3.16 → explicitly deferred (Scope decision 3); flagged so PR-4 picks them up.

**2. Placeholder scan.** Store tasks intentionally hand the implementer a `rg` caller-trace command rather than enumerating every caller in prose — caller lists are large and stale-prone, and the cascade is the load-bearing execution work. The WHERE shape, signature, return-handling, and test code are concrete in every task. The three pattern definitions carry the repeated boilerplate so per-store steps are not placeholders but parameterized applications. `<callers>` / `<core caller files>` in `git add` lines are deliberately variable — the implementer fills them from the Step 5 grep.

**3. Type consistency.** Every tightened mutator gains `organizationId: string` as the **first** argument (matching the existing `orgId`-first convention in contact/opportunity stores), except OrgAgentEnablement which keys on `{ orgId, agentKey }` (Task 12, called out). `StaleVersionError(id, -1, -1)` is the uniform throw (matches the approval-store exemplar's `-1` sentinel). The advisory returns `{ warnings: ValidatorWarning[], exitCode: 0 }` matching the two sibling advisories. `scanStoreFileForTest` is the name used in both the test (Task 17 Step 1) and the implementation (Step 3).

**Open risk to verify during execution:** the 3a `meta-token-refresh` cron currently aggregates connections without org; Task 1 Step 5 adds `organizationId` to `DeploymentConnectionRecord` and populates it via deployment lookup. If `listMetaConnections` cannot cheaply resolve org for every connection (e.g. orphaned connections with a dangling `deploymentId`), the implementer must decide between skipping orphans (log + continue) or failing the cron item — flag to the user if encountered.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-route-governance-contract-impl-pr3.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Given the per-store caller-cascade work, verify `git branch --show-current` after each subagent task (subagent dispatches have drifted cwd across worktrees before).

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
