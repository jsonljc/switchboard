# Tier 5 - "Spec-1B prerequisites" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`2026-06-10-riley-remediation-00-overview.md`](./2026-06-10-riley-remediation-00-overview.md) first for the shared guardrails, the answered open decisions (especially decision #4), and the cross-slice integration review - they are not repeated here.

**Goal:** Put the three structural guards in place that the act-leg will lean on, _before_ the act-leg grows. The audit found Riley's execution template safe today **only because it is human-gated and tiny**: a pause carries no `spendAmount`, the human gate is one mandatory policy, and the only self-executed class is fully reversible. Spec-1B multiplies every one of those thin spots (a budget reallocation carries dollars, runs more often, and is the first money move). This tier hardens the three load-bearing assumptions so autonomy cannot quietly outrun them.

**This tier is INDEPENDENT of Tier 0-4 code.** It is pure governance + executor + spec work; start it immediately in a parallel worktree (overview §5, Worktree C). It does _not_ block the pilot; it blocks **Spec-1B**.

**Architecture:** Three orthogonal guards, smallest-first. (1) A structural financial-intent guard inside the `system_auto_approved` short-circuit so a future auto-approved financial intent can never skip the spend gate (one `if`). (2) Defense-in-depth around the human pause gate: a last-mile approved-lifecycle check in the executor, a DELETE-route guard that refuses to orphan an allow policy, and a transactional allow+approval seed. (3) A real **blast-radius contract** (enforced dollar/share caps + monitored guardrails + automated rollback) for the act class, with the Spec-1B strategy spec amended to make that contract an explicit entry criterion.

**Tech Stack:** TypeScript, `@switchboard/core` (GovernanceGate, WorkTraceStore), `@switchboard/ad-optimizer` (action-contract, executor seam), Fastify (apps/api policies route), Prisma (`packages/db`), Vitest. No new env vars.

---

## Spec-1B entry-criteria gate

