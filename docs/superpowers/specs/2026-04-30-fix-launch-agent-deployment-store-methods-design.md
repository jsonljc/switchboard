# Design — `fix/launch-agent-deployment-store-methods` (Risk #2)

**Audit reference:** `.audit/08-launch-blocker-sequence.md` Launch-Risk #2 (lines 528–540).

**Date:** 2026-04-30

**Author:** Claude (Opus 4.7) under operator review.

**Slice:** Launch-Risk #2 only. Risks #3–#7 are out of scope.

---

## 1. Problem

Three routes mutate `AgentDeployment.status` directly via Prisma. Each mutation flips runtime state for one or more deployments without producing a `WorkTrace` row, bypassing the canonical persistence boundary:

| #   | Callsite                | Mutation                                                                                           | Operator semantic                                          |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | `governance.ts:184`     | `agentDeployment.updateMany({status:"active"} → {status:"paused"})` for `organizationId`           | Operator triggers emergency halt across all active agents  |
| 2   | `governance.ts:318`     | `agentDeployment.updateMany({status:"paused", skillSlug:"alex"} → {status:"active"})` for org      | Operator resumes Alex after readiness checks pass          |
| 3   | `billing.ts:247`        | `agentDeployment.updateMany({status:"active"} → {status:"suspended"})` for org (Stripe webhook)    | Subscription canceled → suspend every active deployment    |

These violate two doctrine invariants from `CLAUDE.md`:

- **`WorkTrace` is canonical persistence.** None of the three mutations land in `WorkTrace`. The `/api/governance/:orgId/status` route reads `AuditEntry` rows with `eventType: "agent.emergency-halted"` to surface halt history — a parallel persistence surface that exists precisely because no WorkTrace was written.
- **No mutating bypass paths.** Routes touch Prisma directly with no Store indirection.

The acceptance criteria from the audit doc:

> Store.halt() and Store.updateCircuitBreaker() methods created. Governance routes refactored to use them. Halt enforcement auditable via WorkTrace.

This slice implements **`halt`, `resume`, and `suspend`** only. `updateCircuitBreaker` is **explicitly deferred** (see §3) — `circuitBreakerThreshold` is read by `prisma-deployment-resolver.ts` but no callsite writes it today, so wrapping a non-existent mutation has no effect on the bypass surface.

## 2. Design intent

Create a single persistence boundary, `DeploymentLifecycleStore`, that owns the three deployment-status mutations. Each mutation persists state and an **operator-mutation `WorkTrace` record** in one Prisma transaction, then finalizes the trace post-tx, mirroring the pattern Risk #1 established for `ConversationStateStore`.

This is the **B-now, A-later** path. A future slice may register these as first-class action kinds behind `PlatformIngress.submit()` with full governance evaluation. This slice does not — operator emergency-halt and Stripe-driven suspend are operator/service mutations, not governed work submissions.

The plumbing is already in place from Risk #1 (PR #318):

- `WorkTrace.ingressPath = "store_recorded_operator_mutation"` discriminator.
- `WorkTrace.mode = "operator_mutation"` execution mode.
- `WorkTrace.hashInputVersion = 2` (current).
- `PrismaWorkTraceStore.recordOperatorMutation(trace, { tx })` for tx-aware insertion.

Risk #2 reuses every one of those primitives. No schema migration, no hash version bump, no core type change.

## 3. Non-goals

