# Spec-1B Act-Leg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the parent spec `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md` (§7, §8, §8a, §10, §11, §12, §13) and the Riley remediation overview `docs/superpowers/plans/2026-06-10-riley-remediation-00-overview.md` (decision #4) FIRST.

**Goal:** Let Riley reallocate a Meta campaign's daily budget through human approval, so an approved "daily budget X cents to Y cents" move actually changes the Meta budget **exactly once** and only the executed move is scored by the outcome ledger.

**Architecture:** A new governed `adoptimizer.campaign.reallocate` workflow intent (cloned from the proven pause/handoff family), parked behind a seeded `require_approval(mandatory)` policy. A read-modify-re-read executor serializes per campaign with a durable, TTL'd lease (not a transaction-scoped advisory lock spanning the HTTP call); it is replay-first (an existing success receipt or ambiguous attempt marker short-circuits before any Meta call), refuses on drift and unsupported topology, caps the signed delta against the enforced `assertWithinBlastRadius` contract (fail closed, never clamp), **commits a durable attempt marker before the Meta write**, writes the budget through a new idempotent `MetaAdsClient.updateCampaignBudget`, re-reads to confirm, and persists an `ExecutionReceipt`. The act leg crosses L2 producer to L5 submitter to L3 ingress/approval to L5 executor to L2 client; cents flow end-to-end, normalized to dollars exactly once per consumer boundary (the spend gate, `trueRoas`), never inside the executor's cap math.

**Tech Stack:** TypeScript, `@switchboard/ad-optimizer` (L2: Meta client, blast-radius contract, dispatch + plan predicates), `@switchboard/core` (L3: PlatformIngress, GovernanceGate, WorkTrace), `@switchboard/schemas` (L1: `ExecutionReceipt`), Fastify (apps/api: submit-request, submitter, executor, intent registration), Prisma (`packages/db`: seeded policy, `MetaMutationAttempt` lease/marker, ledger columns), Vitest.

---

## 1. Scope boundary: the WTP gate (load-bearing)

The strategy spec gates **committing** Spec-1B behind a Spec-1A paid-visit demo with 10-15 SG/MY clinics (§10, "WTP GATE"). This plan sequences the whole act leg, but **only PR 1B-1.1 is a pre-commit de-risk step to be built now**: §12 steps 0-1, in isolation, against a mocked Graph API, with **no ingress, no submitter, no live Meta write, no real money**. Every PR from PR 1B-1.2 onward is **WTP-gated** and specified at design altitude (interface + tests-to-write + producer/consumer seams + acceptance) so the sequence, layering, and safety composition are locked before any is built.

**Proportional fidelity (per writing-plans):** PR 1B-1.1 is full TDD with real, runnable test code. PR 1B-1.2 through PR 1B-3 are design altitude.

## 2. Entry gate: closed

Overview decision #4 makes three Tier-5 guards the explicit Spec-1B entry criteria; all three are **green on `main`**:

- **D9-2** (PR #1020) - the `system_auto_approved` short-circuit refuses a financial intent. The reallocate intent is `defaultMode:'workflow'`, never `system_auto_approved`; the exact name `adoptimizer.campaign.reallocate` is **already in `FINANCIAL_AUTO_APPROVE_DENYLIST`** (`governance-gate.ts:104`), barred from auto-approve the moment it registers. **Do not weaken it** (`feedback_system_auto_approved_bypasses_spend_gates`).
- **D5-2** (PR #1013) - the human gate survives a deleted/mis-seeded policy (executor last-mile `getApprovalState` + DELETE-route orphan guard + transactional seed). The reallocate executor reuses the `getApprovalState` pattern (`apps/api/src/bootstrap/riley-pause-executor.ts`).
- **D4-6** (PR #1022, spec §8a via #1023) - the enforced `BlastRadiusContract` + pure `assertWithinBlastRadius(contract, deltaCents, accountDailySpendCents)` ship in `packages/ad-optimizer/src/blast-radius-contract.ts`, exported at `index.ts:154`. Not wired yet; wiring is PR 1B-1.5. It already fails closed (SHARE_CAP) on a non-finite or non-positive `accountDailySpendCents`, so a null account-spend denominator is safe by construction.

No Spec-1B implementation PR merges unless these stay green.

## 3. Design decisions resolved (the genuine judgment calls + the review-hardened safety model)

### 3.1 At-most-once external write: durable marker committed BEFORE the Meta call

The §13 "one Meta edit per key" test plus the harsher "the Meta write succeeded but the process then crashed/threw" case are handled by a single durable `MetaMutationAttempt` record (§3.3 doubles it as the campaign lease), checked **replay-first** (immediately after the approval check, BEFORE pre-read/drift/cap - a replay must short-circuit before drift can mis-fire on the already-applied budget) and **committed in its own transaction immediately before the Meta write, after all clean pre-write guards pass**. Three states keyed by `executionWorkUnitId`:

| State                                                                                           | Meaning                                                                                                         | Executor action                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| an `ExecutionReceipt` exists in `WorkTrace.executionOutputs`                                    | the move already succeeded                                                                                      | return it, **no Meta call** (replay no-op)                                                                                                 |
| a `MetaMutationAttempt` row exists with `status="pending"`/`"recovery_required"` but no receipt | a prior attempt was ambiguous (write threw, post-read failed/mismatched, or crashed after the marker committed) | return `outcome:"failed"` `MUTATION_RECOVERY_REQUIRED`, **no Meta call** - block auto-replay, require operator reconciliation against Meta |
| no marker                                                                                       | first attempt                                                                                                   | (later, after all clean guards) commit a `pending` marker, then write                                                                      |

**Why the marker is committed before the call, and nothing spans the call in an open transaction (the durability blocker).** A `pg_advisory_xact_lock` (the booking precedent, `prisma-booking-store.ts:41`) is **transaction-scoped**: any row written in that transaction is not durable until commit. If the marker were written inside a transaction that also held the lock across the remote HTTP call and the process crashed after Meta succeeded but before commit, the marker would roll back and a replay would call Meta again - breaking exactly-once. Therefore: the `pending` marker is `INSERT`ed **and committed in its own transaction** right before the Meta write; the Meta call happens with **no open transaction**; the receipt + `applied` transition is a separate post-call transaction. The "lease" is held logically by the committed `pending` row + its TTL (§3.3), never by an open transaction.

**Why the marker is created AFTER the clean guards (not before drift/cap).** A clean pre-write failure (`BUDGET_DRIFTED`, `DELTA_CAP`/`SHARE_CAP`, `UNSUPPORTED_BUDGET_TOPOLOGY`, `*_UNREADABLE`) must leave **no marker**, so a corrected re-proposal is not poisoned into `MUTATION_RECOVERY_REQUIRED`. Only the steps after the marker commit (the Meta write and the post-read) can leave a `recovery_required` marker, because only they are genuinely ambiguous about whether money moved.

**Three distinct keys** (do not overload one `idempotencyKey`):

- `submitIdempotencyKey` = `` `mutate:riley:${recommendationId}:reallocate` `` - dedups the **submit** at `PlatformIngress.submit` (4-segment shape mirrors `riley-pause-submit-request.ts:83`; ids are globally unique cuids).
- `executionWorkUnitId` - the work-unit id; `@unique` replay key on `MetaMutationAttempt` and the receipt (one Meta edit per execution work unit).
- `metaMutationAttemptId` - the marker row's own id.

**Why never the client.** Interactive paths use a **fresh `MetaAdsClient` per Graph call** (`feedback_meta_ads_client_rate_limiter_fresh_instance`), so an in-memory map on the client is empty every call. Meta has no idempotency header for budget edits. Idempotency MUST be durable and on our side; the client is a pure single-write.

**Marker model placement.** A **dedicated `MetaMutationAttempt` model**, not a reuse of `IdempotencyRecord` (verified `schema.prisma:217`: it has only `{id, response: Json, createdAt, expiresAt}` - no `status` column, and is owned by the ingress idempotency path). A queryable status state machine + the campaign-lease fields justify the dedicated model over encoding state in someone else's `Json`.

### 3.2 `ExecutionReceipt` shape (success artifact + audit ids) + reason-code taxonomy

`ExecutionReceipt` is the **success artifact only**, a Zod schema in `@switchboard/schemas` (L1: persisted data the L2 producer shapes, the L4 store writes via `WorkTrace.executionOutputs`, the L5 executor populates). Money fields are **safe positive integers** (not a bare `int`); the signed delta is the only signed field:

```ts
const PositiveSafeCents = z.number().int().safe().positive();

export const ExecutionReceiptSchema = z.object({
  kind: z.literal("campaign_budget_reallocation"),
  organizationId: z.string(),
  deploymentId: z.string(),
  adAccountId: z.string(), // the frozen, approved account (§3.4)
  campaignId: z.string(),
  workTraceId: z.string(),
  executionWorkUnitId: z.string(), // replay key (one edit per id)
  approvedLifecycleId: z.string(),
  bindingHash: z.string(), // the frozen-payload content binding the human approved
  requestedFromCents: PositiveSafeCents,
  requestedToCents: PositiveSafeCents,
  observedPriorCents: PositiveSafeCents, // live pre-write read (== from when no drift); rollback's captured prior
  appliedCents: PositiveSafeCents, // post-write re-read (== to on success)
  deltaCentsSigned: z.number().int().safe(), // appliedCents - observedPriorCents; signed
  executedAt: z.string().datetime(),
});
```

**Reason-code taxonomy.** A clean fail-closed path writes **no receipt** and **no marker**. An **ambiguous** path leaves the marker `recovery_required` so a retry cannot re-hit Meta. Permanent vs transient is explicit so the operator card is honest (finding: `BUDGET_UNREADABLE` was overloaded - now split by source):

| Reason                                                                                        | Receipt? | Marker                  | Class                              |
| --------------------------------------------------------------------------------------------- | -------- | ----------------------- | ---------------------------------- |
| `EXECUTOR_NOT_WIRED` (1B-1.2 placeholder)                                                     | no       | none                    | permanent (placeholder)            |
| `REALLOCATE_NOT_APPROVED` (last-mile)                                                         | no       | none                    | permanent                          |
| `LEASE_CONTENDED` (another executor holds the campaign lease)                                 | no       | none                    | transient - retry after TTL        |
| `UNSUPPORTED_BUDGET_TOPOLOGY` (`getCampaign` -> `dailyBudgetCents:null`: ABO/ad-set, not CBO) | no       | none                    | permanent - not retryable          |
| `CAMPAIGN_BUDGET_UNREADABLE` (`getCampaign` threw)                                            | no       | none                    | transient                          |
| `ACCOUNT_SPEND_UNREADABLE` (`getAccountDailySpendCents` threw)                                | no       | none                    | transient                          |
| `BUDGET_DRIFTED` (live != frozen `from`)                                                      | no       | none                    | the world moved; re-propose        |
| `DELTA_CAP` / `SHARE_CAP` (`assertWithinBlastRadius`)                                         | no       | none                    | over-cap; smaller move or operator |
| `META_WRITE_ERROR` (`updateCampaignBudget` threw)                                             | no       | **`recovery_required`** | ambiguous - money may have moved   |
| `POST_WRITE_MISMATCH` (re-read != requested)                                                  | no       | **`recovery_required`** | ambiguous - reconcile              |
| `MUTATION_RECOVERY_REQUIRED` (replay found an ambiguous prior attempt)                        | no       | (already set)           | blocks auto-replay                 |

### 3.3 Campaign serialization: a durable TTL'd lease (NOT an xact advisory lock across the HTTP call)

Drift alone does not serialize two approved work units racing on the same campaign (both read 5000, both pass drift, both write). Two writes must be serialized, which means the guard must span the read-write-reread including the HTTP call - and therefore **cannot** be a `pg_advisory_xact_lock` (transaction-scoped; would force an open transaction across remote HTTP, the §3.1 durability blocker). Instead the `MetaMutationAttempt` row **is** the lease:

- Keyed `(organizationId, adAccountId, campaignId)` for the active lease + `executionWorkUnitId @unique` for replay.
- **Acquire = a conditional insert/claim** ("no active row for this campaign whose `heldUntil > now`"). A live competing lease -> the claim affects zero rows -> `LEASE_CONTENDED`, **retryable failed, never a blocking wait** (the booking lock blocks; a money executor must not hold a connection blocking across an HTTP call, so this is `try`-acquire, finding #4).
- **Crash-safe:** `heldUntil` TTL (e.g. 2 min); a crashed executor's lease simply expires and the move is retryable.
- **Released** after the terminal outcome (receipt persisted, or a clean failure). Each DB op is its own committed transaction; the lease is held logically by the committed row, not by an open transaction.

This serializes both a same-work-unit duplicate dispatch and two different work units on the same campaign; combined with drift (a serialized B re-reads 6000 after A wrote, frozen-from 5000 -> `BUDGET_DRIFTED`), it is correct under concurrency. The exact conditional-claim SQL (a raw `INSERT ... WHERE NOT EXISTS (active lease)` mirroring the booking store's raw-SQL discipline, with the Prisma `bigint`/`::int4` casting lesson if any advisory primitive is used) is finalized when PR 1B-1.5 is built; the invariant ("at most one active lease per campaign, try-acquire, TTL-expiring, marker committed before the call") is fixed here.

### 3.4 Blast-radius cap composes with the require_approval frozen payload; full executor order

Two **orthogonal** gates, both must pass; the executor never clamps:

1. **Human approval (frozen payload).** The reallocate parks under the seeded `require_approval(mandatory)` policy. The human approves an exact `{adAccountId, campaignId, fromCents, toCents}` card. `createGatedLifecycle`'s `bindingHash` content-binds it; a mutated parameter at execution fails the `bindingHash`. The executor reads the frozen values from the bound parameters, never recomputes the target. **`adAccountId` is part of the frozen payload** (finding #3) so the executor locks, reads account spend, builds the Meta client, and stamps the receipt against the **approved** account, never an inferred one.
2. **Machine cap (blast radius).** Immediately before the write, after the live re-read, `assertWithinBlastRadius(contract, deltaCentsSigned, accountDailySpendCents)` (the cap abs's internally). A breach fails closed (`DELTA_CAP`/`SHARE_CAP`); the executor does not shrink the move.

**Full executor order (PR 1B-1.5).** Nothing but the Meta call sits outside a committed transaction; nothing holds an open transaction across the Meta call:

1. last-mile `getApprovalState` (approved/patched, org-mismatch-guarded) - else `REALLOCATE_NOT_APPROVED`.
2. **acquire the campaign lease** (try-claim on `(org, adAccountId, campaignId)`) - contention -> `LEASE_CONTENDED` retryable.
3. **replay-first**: existing receipt -> return it; existing pending/recovery marker -> `MUTATION_RECOVERY_REQUIRED`; else continue.
4. pre-write `getCampaign(campaignId)`: throw -> `CAMPAIGN_BUDGET_UNREADABLE`; `dailyBudgetCents:null` -> `UNSUPPORTED_BUDGET_TOPOLOGY`.
5. `assessBudgetDrift(frozenFromCents, liveCents)` -> breach `BUDGET_DRIFTED`.
6. `getAccountDailySpendCents()`: throw -> `ACCOUNT_SPEND_UNREADABLE`. `deltaCentsSigned = frozenToCents - liveCents`; `assertWithinBlastRadius(contract, deltaCentsSigned, accountDailySpendCents)` -> breach `DELTA_CAP`/`SHARE_CAP`.
7. **commit the `pending` `MetaMutationAttempt`** (own transaction; the point of no return; captures `observedPriorCents`).
8. `updateCampaignBudget(campaignId, frozenToCents)`: throw -> mark `recovery_required`, `META_WRITE_ERROR`.
9. post-write `getCampaign` re-read: != `frozenToCents` -> mark `recovery_required`, `POST_WRITE_MISMATCH`.
10. persist `ExecutionReceipt` + transition marker `applied` + stamp `PendingActionRecord.executedAt` (one transaction); release the lease; `outcome:"completed"`.

Steps 1-6 (clean guards) precede the marker, so they leave no marker. Cents end-to-end in the cap math; no dollars in the executor.

### 3.5 Spend-gate field, unit, and sign (frozen now)

The gate's `spendAmount` is **dollars** (verified: `checkSpendLimits` compares `Math.abs(spendAmount)` against `perActionLimit` as `$`; the D9-2 outbound guard reads `OUTBOUND_SPEND_KEYS = SPEND_KEYS.filter(k => k !== "amount")` = `["spendAmount","budgetChange","newBudget"]`). Two derived values:

- `deltaCentsSigned = toCents - fromCents` - blast-radius (abs'd internally) + receipt.
- `deltaCentsMagnitude = Math.abs(deltaCentsSigned)` - governance sizing.

**The producer emits `spendAmount = deltaCentsMagnitude / 100` (positive DOLLARS magnitude)** so a budget _decrease_ still sizes the gate and never sails under as a "negative" amount (finding #7). Pinned with a hard test (5000->8000 -> `spendAmount 30`; 8000->5000 -> `30`, not `-30`).

### 3.6 Meta unit asymmetry (a 100x trap)

- Campaign **`daily_budget`** is **native minor units (cents)** - parse directly, **no x100** (the existing `createDraftCampaign` treats it as the raw Meta value).
- Account insights **`spend`** is a **major-unit dollars string** (e.g. `"5000.00"`) - convert with `Math.round(Number(spend) * 100)`.

Getting this backwards is a 100x bug. PR 1B-1.1 pins **both** with explicit tests and **strict** parsing on both sides.

### 3.7 v1 budget-topology eligibility

Spec-1B v1 reallocates **CBO / campaign-level daily budgets only**. An ABO/ad-set campaign has no campaign `daily_budget`; `getCampaign` returns `dailyBudgetCents:null` and the executor refuses `UNSUPPORTED_BUDGET_TOPOLOGY` (permanent: "this campaign budgets at the ad-set level; v1 reallocates campaign-level budgets") - distinct from the transient `CAMPAIGN_BUDGET_UNREADABLE`. v2 ad-set reallocation is out of scope.

### 3.8 Where the structured budget-delta producer lives

`recommendation-sink.ts` is **533 lines** (warn 400, error 600). New L2 siblings mirror the pause family: `budget-reallocation-plan.ts` (pure `assessBudgetDrift` + `computeBudgetDelta`), `riley-budget-dispatch.ts` (`RileyBudgetCandidate` / `RileyBudgetSubmitter` / `buildRileyBudgetCandidate`). >3 new files is the cost of mirroring the proven, layered pause execution family (dispatch, submit-request, submitter, executor), each single-responsibility and under the cap; folding into `recommendation-sink.ts` or `meta-ads-client.ts` breaches `arch:check`.

## 4. File structure

**L1 `@switchboard/schemas`** - Create `execution-receipt.ts` (`ExecutionReceiptSchema`, PR 1B-1.5).

**L2 `@switchboard/ad-optimizer`** - Modify `meta-ads-client.ts` (`getCampaign`, `updateCampaignBudget`, `getAccountDailySpendCents`, PR 1B-1.1); Create `budget-reallocation-plan.ts` (`assessBudgetDrift` PR 1B-1.1, `computeBudgetDelta` PR 1B-1.2), `riley-budget-dispatch.ts` (PR 1B-1.2); Modify `recommendation-sink.ts` (spend delta, PR 1B-1.3), `index.ts`. Consume `blast-radius-contract.ts` (PR 1B-1.5).

**L3 `@switchboard/core`** - Pin `recommendations/act.ts` via tests (PR 1B-1.1). Consume `WorkTrace.executionOutputs` (PR 1B-1.5).

**L4 `packages/db`** - Create `seed/riley-budget-governance.ts` (allow + `require_approval(mandatory)` + default `BlastRadiusContract`, PR 1B-1.2). Schema + migration: new `MetaMutationAttempt` model (lease + replay marker), `PendingActionRecord.executionWorkUnitId` + `executedAt` (PR 1B-1.4).

**L5 `apps/api`** - Create `riley-budget-submit-request.ts`, `bootstrap/riley-budget-submitter.ts`, `services/workflows/riley-budget-execution-workflow.ts` (placeholder PR 1B-1.2, real PR 1B-1.5); Modify `bootstrap/contained-workflows.ts` (register intent + executor + `BlastRadiusContract`).

---

## PR 1B-1.1 - Meta reallocation primitives + drift guard + characterization (the de-risk PR; FULL TDD)

**Layer:** L3 (characterization) + L2 (`meta-ads-client.ts`, new pure plan module). **§12 steps 0-1.** Build now. **No ingress, submitter, executor, live write, or real money.**

**Files:** Test `packages/core/src/recommendations/__tests__/act.test.ts` (extend); Test+Modify `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts`, `packages/ad-optimizer/src/meta-ads-client.ts`; Create `packages/ad-optimizer/src/budget-reallocation-plan.ts` + `__tests__/budget-reallocation-plan.test.ts`; Modify `index.ts`.

> **Scope note (review #8):** `getAccountDailySpendCents` is in this PR so all three Meta primitives are de-risked together (isolated, mocked). Move it to PR 1B-1.5 if you'd rather PR 1B-1.1 ship only the two budget methods.

### Step 0 - characterization: act_on_recommendation is money-inert

- [ ] **Step 0.1: Write the test** - extend `act.test.ts`:

```ts
describe("characterization (Spec-1B step 0): act_on_recommendation is money-inert", () => {
  // PIN: actOnRecommendation(store, input) takes ONLY a RecommendationStore - no Meta/ads/budget
  // client in scope, so acting on ANY recommendation can only flip status. The Spec-1B reallocation
  // is a SEPARATE governed intent (adoptimizer.campaign.reallocate), never an extension of this path
  // (spec section 11). If this test ever needs a Meta spy to stay green, money leaked into this path.
  it("acting 'primary' on a budget-move recommendation only flips status to acted", async () => {
    const store = createInMemoryRecommendationStore();
    await emitRecommendation(store, {
      orgId: "org-1",
      agentKey: "riley",
      intent: "recommendation.shift_budget_to_source",
      action: "shift_budget_to_source",
      humanSummary: "Shift budget on Lunchtime",
      confidence: 0.9,
      dollarsAtRisk: 50,
      riskLevel: "medium",
      parameters: { from: "ig", to: "fb", fromTrueRoas: "1.2", toTrueRoas: "3.4" },
      presentation: {
        primaryLabel: "Shift budget",
        secondaryLabel: "Wait",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "primary",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("acted");
  });
});
```

- [ ] **Step 0.2: Run** - `pnpm --filter @switchboard/core test act` -> PASS (characterization; stays green as a regression guard). If `emitRecommendation` typing rejects these values, adjust to the nearest valid surface input; the pin is "status flips, nothing else."
- [ ] **Step 0.3: Commit** - `git commit -m "test(core): pin act_on_recommendation as money-inert (spec-1b characterization)"`

### Step 1a - pure drift guard `assessBudgetDrift` (number-only)

- [ ] **Step 1a.1: Failing test** - `budget-reallocation-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assessBudgetDrift } from "../budget-reallocation-plan.js";

describe("assessBudgetDrift (Spec-1B fail-closed-on-drift)", () => {
  it("ok when live equals the frozen 'from'", () => {
    expect(assessBudgetDrift(5000, 5000)).toEqual({ ok: true });
  });
  it("BUDGET_DRIFTED when live differs", () => {
    expect(assessBudgetDrift(5000, 6000)).toEqual({ ok: false, reason: "BUDGET_DRIFTED" });
  });
  it("BUDGET_DRIFTED on a non-finite frozen value (defensive NaN-guard)", () => {
    expect(assessBudgetDrift(Number.NaN, 5000)).toEqual({ ok: false, reason: "BUDGET_DRIFTED" });
  });
  it("BUDGET_DRIFTED on a non-finite live value (defensive NaN-guard)", () => {
    expect(assessBudgetDrift(5000, Number.NaN)).toEqual({ ok: false, reason: "BUDGET_DRIFTED" });
  });
});
```

- [ ] **Step 1a.2: Verify fail** -> FAIL.
- [ ] **Step 1a.3: Implement** - `budget-reallocation-plan.ts` (takes two `number`s; the executor maps a `null` read to `UNSUPPORTED_BUDGET_TOPOLOGY`/`CAMPAIGN_BUDGET_UNREADABLE` before calling this, so `null` is never this function's concern; the NaN-guard is a defensive belt):

```ts
/** Pure pre-write guards for the Spec-1B reallocation. Layer 2 (imports nothing). The executor
 *  (apps/api, L5) composes these with the live Meta re-read and the blast-radius cap (spec §7). */
export type BudgetDriftVerdict = { ok: true } | { ok: false; reason: "BUDGET_DRIFTED" };

/** Fail-closed drift check. The human approved an exact "fromCents -> toCents"; at execution the
 *  executor re-reads the LIVE budget. live != frozen "from" -> refuse (the world moved). NaN-guarded
 *  defensively; the executor guarantees finite inputs, having mapped null/unreadable upstream. */
export function assessBudgetDrift(frozenFromCents: number, liveCents: number): BudgetDriftVerdict {
  if (!Number.isFinite(frozenFromCents) || !Number.isFinite(liveCents)) {
    return { ok: false, reason: "BUDGET_DRIFTED" };
  }
  if (liveCents !== frozenFromCents) return { ok: false, reason: "BUDGET_DRIFTED" };
  return { ok: true };
}
```

- [ ] **Step 1a.4: Verify pass + export + commit** - `git commit -m "feat(ad-optimizer): pure budget-drift guard for spec-1b reallocation"`

### Step 1b - `MetaAdsClient.getCampaign` (strict cents read)

- [ ] **Step 1b.1: Failing tests** - extend `meta-ads-client.test.ts` (reuse `fetchSpy`/`BASE_URL`):

```ts
describe("getCampaign (Spec-1B reallocation read-modify-re-read)", () => {
  it("reads daily_budget as CENTS verbatim (native minor units; NO x100) + status + name", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "camp_1",
          name: "Lunchtime",
          status: "ACTIVE",
          daily_budget: "5000",
        }),
    });
    expect(await client.getCampaign("camp_1")).toEqual({
      campaignId: "camp_1",
      name: "Lunchtime",
      status: "ACTIVE",
      dailyBudgetCents: 5000,
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/camp_1?fields=id,name,status,daily_budget`,
    );
  });
  it("dailyBudgetCents:null when daily_budget is absent (ABO -> UNSUPPORTED_BUDGET_TOPOLOGY upstream)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE" }),
    });
    expect((await client.getCampaign("camp_1")).dailyBudgetCents).toBeNull();
  });
  it("dailyBudgetCents:null on a non-numeric daily_budget (strict parse, never coerces '5000abc' to 5000)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE", daily_budget: "5000abc" }),
    });
    expect((await client.getCampaign("camp_1")).dailyBudgetCents).toBeNull();
  });
  it("dailyBudgetCents:null on zero/blank (zero is not a valid live daily budget)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE", daily_budget: "0" }),
    });
    expect((await client.getCampaign("camp_1")).dailyBudgetCents).toBeNull();
  });
  it("THROWS on a Meta error (load-bearing; executor maps to CAMPAIGN_BUDGET_UNREADABLE)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: "bad campaign", type: "x", code: 100 } }),
    });
    await expect(client.getCampaign("camp_1")).rejects.toThrow(
      "Meta API error (400): bad campaign",
    );
  });
});
```

- [ ] **Step 1b.2: Verify fail** -> FAIL.
- [ ] **Step 1b.3: Implement** (strict digit parse, honest-null on absent/non-numeric/zero, throw on Graph error - deliberate contrast with `getCampaignStatus`):

```ts
/** Read one campaign's budget + status for the Spec-1B read-modify-re-read executor (spec §7).
 *  THROWS on a Meta error (unlike getCampaignStatus, which degrades to null): a money move cannot
 *  proceed on an unknown budget. dailyBudgetCents is Meta NATIVE minor units (cents), parsed VERBATIM
 *  (no x100; contrast getAccountDailySpendCents where insights spend is a dollars string). null when
 *  absent (ABO -> executor refuses UNSUPPORTED_BUDGET_TOPOLOGY), non-numeric (strict /^\d+$/, never
 *  coerces "5000abc"), or zero - honest-null, NEVER a coerced 0 (feedback_nan_blind_comparison_gates). */