**This is the explicit gate (overview decision #4): no Spec-1B implementation PR merges until all three of the following are green on `main`.**

- [ ] **D9-2** - the `system_auto_approved` short-circuit refuses to short-circuit a financial intent (PR 5.1).
- [ ] **D5-2** - the human pause gate survives a deleted/mis-seeded policy: executor last-mile approved-lifecycle check + DELETE-route orphan guard + transactional allow+approval seed (PR 5.2).
- [ ] **D4-6** - a real blast-radius contract (enforced caps + monitored guardrails + automated rollback) exists and the strategy spec names it as a Spec-1B entry criterion (PR 5.3).

The strategy spec `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md` **already exists** (approved-shape, 2026-06-05; §7/§8/§12 describe the act leg) but it has **no implementation plan on disk** and **lacks the blast-radius contract** - its §7 "blast radius" is the declarative `reversibility`/`rollbackPlan`/`guardrailMetrics` strings this tier replaces with enforced machinery. PR 5.3 amends that spec; the Spec-1B implementation plan that consumes it is written _after_ this tier lands and _after_ the amendment, not here.

**Why these three and not the whole audit:** these are the act-leg's three load-bearing safety assumptions. The pilot does not need them (the pilot pauses, under a human, with no dollar amount). Autonomy does: it removes the human from some decisions (so the financial-intent guard and the caps become the floor) and it deletes-and-reseeds policies at scale (so the policy row stops being trustworthy as the _sole_ gate). Everything else the audit found is sequenced in Tiers 0-4.

---

## Verified findings (this tier)

Status legend matches the overview. All three re-verified at file:line against current `main` on 2026-06-10; the overview table's three "cite drift" corrections are folded in below and confirmed by reading the cited code.

| #                           | Status                       | Pinned location (verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Plan owner |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D9-2                        | CONFIRMED                    | unguarded short-circuit `packages/core/src/platform/governance/governance-gate.ts:97-108`; the only spend-aware logic (`applySpendApprovalThreshold(extractSpendAmount(proposal))`) is **downstream** at `:178-185`; `mutationClass` available on `registration.mutationClass` (`intent-registration.ts:42`); `extractSpendAmount` at `engine/spend-limits.ts:19-25`                                                                                                                               | PR 5.1     |
| D5-2 (a) last-mile          | CONFIRMED                    | executor `apps/api/src/services/workflows/riley-pause-execution-workflow.ts:109-289` checks floor/48h-stale/creds/status but **never reads the WorkTrace/lifecycle** for an approved state; the assumption is a header comment only (`:85-88`, `:104-108`); WorkTrace carries `approvalOutcome`/`approvalRespondedBy` (`packages/core/src/platform/work-trace.ts:26-29`), read via `getByWorkUnitId` (`work-trace-recorder.ts:48`)                                                                 | PR 5.2     |
| D5-2 (b) DELETE guard       | CONFIRMED (cite drift fixed) | the "allow alone EXECUTES" decomposition is pinned at `apps/api/src/__tests__/riley-pause-gate.test.ts:164-168` (the audit MIS-cited `contained-workflows.ts:422-438`, which is the prod intent table where `approvalPolicy` is **decorative** - comment confirms at `:428-429`); `DELETE /api/policies/:id` (`apps/api/src/routes/policies.ts:163-205`) deletes by id with only `requireRole` + `assertOrgAccess`, **no `effect`/orphan check**                                                   | PR 5.2     |
| D5-2 (c) transactional seed | CONFIRMED                    | seed builders `packages/db/src/seed/riley-pause-governance.ts:42-87` (allow + mandatory approval, identical `^adoptimizer\.campaign\.pause$` rule); seeded non-transactionally today; **coordinate with Tier 0 PR 0.3's `provisionOrgAgents` seeder**                                                                                                                                                                                                                                              | PR 5.2     |
| D4-6                        | CONFIRMED (cite drift fixed) | `packages/ad-optimizer/src/action-contract.ts:145-178`: `reversibility`/`rollbackPlan`/`successMetric`/`guardrailMetrics` are all **declarative strings** (the audit's "`:150-157`" is the `PhaseCExecutionContract` interface; the populated `pause` seam is `:168-177`, `guardrailMetrics` prose at `:173-176`); executor only **copies** them into outputs (`riley-pause-execution-workflow.ts:282-284`, "recorded, not auto-monitored" `:106-107`). No dollar/share cap, no automated rollback | PR 5.3     |

**Cross-tier dependency (load-bearing):** D5-2's last-mile check **depends on Tier 2's D5-3/D4-1 idempotent-replay fix**. The platform-ingress replay path reconstructs a `SubmitWorkResponse` from a cached terminal WorkTrace but **does not re-emit `approvalRequired`** (`packages/core/src/platform/platform-ingress.ts:150-177` builds the result/workUnit with no approval marker). If the executor's last-mile check reads "was this approved?" from a replayed dispatch whose approval provenance was dropped, its sibling alarm cries wolf on a legitimate replay. Tier 2 reconstructs the park-truth marker; PR 5.2 reads the durable `WorkTrace.approvalOutcome`/`approvalRespondedBy` (which the replay path does _not_ touch, so the dependency is "Tier 2 keeps the marker honest," not "PR 5.2 is blocked on Tier 2"). Sequence PR 5.2 after Tier 2 D5-3/D4-1 lands, and pin the interaction in the integration review.

---

## File structure (what each PR creates/modifies)

- **PR 5.1** - `packages/core/src/platform/governance/governance-gate.ts` (financial-intent guard inside the short-circuit), `packages/core/src/platform/governance/__tests__/governance-gate-auto-approved-financial.test.ts` (new). Possibly a tiny shared `isFinancialIntent(registration, proposal)` helper co-located in `governance-gate.ts` (no new file unless it earns one - `feedback_audit_blockers_already_done` / ">3 new files needs justification").
- **PR 5.2** - `apps/api/src/services/workflows/riley-pause-execution-workflow.ts` (last-mile check + new `getApprovalState` dep), `apps/api/src/routes/policies.ts:163-205` (DELETE orphan guard), `packages/db/src/seed/riley-pause-governance.ts` + the Tier 0 `provision-org-agents.ts` seeder (transactional seed helper), tests co-located + `apps/api/src/routes/__tests__/policies-delete-guard.test.ts` (new) + `apps/api/src/services/workflows/__tests__/riley-pause-execution-lastmile.test.ts` (extend the existing executor test file if present, else new).
- **PR 5.3** - `packages/ad-optimizer/src/action-contract.ts` (enforced `BlastRadiusContract` type + numeric caps on the act seam), the act-leg executor check site (interface only - the executor itself is Spec-1B), `packages/ad-optimizer/src/__tests__/blast-radius-contract.test.ts` (new), and an amendment to `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md` (new §8a "Blast-radius contract - Spec-1B entry criterion").

---

## PR 5.1 - Structural financial-intent guard in the `system_auto_approved` short-circuit (D9-2)

**Why first:** Smallest, highest-leverage change in the tier - one `if` removes a whole class of future footgun. Today the short-circuit at `governance-gate.ts:100-108` returns `outcome:"execute"` with `riskScore:0` and **no financial guard**; the only spend-aware logic (`applySpendApprovalThreshold` over `extractSpendAmount(proposal)`) runs at `:178`, strictly _downstream_ of that early return. A `system_auto_approved` financial intent therefore never reaches the spend gate. This is avoided **today only by convention**: every current Riley financial intent is registered `require_approval`, never auto-approved (`contained-workflows.ts:408-438` - the handoff and pause intents are deliberately NOT `system_auto_approved`, and only the non-spending `creative.concept.draft` is). Spec-1B introduces a _reallocation_ intent that the strategy spec (§8, §11) explicitly keeps off `system_auto_approved` - this guard makes that a structural invariant rather than a reviewer's good intention. Repo lesson: `feedback_system_auto_approved_bypasses_spend_gates` (the #931 pattern: the gate short-circuit precedes the spend post-processor).

**Files:**

- Modify: `packages/core/src/platform/governance/governance-gate.ts:97-108`
- Create: `packages/core/src/platform/governance/__tests__/governance-gate-auto-approved-financial.test.ts`

**Design - what "financial intent" means here (two complementary signals, OR'd):**

1. **Spend-carrying:** `registration.mutationClass !== "read"` AND `extractSpendAmount(toActionProposal(workUnit, registration))` is a finite non-zero number. This catches any auto-approved intent that smuggles a `spendAmount`/`amount`/`budgetChange`/`newBudget` (the `SPEND_KEYS` the gate already trusts, `spend-limits.ts:17`).
2. **Allowlisted financial intent:** an explicit, small `FINANCIAL_AUTO_APPROVE_DENYLIST` set of intent prefixes that must never auto-approve even with a zero/absent amount (e.g. `adoptimizer.campaign.reallocate`, `adoptimizer.campaign.scale`, anything matching the ad-optimizer money-move family). This catches a financial intent whose dollar figure lives in a non-`SPEND_KEYS` field the extractor cannot see. Keep the set tiny and comment each entry; it is a belt over the braces, not the primary mechanism.

When either signal fires, the short-circuit **does not** return `execute`; it falls through to the full policy path (which will park or deny under the seeded policy, exactly like a `policy`-mode financial intent). A non-financial `system_auto_approved` intent (the legit Wave-2 operator-direct migrations, the Alex→Mira draft) still short-circuits unchanged.

- [ ] **Step 1: Write the failing test** - `governance-gate-auto-approved-financial.test.ts`. Drive the **real** `GovernanceGate` (not a spy), mirroring `riley-pause-gate.test.ts`'s harness, so the test proves the gate behavior end-to-end.

```ts
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec } from "@switchboard/schemas";

const ORG = "org-acme";

function systemSpec(): IdentitySpec {
  return {
    id: "spec-system",
    principalId: "system",
    organizationId: ORG,
    name: "System",
    description: "Seeded system principal",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function gate(): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => [], // no policies → policy path default-denies
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

function workUnit(parameters: Record<string, unknown>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: "2026-06-06T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: "test.intent",
    parameters,
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace-1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function autoApproved(over: Partial<IntentRegistration> = {}): IntentRegistration {
  return {
    intent: "test.intent",
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: "test.intent" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
    ...over,
  };
}

describe("system_auto_approved financial-intent guard", () => {
  it("a non-financial system_auto_approved intent still executes (short-circuit unchanged)", async () => {
    const decision = await gate().evaluate(workUnit({ note: "draft only" }), autoApproved());
    expect(decision.outcome).toBe("execute");
  });

  it("a system_auto_approved intent carrying a spendAmount does NOT short-circuit to execute", async () => {
    // With no policies, the full policy path default-denies - proving the
    // short-circuit was refused (a bare execute would mean the guard never fired).
    const decision = await gate().evaluate(workUnit({ spendAmount: 250 }), autoApproved());
    expect(decision.outcome).not.toBe("execute");
  });

  it("a money-move intent on the financial denylist does NOT short-circuit, even with no amount", async () => {
    const decision = await gate().evaluate(
      workUnit({ campaignId: "camp_1" }),
      autoApproved({
        intent: "adoptimizer.campaign.reallocate",
        executor: { mode: "workflow", workflowId: "adoptimizer.campaign.reallocate" },
      }),
    );
    expect(decision.outcome).not.toBe("execute");
  });

  it("the same financial intent under a SEEDED require_approval policy parks (the safe end state)", async () => {
    // Belt: prove the fall-through reaches the human gate, not just a deny.
    const deps: GovernanceGateDeps = {
      evaluate,
      resolveIdentity,
      loadPolicies: async () => [
        // a require_approval(mandatory) policy matching the intent's actionType
        {
          id: "p_appr",
          name: "appr",
          description: "",
          organizationId: ORG,
          cartridgeId: null,
          priority: 40,
          active: true,
          rule: {
            conditions: [
              {
                field: "actionType",
                operator: "matches",
                value: "^adoptimizer\\.campaign\\.reallocate$",
              },
            ],
          },
          effect: "require_approval",
          approvalRequirement: "mandatory",
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
        {
          id: "p_allow",
          name: "allow",
          description: "",
          organizationId: ORG,
          cartridgeId: null,
          priority: 50,
          active: true,
          rule: {
            conditions: [
              {
                field: "actionType",
                operator: "matches",
                value: "^adoptimizer\\.campaign\\.reallocate$",
              },
            ],
          },
          effect: "allow",
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
      ],
      loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
      loadCartridge: async () => null,
      getGovernanceProfile: async () => null,
    };
    const decision = await new GovernanceGate(deps).evaluate(
      workUnit({ spendAmount: 250 }),
      autoApproved({
        intent: "adoptimizer.campaign.reallocate",
        executor: { mode: "workflow", workflowId: "adoptimizer.campaign.reallocate" },
      }),
    );
    expect(decision.outcome).toBe("require_approval");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** - `pnpm --filter @switchboard/core test governance-gate-auto-approved-financial` → the spendAmount and denylist cases currently return `execute` (the short-circuit fires unconditionally). FAIL as intended.

- [ ] **Step 3: Implement the guard inside the short-circuit** at `governance-gate.ts:100-108`. Insert a financial check **before** the early return; build the proposal once (the gate already has `toActionProposal` imported as part of the engine path - call it here, or extract the spend read so it is computed once and reused downstream). Keep the comment honest about _why_ this exists.

```ts
// Amendment 1 - system_auto_approved short-circuit.
// Skips the human approval-policy lookup only. Auth, idempotency,
// WorkTrace, audit, and execution dispatch all run unchanged downstream.
if (registration.approvalMode === "system_auto_approved") {
  // D9-2 structural guard: a financial intent must NEVER ride the
  // auto-approve short-circuit (it would bypass the spend gate that runs
  // downstream at applySpendApprovalThreshold). Fall through to the full
  // policy path so the seeded require_approval policy parks it. This makes
  // "financial intents are require_approval, never system_auto_approved" a
  // structural invariant, not a convention (feedback_system_auto_approved_
  // bypasses_spend_gates, #931).
  if (!isFinancialIntent(registration, this.buildProposalForGuard(workUnit, registration))) {
    return {
      outcome: "execute",
      riskScore: 0,
      budgetProfile: "cheap",
      constraints,
      matchedPolicies: [],
    };
  }
  // else: deliberately do not return; continue to the full policy evaluation below.
}
```

```ts
/** Financial-intent test for the auto-approve guard (D9-2). OR of two signals:
 *  (1) spend-carrying: a write/destructive intent whose proposal carries a
 *      finite non-zero amount under the canonical SPEND_KEYS;
 *  (2) an allowlisted money-move intent prefix that must never auto-approve
 *      even with no extractable amount (the dollars may live in a field the
 *      extractor cannot see). Keep the set tiny; each entry is a belt. */
const FINANCIAL_AUTO_APPROVE_DENYLIST = [
  "adoptimizer.campaign.reallocate",
  "adoptimizer.campaign.scale",
  "adoptimizer.campaign.shift_budget_to_source",
] as const;

function isFinancialIntent(registration: IntentRegistration, proposal: ActionProposal): boolean {
  if (FINANCIAL_AUTO_APPROVE_DENYLIST.some((p) => registration.intent.startsWith(p))) return true;
  if (registration.mutationClass === "read") return false;
  const amount = extractSpendAmount(proposal);
  return amount !== null && Number.isFinite(amount) && amount !== 0;
}
```

(`buildProposalForGuard` is `toActionProposal(workUnit, registration)`; if reusing the existing call site, compute the proposal before the short-circuit and pass it both here and to the downstream `evaluate`/`extractSpendAmount` so it is built exactly once. Use `Number.isFinite` per `feedback_NaN-blind comparison gates` - a `NaN` amount must read as "not financial-by-amount," and the denylist still backstops it.)

- [ ] **Step 4: Run tests + typecheck** - `pnpm --filter @switchboard/core test governance-gate-auto-approved-financial` → PASS; `pnpm --filter @switchboard/core test` (the existing governance-gate + spend-threshold suites must stay green - the guard must not perturb the non-financial path); `pnpm typecheck`.

- [ ] **Step 5: Eval gate** - this touches the governance gate, not the recommendation engine, so `evals/riley-recommendation` is unaffected; confirm it still greens in CI (no fixture change needed). Run `pnpm format:check` (CI lint runs prettier).

- [ ] **Step 6: Commit** - `git commit -m "fix(core): refuse the system_auto_approved short-circuit for financial intents"`

**Acceptance:** a `system_auto_approved` intent carrying a spend amount (or on the money-move denylist) falls through to the policy path (parks under a seeded mandatory policy, denies with none) instead of executing; a non-financial `system_auto_approved` intent still executes byte-identically to today. **Removes the future footgun structurally.**

---

## PR 5.2 - Harden the human pause gate (D5-2: last-mile check + DELETE guard + transactional seed)

**Why:** Today the entire human gate over a real Meta pause rests on **one deletable Policy row**. The repo's own test pins the danger: "allow alone EXECUTES" (`riley-pause-gate.test.ts:164-168`) - strip the approval policy and leave the allow policy, and the pause self-executes with no human. Three failure modes lead there: a mis-seeded org (allow seeded, approval not), a partial seed crash (allow committed, approval not), and an admin deleting the approval row through `DELETE /api/policies/:id` (which deletes by id with no `effect` check). This PR adds defense in depth at all three: the executor verifies an approved lifecycle at the last mile (so a missing policy cannot produce a phantom pause), the DELETE route refuses to orphan the allow policy, and the seed writes both rows in one transaction. None of these alone is sufficient - that is the point of layering.

**Files:**

- Modify: `apps/api/src/services/workflows/riley-pause-execution-workflow.ts` (new `getApprovalState` dep + last-mile check), `apps/api/src/routes/policies.ts:163-205` (orphan guard), `packages/db/src/seed/riley-pause-governance.ts` + Tier 0 `packages/db/src/seed/provision-org-agents.ts` (transactional seed helper)
- Create: `apps/api/src/services/workflows/__tests__/riley-pause-execution-lastmile.test.ts`, `apps/api/src/routes/__tests__/policies-delete-guard.test.ts`

### 5.2a - Executor last-mile approved-lifecycle check (full TDD)

The executor's header comment (`:85-88`, `:104-108`) _assumes_ "Runs ONLY after the seeded require_approval(mandatory) policy parked the submit and a human approved it." Make that assumption a runtime assertion. The WorkTrace for this work unit carries `approvalOutcome` (`"approved"|"rejected"|"patched"|"expired"`) and `approvalRespondedBy` (`work-trace.ts:26-29`), readable via `getByWorkUnitId(workUnit.id)`. The executor refuses to write to Meta unless the trace shows an approved (or patched-and-approved) lifecycle.

**Dependency note (load-bearing):** this check reads the **durable WorkTrace** approval fields, which the Tier 2 D5-3/D4-1 idempotent-replay fix keeps honest. The replay path (`platform-ingress.ts:150-177`) reconstructs a `SubmitWorkResponse` without `approvalRequired`; because PR 5.2a reads the persisted trace rather than the replayed response, it is _robust_ to that gap - but Tier 2 must land so the _submitter's_ park-truth marker and this executor's read agree, or the integration-review seam #7 (replayed park → submitter `parked:true`) and this check could disagree on a replay. Sequence 5.2 after Tier 2 D5-3/D4-1; pin the interaction in the integration review.

- [ ] **Step 1: Write the failing test** - `riley-pause-execution-lastmile.test.ts`. Build the executor via `buildRileyPauseExecutionWorkflow` with a fake `getApprovalState` and assert the new approval-state branch. Reuse the existing executor test's fakes (creds resolver returning `{kind:"ok"}`, a status pre-read returning a pausable `ACTIVE`, and a recording `markRecommendationActed`).

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRileyPauseExecutionWorkflow } from "../riley-pause-execution-workflow.js";

function deps(over = {}) {
  const updateCampaignStatus = vi.fn().mockResolvedValue(undefined);
  return {
    updateCampaignStatus,
    base: {
      getDeploymentCredentials: vi
        .fn()
        .mockResolvedValue({ kind: "ok", credentials: { accessToken: "t", accountId: "act_1" } }),
      createAdsClient: () => ({
        updateCampaignStatus,
        getCampaignStatus: vi
          .fn()
          .mockResolvedValue({ status: "ACTIVE", effectiveStatus: "ACTIVE" }),
      }),
      markRecommendationActed: vi.fn().mockResolvedValue({ transitioned: true }),
      now: () => new Date("2026-06-06T01:00:00.000Z"),
      // NEW dep:
      getApprovalState: vi
        .fn()
        .mockResolvedValue({ approvalOutcome: "approved", approvalRespondedBy: "user_owner" }),
      ...over,
    },
  };
}

const workUnit = {
  id: "wu-pause-1",
  organizationId: "org-acme",
  requestedAt: "2026-06-06T00:00:00.000Z",
  deployment: { deploymentId: "dep-riley", skillSlug: "ad-optimizer" },
  parameters: {
    recommendationId: "rec_1",
    campaignId: "camp_1",
    evidence: { clicks: 100, conversions: 10, days: 7 },
  },
} as never;

describe("riley pause executor - last-mile approved-lifecycle check", () => {
  it("writes the pause when the WorkTrace shows an approved lifecycle", async () => {
    const d = deps();
    const result = await buildRileyPauseExecutionWorkflow(d.base).execute(workUnit);
    expect(result.outcome).toBe("completed");
    expect(d.updateCampaignStatus).toHaveBeenCalledWith("camp_1", "PAUSED");
  });

  it("REFUSES to write (fails closed) when the WorkTrace shows no approval", async () => {
    const d = deps({
      getApprovalState: vi
        .fn()
        .mockResolvedValue({ approvalOutcome: undefined, approvalRespondedBy: undefined }),
    });
    const result = await buildRileyPauseExecutionWorkflow(d.base).execute(workUnit);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("PAUSE_NOT_APPROVED");
    expect(d.updateCampaignStatus).not.toHaveBeenCalled(); // never touches Meta
  });

  it("REFUSES to write when the lifecycle was rejected or expired", async () => {
    const d = deps({
      getApprovalState: vi
        .fn()
        .mockResolvedValue({ approvalOutcome: "rejected", approvalRespondedBy: "user_owner" }),
    });
    const result = await buildRileyPauseExecutionWorkflow(d.base).execute(workUnit);
    expect(result.outcome).toBe("failed");
    expect(d.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("accepts a patched-and-approved lifecycle", async () => {
    const d = deps({
      getApprovalState: vi
        .fn()
        .mockResolvedValue({ approvalOutcome: "patched", approvalRespondedBy: "user_owner" }),
    });
    const result = await buildRileyPauseExecutionWorkflow(d.base).execute(workUnit);
    expect(result.outcome).toBe("completed");
    expect(d.updateCampaignStatus).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify fail** - `pnpm --filter @switchboard/api test riley-pause-execution-lastmile` → FAIL: `getApprovalState` is not a dep and no branch enforces approval.

- [ ] **Step 3: Add the dep + the check.** Extend `RileyPauseExecutionDeps` with a REQUIRED (not optional - `feedback_safety_gate_needs_producer_population`: an optional dep lets a future bootstrap forget the wiring and silently recreate the hole) `getApprovalState`:

```ts
/**
 * Last-mile approved-lifecycle check (D5-2a). Reads the canonical WorkTrace for
 * THIS work unit and reports the approval outcome. Defense in depth: the
 * platform parks-then-approves before dispatch, but the entire human gate
 * otherwise rests on one deletable Policy row (riley-pause-gate.test.ts pins
 * "allow alone EXECUTES"). If a policy is mis-seeded, partially seeded, or an
 * admin deletes the approval row, this check is the backstop that keeps Riley
 * from writing an UNAPPROVED pause to Meta. REQUIRED, never optional.
 */
getApprovalState: (args: { organizationId: string; workUnitId: string }) =>
  Promise<{
    approvalOutcome?: "approved" | "rejected" | "patched" | "expired";
    approvalRespondedBy?: string;
  }>;
```

Insert the check **after** the stale-approval cap and **before** credential resolution (fail closed as early as possible, before any decrypt):

```ts
const APPROVED_OUTCOMES = new Set(["approved", "patched"]);
const approval = await deps.getApprovalState({
  organizationId: workUnit.organizationId,
  workUnitId: workUnit.id,
});
if (!approval.approvalOutcome || !APPROVED_OUTCOMES.has(approval.approvalOutcome)) {
  return {
    outcome: "failed",
    summary: "Refusing to pause: no approved lifecycle for this work unit",
    error: {
      code: "PAUSE_NOT_APPROVED",
      message:
        `Work unit ${workUnit.id} reached the pause executor without an approved lifecycle ` +
        `(approvalOutcome=${approval.approvalOutcome ?? "none"}). The approval policy may be ` +
        `missing or was deleted; refusing to write an unapproved pause to Meta.`,
    },
  };
}
```

`outcome:"failed"` (not a silent `completed` skip) so it routes to recovery_required + an operator card - a missing approval is an alarm, not a benign no-op (`feedback_audit_driven_fix_workflow` / the "approve must end in dispatch-or-recovery" rule).

- [ ] **Step 4: Wire `getApprovalState` in bootstrap** - in the executor's construction site (`contained-workflows.ts` where `buildRileyPauseExecutionWorkflow` is wired), pass a closure that calls `workTraceStore.getByWorkUnitId(workUnitId)` and returns `{ approvalOutcome: read.trace.approvalOutcome, approvalRespondedBy: read.trace.approvalRespondedBy }`, with an org-mismatch guard (`read.trace.organizationId === organizationId`, else treat as no approval - never read another tenant's trace). Add a tiny bootstrap test or extend the existing one so the wiring is covered (untyped `vi.fn()` over the new dep would green vitest but red the api build - `feedback_vitest_untyped_fn_breaks_chat_build`; type the spy args).

- [ ] **Step 5: Verify pass + run the executor suite** - `pnpm --filter @switchboard/api test riley-pause-execution` → PASS (the new last-mile test plus the existing executor tests; the existing tests must pass a `getApprovalState` returning `approved`).

### 5.2b - DELETE-route orphan guard (full TDD)

`DELETE /api/policies/:id` (`policies.ts:163-205`) must refuse to delete a `require_approval` policy when an `allow` policy for the **same actionType** would survive - that combination is the "allow alone EXECUTES" footgun. Detect the sibling by comparing the deleted policy's `rule.conditions[].value` (the `actionType` regex) against the org's other active policies. The Riley pause allow/approval rows share the identical rule value `^adoptimizer\.campaign\.pause$` (`riley-pause-governance.ts:33,61`), so the match is exact.

**Route discipline:** `policies.ts` is **already in the route-allowlist** (`.agent/tools/route-allowlist.yaml:72-73`) and already carries `// @route-class: control-plane` (`policies.ts:1`). This change adds logic to an existing allowlisted route - it does **not** require a new allowlist entry - but still re-prove with `CI=1 npx tsx scripts/local-verify-fast.ts` (`feedback_new_mutating_route_needs_route_allowlist`). No store mutation changes (the existing `delete` already uses `deleteMany` org-scoped with a `count===0` guard, `prisma-policy-store.ts:121-131`).

- [ ] **Step 6: Write the failing test** - `policies-delete-guard.test.ts`. Inject app via the existing api test harness with a stub `storageContext.policies` whose `listActive`/`getById` return controllable rows.

```ts
it("409s when deleting a require_approval policy would orphan a matching allow policy", async () => {
  // org has BOTH the pause allow + approval rows; deleting the approval row
  // would leave allow-alone (which executes).
  const res = await app.inject({
    method: "DELETE",
    url: "/api/policies/policy_require_approval_riley_pause_org-a",
    headers: { authorization: "Bearer org_a_admin_key" },
  });
  expect(res.statusCode).toBe(409);
  expect(deleteSpy).not.toHaveBeenCalled();
});

it("allows deleting the require_approval policy when the matching allow is deleted too (or absent)", async () => {
  // only the approval row exists for this actionType → safe to delete
  const res = await app.inject({
    method: "DELETE",
    url: "/api/policies/policy_require_approval_riley_pause_org-a",
    headers: { authorization: "Bearer org_a_admin_key" },
  });
  expect(res.statusCode).toBe(200);
});

it("allows deleting an allow policy that has no matching require_approval sibling", async () => {
  const res = await app.inject({
    method: "DELETE",
    url: "/api/policies/policy_allow_unrelated_org-a",
    headers: { authorization: "Bearer org_a_admin_key" },
  });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 7: Verify fail** - the 409 case currently returns 200 (no orphan check). FAIL.

- [ ] **Step 8: Implement the guard** in `policies.ts` DELETE handler, after `assertOrgAccess` and before `policies.delete(...)`:

```ts
// D5-2b: refuse to orphan an allow policy. Deleting a require_approval policy
// while a matching allow policy survives leaves "allow alone" - which EXECUTES
// the governed action with no human (riley-pause-gate.test.ts:164 pins this).
if (existing.effect === "require_approval") {
  const actionTypes = extractActionTypeMatchers(existing.rule); // rule.conditions[].value where field==="actionType"
  if (actionTypes.length > 0) {
    const siblings = await app.storageContext.policies.listActive({
      organizationId: request.organizationIdFromAuth ?? null,
    });
    const orphanedAllow = siblings.some(
      (p) =>
        p.id !== existing.id &&
        p.effect === "allow" &&
        extractActionTypeMatchers(p.rule).some((v) => actionTypes.includes(v)),
    );
    if (orphanedAllow) {
      return reply.code(409).send({
        error:
          "Refusing to delete: this require_approval policy guards an action whose allow policy " +
          "would survive, leaving the action ungated. Delete the matching allow policy first " +
          "(or both together).",
        statusCode: 409,
      });
    }
  }
}
```

`extractActionTypeMatchers(rule)` walks `rule.conditions` (and `rule.children` recursively) collecting `condition.value` where `condition.field === "actionType"` and `operator` is `matches`/`eq`/`in`. Co-locate it in `policies.ts` (or a tiny `policy-rule-matchers.ts` helper if it earns reuse). Compare on the raw matcher string - exact equality is sufficient for the seeded pairs (identical regex); document that a _different_ regex spelling for the same action is out of scope (the seeded pairs always match byte-for-byte).

- [ ] **Step 9: Verify pass + local-verify-fast** - `pnpm --filter @switchboard/api test policies-delete-guard` → PASS; `CI=1 npx tsx scripts/local-verify-fast.ts` (route gate still green; no new allowlist entry needed).

### 5.2c - Transactional allow+approval seed (design-altitude - coordinate with Tier 0)

This part is **design-altitude, not line-by-line TDD**, because it lands inside Tier 0 PR 0.3's `provisionOrgAgents` seeder (overview decision #1; `feedback_audit_blockers_already_done` - do not reinvent the seeder). The contract: the allow + approval pause policies (and the handoff allow/approval pair) are written **atomically** so a crash between them can never leave allow-alone.

- [ ] **Step 10: Interface** - add a seed helper `seedRileyPausePolicies(tx, orgId)` in `riley-pause-governance.ts` that upserts **both** `buildRileyPauseAllowPolicyInput(orgId)` and `buildRileyPauseApprovalPolicyInput(orgId)` against a transactional client (`Prisma.TransactionClient`), so the caller can wrap them in `prisma.$transaction([...])` (or pass the tx through). Tier 0's `provisionOrgAgents` calls it inside the same transaction it already uses for the deployment + entitlement writes.
- [ ] **Step 11: Acceptance test (in the Tier 0 seeder test)** - extend `provision-org-agents.test.ts`: simulate a failure _after_ the allow upsert (mock the approval upsert to throw) and assert the transaction rolls back so **neither** row persists (no allow-alone). Mock Prisma per `feedback...prisma-workflow-store` style; assert the `$transaction` boundary, not real Postgres.
- [ ] **Test strategy:** the existing `seed-riley-pause-governance.test.ts` already pins the two builders' shapes; add only the transactional-rollback assertion. Do not duplicate the gate decomposition test (`riley-pause-gate.test.ts` owns it).

- [ ] **Step 12: Full test + typecheck + format** - `pnpm --filter @switchboard/api test`, `pnpm --filter @switchboard/db test`, `pnpm typecheck`, `pnpm format:check`. Because this tightens an executor and a route, run `--filter api test` in full (app spies - `feedback_store_tightening_gate_needs_app_tests`). Commit: `git commit -m "fix: harden riley pause gate - executor last-mile check, delete-orphan guard, transactional seed"`

**Acceptance:** the executor fails closed (no Meta write) when no approved lifecycle exists for the work unit; the DELETE route 409s on a delete that would orphan an allow policy; the pause + handoff policy pairs seed transactionally so a partial seed cannot leave allow-alone. **Integration-review seam #1 (seed→gate) + a new last-mile seam: a work unit reaching the executor without an approved WorkTrace fails closed.**

---

## PR 5.3 - Blast-radius contract + Spec-1B spec amendment (D4-6, design-heavy)

**Why:** The execution floor bounds **evidence quality**, not **blast radius**. `action-contract.ts:145-178` defines `reversibility`/`rollbackPlan`/`successMetric`/`guardrailMetrics` as **declarative strings**; the populated `pause` seam's `guardrailMetrics` (`:173-176`) is prose, and the executor only **copies** them into outputs (`riley-pause-execution-workflow.ts:282-284`, explicitly "recorded, not auto-monitored"). There is no dollar cap, no spend-share cap, no automated rollback. That is an acceptable template for a _reversible, human-gated pause that moves no dollars_. It is an **insufficient** template for an autonomous Spec-1B _reallocation that moves real budget_. This PR defines the enforced contract and amends the strategy spec to make it a Spec-1B entry criterion.

**This is design-altitude (interface + acceptance + test strategy), not line-by-line TDD** - the act-leg executor that _consumes_ the contract is Spec-1B's to build; here we ship the enforced **interface** and types, a unit test that the cap check refuses an over-cap delta, and the spec amendment. (Effort: L. The proportional-fidelity rule from the prompt: full TDD for 5.1 and 5.2a/b; design-altitude for 5.2c and all of 5.3.)

**Files:**

- Modify: `packages/ad-optimizer/src/action-contract.ts` (add `BlastRadiusContract` with **enforced numeric** caps; keep the existing declarative `PhaseCExecutionContract` for pause back-compat or fold it in), and define the **executor check interface** (where Spec-1B's executor will assert the cap)
- Create: `packages/ad-optimizer/src/__tests__/blast-radius-contract.test.ts`
- Amend: `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md` (new §8a)

### The contract (three enforced parts)

**(i) Enforced dollar cap + spend-share cap.** Real numeric fields the executor checks and refuses to exceed - not strings. Proposed shape:

```ts
/**
 * Blast-radius contract for a self-/autonomously-executed money move (Spec-1B).
 * Unlike PhaseCExecutionContract (declarative strings, recorded not enforced),
 * EVERY field here is machine-checked by the executor before the platform write.
 * A delta that breaches any cap is refused (fail closed), never clamped silently.
 */
export interface BlastRadiusContract {
  /** Hard ceiling on the absolute dollar delta this action may move, in CENTS
   *  (cents end-to-end per the strategy spec §11; normalized to dollars once at
   *  the gate boundary). The executor refuses a delta whose |amount| exceeds it. */
  maxDeltaCents: number;
  /** Ceiling on the action's share of the account's current daily spend, 0..1.
   *  Refused if (|deltaCents| / accountDailySpendCents) exceeds this. Guards the
   *  "small account, large relative move" case a flat dollar cap misses. */
  maxAccountSpendShare: number;
  /** Guardrail signals the monitor (slice-3 outcome-attribution cron) trips on.
   *  Each carries a machine-comparable threshold, NOT prose - the cron evaluates
   *  it and fires a rollback/alert when breached. */
  guardrails: BlastRadiusGuardrail[];
  /** Automated rollback for the reallocate class: re-set the prior budget on a
   *  tripped guardrail. References the inverse op + the captured prior value. */
  rollback: { kind: "reset_prior_budget"; capturePriorValue: true };
}

export interface BlastRadiusGuardrail {
  metric: "account_booked_conversions_drop_share" | "freed_budget_absorbed_share" | string;
  /** Numeric threshold; NaN-guarded at evaluation (Number.isFinite) so a missing
   *  metric never silently "passes" the comparison (feedback_NaN-blind gates). */
  breachAbove: number;
  windowHours: number;
}
```

**Where the executor checks it** (the enforcement _interface_ Spec-1B implements): the act-leg executor, immediately before the Meta budget write, computes `deltaCents` and `accountDailySpendCents` (it already re-reads the campaign per the strategy spec §7 "read-modify-re-read"), then:

```ts
function assertWithinBlastRadius(
  contract: BlastRadiusContract,
  deltaCents: number,
  accountDailySpendCents: number,
): { ok: true } | { ok: false; reason: "DELTA_CAP" | "SHARE_CAP" } {
  if (!Number.isFinite(deltaCents)) return { ok: false, reason: "DELTA_CAP" };
  if (Math.abs(deltaCents) > contract.maxDeltaCents) return { ok: false, reason: "DELTA_CAP" };
  if (accountDailySpendCents > 0) {
    const share = Math.abs(deltaCents) / accountDailySpendCents;
    if (Number.isFinite(share) && share > contract.maxAccountSpendShare)
      return { ok: false, reason: "SHARE_CAP" };
  }
  return { ok: true };
}
```

A breach is `fail closed` → the executor returns `outcome:"failed"` with the reason (recovery*required + operator card), never a silent clamp. This is the `ad-optimizer` (Layer 2, schemas-only) home for the \_contract + pure check*; the executor that calls it lives in `apps/api` (Layer 5), matching where `meetsRileyPauseExecutionFloor` / `isPhaseCActionClassEligible` already split (`action-contract.ts` predicate vs the apps/api workflow).

**(ii) Monitored guardrails.** Wire the **slice-3 outcome-attribution cron** (`RILEY_OUTCOME_ATTRIBUTION_ENABLED`, the Tier 3 / D9-5 IMPROVE pair) as the _monitor_ that evaluates each `BlastRadiusGuardrail` over its window and **trips** on a breach. Today the guardrails are copied into `WorkTrace.executionOutputs` and read by nobody; the contract makes them the cron's input. (This is a forward reference: the cron's monitoring wiring is Tier 3's to build under Spec-1B; PR 5.3 ships the _typed guardrail_ the cron will consume and the spec criterion that it must.)

**(iii) Automated rollback for the reallocate class.** On a tripped guardrail, re-set the prior budget (`rollback.kind: "reset_prior_budget"`, using the prior value the read-modify-re-read executor already captures). For `pause` the rollback stays human (resume is a human decision; the existing seam already says so) - `reset_prior_budget` is specifically the reallocate-class inverse. The contract field makes "reversible" mean _the machine can and will undo it on breach_, not _a human could in principle_.

- [ ] **Step 1: Failing unit test** - `blast-radius-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertWithinBlastRadius, type BlastRadiusContract } from "../action-contract.js";

const contract: BlastRadiusContract = {
  maxDeltaCents: 50_00, // $50
  maxAccountSpendShare: 0.25,
  guardrails: [{ metric: "freed_budget_absorbed_share", breachAbove: 0.5, windowHours: 72 }],
  rollback: { kind: "reset_prior_budget", capturePriorValue: true },
};

describe("blast-radius cap enforcement", () => {
  it("allows a delta within both caps", () => {
    expect(assertWithinBlastRadius(contract, 30_00, 1000_00)).toEqual({ ok: true });
  });
  it("refuses a delta over the dollar cap", () => {
    expect(assertWithinBlastRadius(contract, 80_00, 1000_00)).toEqual({
      ok: false,
      reason: "DELTA_CAP",
    });
  });
  it("refuses a small-dollar delta that is a large account share", () => {
    // $30 on a $40/day account = 0.75 share > 0.25
    expect(assertWithinBlastRadius(contract, 30_00, 40_00)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });
  it("refuses a NaN delta (fail closed)", () => {
    expect(assertWithinBlastRadius(contract, Number.NaN, 1000_00)).toEqual({
      ok: false,
      reason: "DELTA_CAP",
    });
  });
});
```

- [ ] **Step 2: Verify fail** - `pnpm --filter @switchboard/ad-optimizer test blast-radius-contract` → FAIL (type + function absent).
- [ ] **Step 3: Implement `BlastRadiusContract` + `assertWithinBlastRadius`** in `action-contract.ts` (keep the file under 600/400 lines - it is ~200 today; if adding the contract pushes past the warn line, extract a `blast-radius-contract.ts` sibling, `feedback_arch_check_ts_only`). Do **not** wire it into the live pause executor - pause keeps its declarative seam; the enforced contract ships for Spec-1B's reallocate executor to consume.
- [ ] **Step 4: Verify pass + typecheck + arch:check** - `pnpm --filter @switchboard/ad-optimizer test`, `pnpm typecheck`, `pnpm arch:check`.

### Spec amendment

- [ ] **Step 5: Amend `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md`** - add **§8a "Blast-radius contract (Spec-1B entry criterion)"** after the existing §8 "Supervised-approval model". State:
  - the act-leg reallocation intent MUST carry a `BlastRadiusContract` with enforced `maxDeltaCents` + `maxAccountSpendShare`;
  - the executor MUST call `assertWithinBlastRadius` before the Meta write and fail closed on breach (cross-ref the §7 read-modify-re-read executor and the §13 `BUDGET_DRIFTED` test);
  - guardrails are **machine-comparable thresholds** evaluated by the slice-3 outcome-attribution cron, which trips an automated `reset_prior_budget` rollback on breach;
  - this contract, the D9-2 financial-intent guard, and the D5-2 last-mile/DELETE/transactional hardening are the **three Tier-5 entry criteria** that gate Spec-1B (link this plan and overview decision #4).
  - Note that this **supersedes** the spec's reliance on the declarative `reversibility`/`guardrailMetrics` strings for the act leg (§7's "ExecutionReceipt" stays; the _blast-radius_ fields graduate from prose to enforced).
- [ ] **Step 6: Commit** - `git commit -m "feat(ad-optimizer): enforced blast-radius contract + amend spec-1b entry criteria"` (two commits acceptable: the code change, then the docs amendment, if the branch-relevance hook prefers a docs-only commit - `feedback...check-branch-relevance`).

**Acceptance:** an over-cap (dollar or share) delta is refused by `assertWithinBlastRadius` (fail closed, NaN-guarded); the strategy spec names the enforced blast-radius contract as a Spec-1B entry criterion alongside D9-2 and D5-2. **Integration-review seam (new): Spec-1B's reallocate executor → `assertWithinBlastRadius` (cap refusal pinned by a `ConsumerSchema.safeParse`-style test from the executor's real delta).**

---

## Tier 5 dependencies & sequencing

- **PR 5.1 first** (smallest, fully self-contained core change; no cross-tier dependency). Lands the structural footgun-remover immediately.
- **PR 5.2** after **Tier 2 D5-3/D4-1** (the idempotent-replay park-truth fix) so the executor's last-mile read and the submitter's park marker agree on a replay; 5.2c coordinates with **Tier 0 PR 0.3** (the `provisionOrgAgents` transactional seeder - do not fork it). 5.2a/5.2b are otherwise independent and can be built in parallel with 5.1.
- **PR 5.3** is independent of 5.1/5.2 (it touches `ad-optimizer` + the spec) and can run in parallel; it is the _largest_ and _most design-heavy_, so it can absorb the longest review.
- **Worktree:** this whole tier is overview Worktree C - start now, in parallel with Tiers 0/2. One branch per worktree; re-check `git worktree list` + `gh pr list` before any cross-cutting action (`feedback_concurrent_session_cross_cutting_actions`); three-dot diffs for proofs (`feedback_worktree_shared_refs_three_dot_diff`).
- **Exit criteria for Tier 5 (= the Spec-1B entry gate):** all three checklist items at the top are green on `main`. Only then may a Spec-1B implementation plan be written and its PRs merged (overview decision #4).

## Guardrails this tier specifically must honor (subset of overview §6)

- **Financial intents are `require_approval`, never `system_auto_approved`** - PR 5.1 makes this structural; do not weaken it (`feedback_system_auto_approved_bypasses_spend_gates`).
- **New/changed mutating route** - the DELETE-guard change is to `policies.ts`, **already allowlisted** (`.agent/tools/route-allowlist.yaml:72`) with `// @route-class: control-plane`; no new entry, but re-prove `CI=1 npx tsx scripts/local-verify-fast.ts` (`feedback_new_mutating_route_needs_route_allowlist`).
- **Store mutations org-scoped + `updateMany`/`deleteMany` with `count===0` guard** - the policy `delete` already satisfies this (`prisma-policy-store.ts:121-131`); PR 5.2 adds _route_ logic, no store-mutation change. The executor's last-mile read is org-mismatch-guarded.
- **Tests mock Prisma** (CI has no Postgres); type spy args (untyped `vi.fn` greens vitest but reds the api build - `feedback_vitest_untyped_fn_breaks_chat_build`); run `--filter api test` in full since 5.2 tightens an executor + route (`feedback_store_tightening_gate_needs_app_tests`).
- **NaN-guard external numerics** - both the D9-2 amount check and the D4-6 cap/share checks use `Number.isFinite` so a missing/NaN value fails closed, never passes a comparison (`feedback_NaN-blind comparison gates`).
- **No em-dashes** in any prose, code comment, or the spec amendment (`feedback_no_em_dashes`).
- **File size / arch:check** - `action-contract.ts` is ~200 lines today; extract a sibling if the contract pushes past the 400 warn line; `pnpm arch:check` counts raw `.ts` lines separately from eslint (`feedback_arch_check_ts_only`).

## Self-review (per writing-plans)

- **Spec coverage:** the three Tier-5 findings each map to a PR (D9-2→5.1, D5-2→5.2 with parts a/b/c, D4-6→5.3) and to the entry-criteria checklist at the top; the Spec-1B gate is stated plainly with the strategy-spec status (exists, no impl plan, lacks the contract) per the prompt.
- **Proportional fidelity:** full TDD with real test code for D9-2 (one `if`) and D5-2 parts (a) executor last-mile + (b) DELETE guard (concrete); design-altitude (interface + acceptance + test strategy) for D5-2 (c) transactional seed (Tier 0 coordination) and all of D4-6 (interface + cap-check unit test + spec amendment), as scoped.
- **Citation corrections folded in (verified by reading the code):** (1) the D5-2 "allow alone EXECUTES" assertion is `riley-pause-gate.test.ts:164-168`, NOT `contained-workflows.ts:422-438` (that table's `approvalPolicy` is decorative, comment at `:428-429`); (2) the D4-6 declarative fields' populated seam is `action-contract.ts:168-177` (the interface is `:145-158`), executor copy at `riley-pause-execution-workflow.ts:282-284`; (3) the D9-2 spend logic is genuinely downstream at `governance-gate.ts:178-185` of the `:100-108` short-circuit. No NEW finding-status change discovered - all three CONFIRMED, exactly as the overview table (with its noted cite drifts) records.
- **Cross-tier dependency flagged:** D5-2a depends on Tier 2 D5-3/D4-1 (replay park-truth) and D5-2c on Tier 0 PR 0.3 (transactional seeder); both are stated in the findings table, the PR body, and the sequencing section.
- **Type consistency:** `isFinancialIntent(registration, proposal)`, `getApprovalState({organizationId, workUnitId})`, `BlastRadiusContract`/`assertWithinBlastRadius(contract, deltaCents, accountDailySpendCents)` field names are used consistently across steps.
- **Open risk flagged for execution:** confirm `toActionProposal` is reachable from the gate's short-circuit site without double-building the proposal (PR 5.1 Step 3 - build once, reuse downstream); confirm the executor's bootstrap site has a `WorkTraceStore` in scope to back `getApprovalState` (PR 5.2 Step 4) - both are quick greps at execution time.