- **Not** building `Store.updateCircuitBreaker()`. The schema field `AgentDeployment.circuitBreakerThreshold` is read-only in current code; no route or job writes it. Wrapping a write that doesn't exist is dead surface. If/when an auto-halt or threshold-tuning path is built, that's the time to add the method.
- **Not** routing operator halt/resume/suspend through `PlatformIngress.submit()` in this slice.
- **Not** consolidating the `eventType: "agent.emergency-halted"` AuditEntry write into the store. The `/api/governance/:orgId/status` route reads that row to surface `haltedAt` and `haltReason` to the dashboard. Migrating the read to query WorkTrace by `intent: "agent_deployment.halt"` is a UI-touching follow-up; out of scope here. The route keeps its existing `app.auditLedger.record(...)` call after the store call returns.
- **Not** moving any `AgentDeployment` *reads* through the store. The `/status` route's `findFirst` and the resume route's `buildReadinessContext` stay direct-Prisma.
- **Not** changing the existing `PrismaDeploymentStore` (`packages/db/src/stores/prisma-deployment-store.ts`) — its `create`, `update`, `updateStatus`, `delete`, `findById`, `listByOrg`, `listByListing` methods are CRUD/provisioning surfaces and stay as-is. The new store is a separate, focused class.
- **Not** widening the schema enum. `AgentDeployment.status` is `String` (the schema comment says `provisioning|active|paused|deactivated`); billing.ts already writes `"suspended"`, which is undocumented in the comment. Pre-existing drift; flag-only, do not fix here.
- **Not** fixing the `marketplace-persona.ts`, `ensure-alex-listing.ts`, or seed-marketplace `upsert` paths. Those are provisioning-time creates, not operator mutations of running state.
- **Not** introducing per-deployment trace fan-out. One bulk halt produces one trace whose `parameters.affectedDeploymentIds` carries the granular detail (matches Risk #1's "1 logical operator action = 1 trace" convention).

## 4. Architecture

### 4.1 New core platform contract

`packages/core/src/platform/deployment-lifecycle-store.ts` (new file):

```ts
import type { Actor } from "./types.js";

export type DeploymentLifecycleActionKind =
  | "agent_deployment.halt"
  | "agent_deployment.resume"
  | "agent_deployment.suspend";

export interface HaltAllInput {
  organizationId: string;
  operator: Actor; // expected actor.type = "user" (operator-driven)
  reason: string | null;
}

export interface HaltAllResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface ResumeInput {
  organizationId: string;
  skillSlug: string; // current routes only resume "alex"; passing it explicitly preserves that scope
  operator: Actor;
}

export interface ResumeResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface SuspendAllInput {
  organizationId: string;
  operator: Actor; // expected actor.type = "service" (Stripe webhook)
  reason: string; // e.g. "subscription_canceled"
}

export interface SuspendAllResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface DeploymentLifecycleStore {
  haltAll(input: HaltAllInput): Promise<HaltAllResult>;
  resume(input: ResumeInput): Promise<ResumeResult>;
  suspendAll(input: SuspendAllInput): Promise<SuspendAllResult>;
}
```

No new error classes. The store does not throw on a zero-match `updateMany` — it returns `{ count: 0, affectedDeploymentIds: [] }` and still writes a trace (the operator/service action happened; recording it is the load-bearing invariant). Callers (route handlers) decide whether `count: 0` is a 200 or a 4xx; today's routes treat it as a 200 (same as current behavior), so no change.

### 4.2 Prisma implementation

`packages/db/src/stores/prisma-deployment-lifecycle-store.ts` (new file):

```ts
export class PrismaDeploymentLifecycleStore implements DeploymentLifecycleStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workTraceStore: PrismaWorkTraceStore,
  ) {}

  // haltAll, resume, suspendAll — see §4.4 for the per-method shape
}
```

Constructor dependencies match `PrismaConversationStateStore` (Risk #1): a `PrismaClient` and a typed `PrismaWorkTraceStore` (the typed concrete class is required because `recordOperatorMutation` is not on the public `WorkTraceStore` interface — it's a tx-aware extension only the Prisma class exposes).

### 4.3 Trace fields (common across all three methods)

Following the Risk #1 template:

| Field              | Value                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `mode`             | `"operator_mutation"`                                                                           |
| `ingressPath`      | `"store_recorded_operator_mutation"`                                                            |
| `hashInputVersion` | `2`                                                                                             |
| `outcome`          | `"running"` at persist (inside tx); finalized to `"completed"` post-tx                          |
| `governanceOutcome`| `"execute"`                                                                                     |
| `riskScore`        | `0`                                                                                             |
| `matchedPolicies`  | `[]`                                                                                            |
| `modeMetrics`      | `{ governanceMode: "operator_auto_allow" }`                                                     |
| `trigger`          | `"api"` for halt/resume; `"webhook"` for suspend                                                |
| `actor`            | from `input.operator`                                                                           |
| `requestedAt`      | `new Date().toISOString()` at the start of the tx                                               |
| `governanceCompletedAt` | same as `requestedAt`                                                                      |
| `executionStartedAt`, `completedAt`, `durationMs` | set on finalize                                              |

### 4.4 Per-method shape

#### `haltAll`

- Intent: `"agent_deployment.halt"`
- Tx contents:
  1. `findMany` deployments for `{ organizationId, status: "active" }` → capture `id`s and pre-status.
  2. `updateMany` flipping them to `status: "paused"` (returns `count`).
  3. Build trace with `parameters: { actionKind, orgId, before: { status: "active", ids: [...] }, after: { status: "paused", count }, reason }`.
  4. `workTraceStore.recordOperatorMutation(trace, { tx })`.
- Post-tx: finalize via `workTraceStore.update(workUnitId, { outcome: "completed", … })`.

#### `resume`

- Intent: `"agent_deployment.resume"`
- Tx contents:
  1. `findMany` for `{ organizationId, skillSlug, status: "paused" }` → ids.
  2. `updateMany` flipping them to `status: "active"`.
  3. Build trace with `parameters: { actionKind, orgId, skillSlug, before: { status: "paused", ids: [...] }, after: { status: "active", count } }`.
  4. `workTraceStore.recordOperatorMutation(trace, { tx })`.
- Post-tx: finalize as above.

#### `suspendAll`

- Intent: `"agent_deployment.suspend"`
- Tx contents:
  1. `findMany` for `{ organizationId, status: "active" }` → ids.
  2. `updateMany` flipping them to `status: "suspended"`.
  3. Build trace with `parameters: { actionKind, orgId, before: { status: "active", ids: [...] }, after: { status: "suspended", count }, reason }`.
  4. `workTraceStore.recordOperatorMutation(trace, { tx })`.
- Post-tx: finalize as above.

### 4.5 Wiring

`apps/api/src/app.ts`:

- Augment `FastifyInstance` with `deploymentLifecycleStore: DeploymentLifecycleStore | null`.
- Construct `new PrismaDeploymentLifecycleStore(prismaClient, prismaWorkTraceStore)` alongside `conversationStateStore` (same conditional gate: requires `prismaClient` + `workTraceStore`).
- `app.decorate("deploymentLifecycleStore", deploymentLifecycleStore ?? null)`.
- Re-export from `@switchboard/db` barrel.

### 4.6 Route refactors

`apps/api/src/routes/governance.ts`:

- **`POST /emergency-halt`** (line 184): replace the `if (app.prisma) { agentDeployment.updateMany(...); auditLedger.record({eventType:"agent.emergency-halted",...}); }` block with:
  - Guard: if `app.deploymentLifecycleStore` is null → 503 (mirrors `conversationStateStore` null-guard pattern).
  - Resolve operator actor (reuse `resolveOperatorActor` helper introduced in Risk #1 PR #319).
  - Call `deploymentLifecycleStore.haltAll({ organizationId: orgId, operator, reason: body.reason ?? null })`.
  - Use `result.count` and `result.affectedDeploymentIds` in the response.
  - **Keep** the separate `app.auditLedger.record({ eventType: "agent.emergency-halted", … })` write — the `/status` route still reads it (see §3 Non-goals).

- **`POST /resume`** (line 318): replace the bare `agentDeployment.updateMany({skillSlug:"alex",status:"paused"} → "active")` with:
  - 503 guard (same).
  - `deploymentLifecycleStore.resume({ organizationId: orgId, skillSlug: "alex", operator })`.
  - **Keep** the existing `auditLedger.record({ eventType: "agent.resumed", … })` write for symmetry.

`apps/api/src/routes/billing.ts`:

- **`subscription canceled` branch** (line 247): replace the `agentDeployment.updateMany({status:"active"} → "suspended")` with:
  - If `app.deploymentLifecycleStore` is null → log warn + skip (mirrors the existing `if (app.prisma)` defensive style — billing webhooks must not fail on missing infra).
  - `deploymentLifecycleStore.suspendAll({ organizationId: orgId, operator: { type: "service", id: "stripe-webhook" }, reason: "subscription_canceled" })`.
  - **Leave** the `managedChannel.updateMany(...)` line unchanged — channels are out of scope (no `ManagedChannelStore` exists; introducing one is a separate slice).

### 4.7 Idempotency

Stripe redelivers webhooks. Today the suspend path is naturally idempotent because `updateMany` on already-suspended rows is a no-op. After Risk #2:

- Each redelivery would write a fresh WorkTrace with `count: 0` (no rows matched). That's auditable noise, not corruption.
- If the team wants exactly-once trace persistence per logical Stripe event, that requires keying on the Stripe `event.id` via `idempotencyKey` on the trace. This is a follow-up; not blocking.

The governance routes are operator-driven and don't naturally retry, so trace duplication risk is negligible there.

## 5. Test plan

| Test                                                                                        | Type        | Location                                                        |
| ------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| `haltAll` writes WorkTrace with correct intent, ingressPath, mode, parameters               | unit        | `packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts` |
| `haltAll` flips `active → paused` and returns affected ids + count                          | unit        | same                                                            |
| `haltAll` returns count:0 on org with no active deployments and STILL writes a trace        | unit        | same                                                            |
| `resume` flips `paused → active` scoped to skillSlug                                        | unit        | same                                                            |
| `suspendAll` flips `active → suspended` and writes service-actor trace                      | unit        | same                                                            |
| Existing `api-governance.test.ts` mocks updated to use `deploymentLifecycleStore`           | route       | `apps/api/src/__tests__/api-governance.test.ts`                 |
| New test: emergency-halt route returns `deploymentsPaused: count` from store                | route       | same                                                            |
| New test: resume route returns 200 when store returns count:0                               | route       | same                                                            |
| Existing `billing.test.ts` mocks updated; new assertion that `suspendAll` was called        | route       | `apps/api/src/routes/__tests__/billing.test.ts`                 |
| Integration test (skipIf no DATABASE_URL): real Prisma — store records persist + finalize   | integration | `apps/api/src/__tests__/deployment-lifecycle-store.integration.test.ts` |

Coverage target: matches Risk #1 (~5–8 unit tests on the store, route-level mocking updates, one integration test gated on DATABASE_URL).

## 6. Risks & rollout

- **Behavior compatibility.** All three routes return the same response shape they return today. The `auditLedger.record({eventType:"agent.emergency-halted"})` write is preserved, so the `/status` route's read path doesn't change.
- **Null store guard.** API tests that don't decorate `deploymentLifecycleStore` will get 503 from halt/resume — the new mock decoration must be added in the same PR that lands the route refactor (caught by existing tests failing pre-fix).
- **Stripe webhook robustness.** The suspend branch tolerates `null` store (logs + skips) so a bootstrap-time prisma outage cannot 500 a Stripe redelivery. Pre-existing pattern; preserved.
- **No data migration.** Existing rows are untouched. New traces are forward-only.

## 7. Open follow-ups (out of scope, listed for tracking)

1. Migrate `/api/governance/:orgId/status` reads off `AuditEntry → eventType:"agent.emergency-halted"` and onto `WorkTrace` with `intent:"agent_deployment.halt"`. Allows dropping the duplicate domain-audit write from the route.
2. `ManagedChannelLifecycleStore` for the parallel `managedChannel.updateMany` at `billing.ts:248`. Same pattern; out of scope here.
3. `Store.updateCircuitBreaker()` once a write callsite exists.
4. Stripe-event idempotency on the `suspendAll` trace via `idempotencyKey: stripeEventId`.
5. Schema doc comment on `AgentDeployment.status` — add `"suspended"` to the documented enum values.