async getCampaign(campaignId: string): Promise<{ campaignId: string; name: string; status: string; dailyBudgetCents: number | null }> {
  const response = await this.get(`/${campaignId}?fields=id,name,status,daily_budget`);
  const rawStr = response.daily_budget == null ? "" : String(response.daily_budget);
  const parsed = /^\d+$/.test(rawStr) ? Number(rawStr) : Number.NaN;
  const dailyBudgetCents = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  return { campaignId: String(response.id ?? campaignId), name: String(response.name ?? ""), status: String(response.status ?? ""), dailyBudgetCents };
}
```

- [ ] **Step 1b.4: Verify pass + commit** - `git commit -m "feat(ad-optimizer): MetaAdsClient.getCampaign strict cents read (spec-1b)"`

### Step 1c - `MetaAdsClient.getAccountDailySpendCents` (strict dollars->cents)

- [ ] **Step 1c.1: Failing tests**:

```ts
describe("getAccountDailySpendCents (Spec-1B blast-radius denominator)", () => {
  it("reads today's account spend (a DOLLARS string) and converts to CENTS (x100)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ spend: "5000.00" }] }),
    });
    expect(await client.getAccountDailySpendCents()).toBe(500000); // $5000.00 -> 500000 cents (NOT 5000)
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain("/act_123456/insights");
    expect(url).toContain("date_preset=today");
  });
  it("null when no insights row exists (absent -> blast-radius SHARE_CAP fail-closed)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) });
    expect(await client.getAccountDailySpendCents()).toBeNull();
  });
  it("null on a non-numeric spend (strict parse, never coerces '5000abc')", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ spend: "5000abc" }] }),
    });
    expect(await client.getAccountDailySpendCents()).toBeNull();
  });
  it("THROWS on a Meta error (load-bearing; executor maps to ACCOUNT_SPEND_UNREADABLE)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: "nope", type: "x", code: 100 } }),
    });
    await expect(client.getAccountDailySpendCents()).rejects.toThrow("Meta API error (400): nope");
  });
});
```

- [ ] **Step 1c.2: Verify fail** -> FAIL.
- [ ] **Step 1c.3: Implement** (account insights `spend` is a DOLLARS string; strict 2-decimal parse then x100; throw on Graph error; null on absent/non-numeric):

```ts
/** Read the account's current-day spend in CENTS for the blast-radius share-cap denominator (spec
 *  §8a). Account insights `spend` is a DOLLARS string (e.g. "5000.00") -> Math.round(x*100): the UNIT
 *  ASYMMETRY vs getCampaign (native cents). Window = today (intra-day partial spend under-states the
 *  denominator -> a LARGER share -> a MORE conservative cap; the safe direction). THROWS on a Meta
 *  error (load-bearing); null on an absent/non-numeric spend (assertWithinBlastRadius fails closed
 *  SHARE_CAP on a null/non-positive denominator). Strict parse, never coerces "5000abc". */
async getAccountDailySpendCents(): Promise<number | null> {
  const response = await this.get(`/${this.accountId}/insights?date_preset=today&fields=spend`);
  const row = (response.data as Record<string, unknown>[] | undefined)?.[0];
  if (!row) return null;
  const raw = String(row.spend ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
```

- [ ] **Step 1c.4: Verify pass + commit** - `git commit -m "feat(ad-optimizer): MetaAdsClient.getAccountDailySpendCents for blast-radius denominator (spec-1b)"`

### Step 1d - `MetaAdsClient.updateCampaignBudget` (safe-integer single write)

- [ ] **Step 1d.1: Failing tests**:

```ts
describe("updateCampaignBudget (Spec-1B reallocation write)", () => {
  it("POSTs daily_budget in CENTS verbatim (no x100, no division)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
    await client.updateCampaignBudget("camp_1", 5000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${BASE_URL}/camp_1`);
    expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      daily_budget: 5000,
    });
  });
  it("allows a budget edit on an ACTIVE campaign (only status->ACTIVE is forbidden)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
    await expect(client.updateCampaignBudget("camp_active", 3000)).resolves.toBeUndefined();
  });
  it("REFUSES a non-integer cents value WITHOUT calling Meta", async () => {
    await expect(client.updateCampaignBudget("camp_1", 50.5)).rejects.toThrow(/integer cents/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("REFUSES a non-safe-integer value WITHOUT calling Meta", async () => {
    await expect(
      client.updateCampaignBudget("camp_1", Number.MAX_SAFE_INTEGER + 2),
    ).rejects.toThrow(/integer cents/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("REFUSES a non-positive budget WITHOUT calling Meta", async () => {
    await expect(client.updateCampaignBudget("camp_1", 0)).rejects.toThrow(/positive/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("REFUSES an absurd budget above the sanity ceiling WITHOUT calling Meta (100x-bug tripwire)", async () => {
    await expect(client.updateCampaignBudget("camp_1", 1_000_000_01)).rejects.toThrow(
      /sanity ceiling/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("THROWS on a Meta error (executor marks the attempt recovery_required)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: "budget too low", type: "x", code: 100 } }),
    });
    await expect(client.updateCampaignBudget("camp_1", 100)).rejects.toThrow(
      "Meta API error (400): budget too low",
    );
  });
});
```

- [ ] **Step 1d.2: Verify fail** -> FAIL.
- [ ] **Step 1d.3: Implement** (`Number.isSafeInteger`, positive, sanity ceiling, all refused before any fetch):

```ts
/** Defense-in-depth: a daily budget above $1,000,000/day is a bug, not a campaign. The real cap is
 *  the blast-radius contract; this only catches a runaway 100x/encoding bug. */
const MAX_SANE_DAILY_BUDGET_CENTS = 1_000_000_00;

/** Set one campaign's daily budget (Spec-1B). CENTS (Meta native minor units; passed VERBATIM - no
 *  normalization; dollars happen only at the spend gate + trueRoas, §3.5/§11). A single POST, no
 *  internal idempotency map (fresh client per call - idempotency is the executor's durable job).
 *  Refuses a malformed amount BEFORE any fetch (the 100x guard): safe-integer, positive, under the
 *  ceiling. Budget edits ARE allowed on ACTIVE campaigns (only status->ACTIVE is forbidden). */
async updateCampaignBudget(campaignId: string, dailyBudgetCents: number): Promise<void> {
  if (!Number.isSafeInteger(dailyBudgetCents)) {
    throw new Error(`SAFETY: daily budget must be a safe integer cents value, got ${dailyBudgetCents}`);
  }
  if (dailyBudgetCents <= 0) throw new Error(`SAFETY: daily budget must be positive cents, got ${dailyBudgetCents}`);
  if (dailyBudgetCents > MAX_SANE_DAILY_BUDGET_CENTS) {
    throw new Error(`SAFETY: daily budget ${dailyBudgetCents} exceeds the sanity ceiling ${MAX_SANE_DAILY_BUDGET_CENTS}`);
  }
  await this.post(`/${campaignId}`, { daily_budget: dailyBudgetCents });
}
```

- [ ] **Step 1d.4: Verify pass.**
- [ ] **Step 1d.5: Full gate** - `pnpm --filter @switchboard/ad-optimizer test` (full), `pnpm typecheck`, `pnpm --filter @switchboard/ad-optimizer build`, `pnpm eval:riley` (stays 28/28), `pnpm format:check`, `pnpm arch:check`, `CI=1 npx tsx scripts/local-verify-fast.ts`.
- [ ] **Step 1d.6: Commit** - `git commit -m "feat(ad-optimizer): MetaAdsClient.updateCampaignBudget safe-integer write (spec-1b)"`

**Acceptance (PR 1B-1.1):** `act_on_recommendation` pinned money-inert; `getCampaign` reads cents verbatim (strict parse), throws on error, honest-null on absent/non-numeric/zero; `getAccountDailySpendCents` converts the dollars-string spend to cents (strict parse, asymmetry pinned); `updateCampaignBudget` writes cents verbatim, refuses malformed/absurd before any fetch; `assessBudgetDrift` refuses on any value mismatch or non-finite. **No production caller yet** - dormant until PR 1B-1.5. Both Meta unit boundaries pinned; the dollars-at-trueRoas boundary is pinned in PR 1B-2.

---

## PR 1B-1.2 - Submitter scaffold + seeded policy + FAIL-CLOSED placeholder executor (DESIGN ALTITUDE; WTP-gated)

**Layer:** L2 producer/dispatch + L5 submit-request/submitter/executor + L4 seed. **§12 step 2.** Prove the L2 -> L5 -> L3 path compiles, respects layers, and **parks** - with a placeholder executor that **fails closed, never returns `completed`** (finding #1: a completed placeholder becomes the cached terminal WorkTrace and poisons the real executor's replay).

**What ships:**

- `budget-reallocation-plan.ts`: `computeBudgetDelta(currentCents, proposedCents) -> { deltaCentsSigned, deltaCentsMagnitude }` (pure, NaN-guarded, §3.5).
- `riley-budget-dispatch.ts`: `RileyBudgetCandidate { organizationId, deploymentId, adAccountId, recommendationId, campaignId, currentDailyBudgetCents, proposedDailyBudgetCents, rationale, evidence }` (**`adAccountId` included**, finding #3, sourced from Riley's resolved meta-ads connection), `RileyBudgetSubmitter`, `buildRileyBudgetCandidate(...)` - the mirror of `buildRileyPauseCandidate`.
- `riley-budget-submit-request.ts`: `RILEY_REALLOCATE_INTENT = "adoptimizer.campaign.reallocate"`, `buildRileyBudgetSubmitRequest(input, deployment)` - seeded `{id:"system",type:"system"}` principal VERBATIM, `submitIdempotencyKey: \`mutate:riley:${recommendationId}:reallocate\``, `targetHint`with Riley's deployment, **frozen parameters`{recommendationId, actionType:"shift_budget_to_source", adAccountId, campaignId, fromCents, toCents, rationale, evidence}`** (the `bindingHash`-bound payload, now carrying `adAccountId`). Null on abstention.
- `riley-budget-submitter.ts`: `buildRileyBudgetSubmitter(deps)` - the `riley-pause-submitter.ts` branch order VERBATIM (null; `!ok` entitlement skip/loud error; **`"approvalRequired" in res` before reading the result**; `outcome:"failed"` deny; else loud).
- `riley-budget-execution-workflow.ts`: a **fail-closed placeholder** - validates the approved lifecycle (`getApprovalState`) and returns `outcome:"failed"` `EXECUTOR_NOT_WIRED`, **never `completed`, never a Meta call**. No terminal `completed` lifecycle can be cached/replayed as phantom success.
- `contained-workflows.ts`: register `adoptimizer.campaign.reallocate` (`workflow`, `write`, NOT `system_auto_approved`), wire the placeholder, attach the `BlastRadiusContract`.
- `riley-budget-governance.ts`: seed allow + `require_approval(mandatory)` (`^adoptimizer\.campaign\.reallocate$`) transactionally (D5-2c pattern) + the default `BlastRadiusContract`.

**Tests:** `computeBudgetDelta` sign+magnitude matrix; `buildRileyBudgetSubmitRequest` principal + key shape + `adAccountId` in the frozen params + null-on-abstention + convention-parity vs the live pause/handoff builders; `buildRileyBudgetSubmitter` all five arms (typed spy args); gate parks a reallocate under the seeded mandatory policy (real `GovernanceGate`, shared seed module); **placeholder returns `failed`/`EXECUTOR_NOT_WIRED`, `updateCampaignBudget` spy never called, no `completed`**.

**Acceptance:** an approved-shape reallocate parks then fails-closed-loudly; the L2 -> L5 -> L3 path compiles with ad-optimizer importing no core/db/UI.

---

## PR 1B-1.3 - Structured spend delta into the gate, units frozen (DESIGN ALTITUDE; WTP-gated)

**Layer:** L2 (`recommendation-sink.ts` additive). **§12 step 3.** Make the structured delta visible to the spend gate (`feedback_safety_gate_needs_producer_population`), field/unit/sign **frozen** per §3.5.

**What ships:** when a reallocation candidate exists, thread `spendAmount = deltaCentsMagnitude / 100` (positive **dollars** magnitude) into the emit payload. Today `recommendation-sink.ts:441-451` omits `spendAmount`; this supplies the real one so D9-2 and the threshold size the move. Keep additive/under 400 lines or extract a `budget-delta-emit.ts` helper.

**Tests:** a reallocate emission carries `spendAmount` in dollars magnitude (5000->8000 -> `30`; 8000->5000 -> `30`, never `-30`); `extractSpendAmount` returns it (not 0); a non-reallocate emission is byte-unchanged.

**Acceptance:** an auto-approved reallocate can never skip the spend gate; a decrease sizes identically to an increase; non-reallocate emissions unchanged.

---

## PR 1B-1.4 - Schema: ledger re-key off executedAt + MetaMutationAttempt (DESIGN ALTITUDE; WTP-gated) - BEFORE the real executor

**Layer:** L4 schema + the outcome-ledger reader. **§12 step 5 pulled EARLIER (finding #5)** plus the durable marker/lease table the executor needs. The "only executed moves are scored" invariant AND the at-most-once marker must exist **before** any real money move.

**What ships:**

- Migration: `PendingActionRecord.executionWorkUnitId String?` + `executedAt DateTime?` + `@@index([organizationId, status, executedAt])` (index name <= 63 chars); populate `RecommendationOutcome.executableWorkUnitId`.
- New model `MetaMutationAttempt` (the §3.1/§3.3 marker + lease): `id` (metaMutationAttemptId), `organizationId`, `adAccountId`, `campaignId`, `executionWorkUnitId @unique`, `status` (`pending|applied|recovery_required`), `heldUntil DateTime` (lease TTL), `observedPriorCents Int`, `requestedToCents Int`, `workTraceId`, `createdAt`, `updatedAt`, `@@index([organizationId, adAccountId, campaignId, status, heldUntil])`. The outcome-ledger query gates on `executedAt IS NOT NULL`.
- Hand-write the migration (`migrate diff --script` then `migrate deploy`, `feedback_prisma_migrate_dev_tty`); `pnpm db:check-drift`.

**Tests (mocked Prisma):** a `status='acted'` row with null `executedAt` is **excluded**; a row with a receipt + `executedAt` is **included**; org-scoped via `updateMany` + `count===0` guard. `MetaMutationAttempt` round-trips and the `executionWorkUnitId` unique rejects a duplicate.

**Acceptance:** the ledger scores only executed actions; the durable marker/lease table exists before PR 1B-1.5.

---

## PR 1B-1.5 - Real read-modify-re-read executor: lease + replay-first + cap + receipt (DESIGN ALTITUDE; WTP-gated; riskiest)

**Layer:** L5 executor consuming L2 client + L2 contract + L1 receipt + L4 `MetaMutationAttempt`. **§12 step 4 + the review-hardened safety model.** Replace the placeholder with the real, fully guarded write following the §3.4 order exactly.

**Tests (the §13 matrix + the review-hardened cases):**

- happy path: post-change budget == requested; one `updateCampaignBudget` call; receipt persisted with audit ids + signed delta; marker `applied`; lease released; `executedAt` stamped.
- **replay-first (finding #2):** an existing receipt -> 0 `updateCampaignBudget` calls (drift never reached even though live == `toCents` != `fromCents`); a `recovery_required` marker -> `MUTATION_RECOVERY_REQUIRED`, 0 calls.
- **committed marker before the call (finding #1):** the `pending` marker is committed (own transaction) before `updateCampaignBudget`; simulate a throw AFTER the write -> marker is `recovery_required` (durable), a subsequent replay returns `MUTATION_RECOVERY_REQUIRED`, 0 second calls.
- **no marker on a clean pre-write failure (finding #2):** `BUDGET_DRIFTED`/`DELTA_CAP`/`UNSUPPORTED_BUDGET_TOPOLOGY`/`*_UNREADABLE` -> no marker written (a corrected re-proposal is not poisoned), no write, no receipt.
- **lease contention (finding #4):** a second executor on the same campaign while a live lease is held -> `LEASE_CONTENDED` retryable, **returns (does not hang)**, no write; after the first releases + a replay, the second sees the applied state and makes no second write.
- blast-radius over-cap -> `DELTA_CAP`/`SHARE_CAP`, no marker, no write.
- `POST_WRITE_MISMATCH`: re-read != requested -> marker `recovery_required`, no receipt.
- frozen-payload binding: a parameter (incl. `adAccountId`) mutated after approval fails `bindingHash` (no write).
- NaN/zero account spend -> `SHARE_CAP` fail-closed.

**Producer -> consumer seams:** executor `deltaCentsSigned` -> `assertWithinBlastRadius` (the §8a seam); `ExecutionReceipt` producer -> `ExecutionReceiptSchema.safeParse` (L1) -> `executionOutputs`.

**Acceptance:** an approved reallocation changes the Meta budget **exactly once**, serialized per campaign by a TTL'd lease, with the attempt marker committed before the call; every clean fail-closed path writes no marker/receipt; every ambiguous path leaves a `recovery_required` marker that blocks auto-replay; replay is a true no-op; cents never become dollars in the executor.

---

## PR 1B-2 - Wire PAID value into the reallocation input (DESIGN ALTITUDE; WTP-gated)

**Layer:** L4 store query + L2 analyzer. **§10 item 8.** `queryPaidValueCentsByCampaign` (cents; absent campaign **absent from the map**, never 0; sums only `verified purchased > 0`); prefer it for `trueRoas` with booked as a labeled fallback. **The dollars unit boundary** (§11): cents -> dollars exactly **once** at `trueRoas`.

**Tests:** the §13 paid-input test; **the dollars unit-boundary hard test** - `50000` cents / `$100` -> `5.0x`, not 500x (the dollars-side companion to PR 1B-1.1's cents-side pins).

**Acceptance:** Riley's math prefers verified paid value; the cents-to-dollars boundary is converted exactly once and pinned.

---

## PR 1B-3 (optional, parallel) - Weekly paid-attribution projection (DESIGN ALTITUDE; WTP-gated)

**Layer:** L3/L5 cron. **§10 item 9.** Durable `WeeklyPaidAttribution` cron (clone `creative-attribution.ts`), external-timestamp-windowed, origin-filtered, count-level drift check, kill-switch default off. **Defer if 1A-6's read-time query suffices.** New env flag -> allowlist.

---

## 5. Revised PR order

1. **1B-1.1** - Meta primitives + drift guard + characterization (build now).
2. **1B-1.2** - submitter + dispatch (+ `adAccountId`) + seeded policy + **fail-closed placeholder** (never `completed`).
3. **1B-1.3** - structured spend delta, **frozen** dollars-magnitude units.
4. **1B-1.4** - ledger re-key + `MetaMutationAttempt` schema **before** any real write.
5. **1B-1.5** - real executor: lease + replay-first + committed marker + drift + cap + write + re-read + receipt + recovery on ambiguity.
6. **1B-2** - paid value + trueRoas dollars-once.
7. **1B-3** - optional weekly projection.

## 6. Producer -> consumer seams (integration review)

Pin each with `ConsumerSchema.safeParse(producerOutput)` from the **real producer default**:

1. `buildRileyBudgetCandidate` (incl. `adAccountId`) -> `buildRileyBudgetSubmitRequest`.
2. seeded `^adoptimizer\.campaign\.reallocate$` -> `GovernanceGate.evaluate` (parks; D9-2 sees the amount).
3. `computeBudgetDelta.deltaCentsMagnitude` -> `spendAmount` dollars -> `extractSpendAmount` -> `applySpendApprovalThreshold`.
4. executor `deltaCentsSigned` -> `assertWithinBlastRadius` (the §8a seam).
5. `ExecutionReceipt` producer -> `ExecutionReceiptSchema` (L1) -> `WorkTrace.executionOutputs` round-trip.
6. `queryPaidValueCentsByCampaign` (cents) -> `trueRoas` (dollars once) - the 100x boundary, both directions pinned.
7. `submitIdempotencyKey` -> `PlatformIngress.submit` dedup; `executionWorkUnitId` -> marker/receipt replay - a re-submit returns the cached terminal WorkTrace, and the executor makes no second Meta write.

## 7. Guardrails (subset of overview §6)

- **ad-optimizer stays L2** - no core/db/UI import; the executor is apps/api (`feedback_surface_agnostic_backend`).
- **Financial intents `require_approval`, never `system_auto_approved`** - do not weaken D9-2.
- **NaN-guard every external Meta numeric**; honest-null, never coerced 0, on a sizing read.
- **Cents end-to-end; dollars once per consumer boundary**; pin both unit boundaries AND the budget/spend asymmetry with hard tests.
- **External money write is at-most-once:** durable `pending` marker **committed before** the call (no open transaction spans the call), `recovery_required` on ambiguity, replay-first; **serialized per campaign** by a TTL'd try-acquire lease (never a `pg_advisory_xact_lock` across the HTTP call).
- **New `submit()` site branches on `"approvalRequired" in response` before destructuring**; cron/system submits use the seeded `{id:"system",type:"system"}` principal.
- **Schema change in the same commit**, hand-written migration, `pnpm db:check-drift`, index names <= 63 chars; store mutations org-scoped via `updateMany`/`deleteMany` + `count===0` guard.
- **Tests:** co-located; mock Prisma; type spy args; run `--filter ad-optimizer test` AND `--filter api test` when an app spy is touched; `pnpm eval:riley` stays green (no engine change in 1B-1.1).
- **Hygiene:** ESM `.js` extensions; no `console.log`; no `any`; `pnpm format:check`; `pnpm arch:check`; lowercase conventional-commit subjects; 600/400 file size. **No em-dashes** anywhere.

## 8. Self-review (per writing-plans)

- **Spec coverage:** §7 read-modify-re-read + receipt -> 1B-1.5; §8 supervised-approval -> 1B-1.2 + 1B-1.5; §8a blast-radius -> 1B-1.5; §10 1B-1 -> 1B-1.1..1.5; 1B-2 -> PR 1B-2; 1B-3 -> PR 1B-3; §11 cents/dollars -> 1B-1.1 (cents boundaries) + 1B-1.3 (gate dollars) + 1B-2 (trueRoas dollars); §12 steps 0-5 -> 1B-1.1 (0-1), 1B-1.2 (2), 1B-1.3 (3), 1B-1.5 (4), 1B-1.4 (5, pulled earlier); §13 matrix -> 1B-1.5 + 1B-2.
- **Type/name consistency:** `assessBudgetDrift(frozenFromCents:number, liveCents:number)`, `computeBudgetDelta -> {deltaCentsSigned, deltaCentsMagnitude}`, `getCampaign -> {campaignId,name,status,dailyBudgetCents}`, `getAccountDailySpendCents -> number|null`, `updateCampaignBudget(campaignId, dailyBudgetCents)`, `assertWithinBlastRadius(contract, deltaCentsSigned, accountDailySpendCents)`, `ExecutionReceiptSchema` (PositiveSafeCents), the three keys (`submitIdempotencyKey`, `executionWorkUnitId`, `metaMutationAttemptId`), and `adAccountId` (candidate -> frozen params -> lease key -> account read -> receipt) are consistent across PRs.
- **Open risks for execution:** finalize the `MetaMutationAttempt` conditional-claim SQL (raw `INSERT ... WHERE NOT EXISTS (active lease)`, mirroring `prisma-booking-store.ts`'s raw discipline; verify no open transaction spans the Meta call); confirm `WorkTrace.executionOutputs` read/write API; confirm `extractSpendAmount` reads `spendAmount` as dollars (verified) and that the autonomy threshold abs's (producer emits magnitude regardless); confirm `adAccountId` is resolvable on Riley's meta-ads connection at candidate-build time; coordinate the seeded policy with Tier 0 `provisionOrgAgents`.

## 9. Branch / PR note

Per `CLAUDE.md` branch doctrine, **this plan lands on `main` via its own focused docs PR**. PR 1B-1.1 is a separate PR off updated `main`, in `.claude/worktrees/spec1b-act-leg`. PRs 1B-1.2 through 1B-3 are WTP-gated and do not start until the Spec-1A demo runs and the act leg is committed.
