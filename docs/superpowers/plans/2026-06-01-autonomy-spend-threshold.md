# Autonomy Spend Threshold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AgentDeployment.spendApprovalThreshold` a real, enforced governance lever — auto-approve a reversible financial action at/under the threshold for an explicitly-autonomous deployment, park it above, never override a deny.

**Architecture:** A pure post-processor `applySpendApprovalThreshold` runs in `GovernanceGate.evaluate` after `toGovernanceDecision`. It is dormant unless `trustLevelOverride === "autonomous"`. The threshold value reaches the gate via a #644 mapper fix; a single canonical `extractSpendAmount` reads the spend amount; the Riley producer is updated to carry a structured amount. Deny is a fixed point.

**Tech Stack:** TypeScript ESM monorepo, Vitest, pnpm. All tests offline/DB-free.

Spec: `docs/superpowers/specs/2026-06-01-autonomy-spend-threshold-design.md`.

---

### Task 1: Extend `extractSpendAmount`

**Files:**

- Modify: `packages/core/src/engine/spend-limits.ts:10-16`
- Test: `packages/core/src/engine/__tests__/spend-limits.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import type { ActionProposal } from "@switchboard/schemas";
import { extractSpendAmount } from "../spend-limits.js";

function proposal(parameters: Record<string, unknown>): ActionProposal {
  return {
    id: "a1",
    actionType: "x",
    parameters,
    evidence: "t",
    confidence: 1,
    originatingMessageId: "m1",
  };
}

describe("extractSpendAmount", () => {
  it("reads the canonical spendAmount key first", () => {
    expect(extractSpendAmount(proposal({ spendAmount: 120, amount: 5 }))).toBe(120);
  });
  it("falls back amount → budgetChange → newBudget", () => {
    expect(extractSpendAmount(proposal({ amount: 30 }))).toBe(30);
    expect(extractSpendAmount(proposal({ budgetChange: 40 }))).toBe(40);
    expect(extractSpendAmount(proposal({ newBudget: 50 }))).toBe(50);
  });
  it("returns null when no numeric spend field is present", () => {
    expect(extractSpendAmount(proposal({ note: "hi" }))).toBeNull();
    expect(extractSpendAmount(proposal({ amount: "30" }))).toBeNull();
  });
  it("ignores non-finite numbers", () => {
    expect(extractSpendAmount(proposal({ amount: NaN }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @switchboard/core test spend-limits.test.ts`
Expected: FAIL (canonical `spendAmount`/`newBudget` not read; NaN not handled).

- [ ] **Step 3: Implement**

Replace the body of `extractSpendAmount`:

```ts
const SPEND_KEYS = ["spendAmount", "amount", "budgetChange", "newBudget"] as const;

export function extractSpendAmount(proposal: ActionProposal): number | null {
  for (const key of SPEND_KEYS) {
    const v = proposal.parameters[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @switchboard/core test spend-limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine/spend-limits.ts packages/core/src/engine/__tests__/spend-limits.test.ts
git commit -m "feat(core): extend extractSpendAmount to canonical spend keys"
```

---

### Task 2: `applySpendApprovalThreshold` pure helper

**Files:**

- Create: `packages/core/src/platform/governance/spend-approval-threshold.ts`
- Test: `packages/core/src/platform/__tests__/spend-approval-threshold.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";
import { applySpendApprovalThreshold } from "../governance/spend-approval-threshold.js";

const constraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 10,
  maxLlmTurns: 1,
  maxTotalTokens: 0,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 10,
  trustLevel: "autonomous",
};
const approve = (): GovernanceDecision => ({
  outcome: "require_approval",
  riskScore: 10,
  approvalLevel: "standard",
  approvers: [],
  constraints,
  matchedPolicies: ["POLICY_RULE"],
});
const exec = (): GovernanceDecision => ({
  outcome: "execute",
  riskScore: 10,
  budgetProfile: "cheap",
  constraints,
  matchedPolicies: ["POLICY_RULE"],
});
const deny = (): GovernanceDecision => ({
  outcome: "deny",
  reasonCode: "SPEND_LIMIT",
  riskScore: 90,
  matchedPolicies: ["SPEND_LIMIT"],
});
const base = {
  trustLevelOverride: "autonomous" as const,
  threshold: 100,
  spendAmount: 50,
  mutationClass: "write" as const,
  reversibility: "full" as const,
};

describe("applySpendApprovalThreshold", () => {
  it("downgrades a reversible financial require_approval at/under threshold to execute", () => {
    const r = applySpendApprovalThreshold(approve(), base);
    expect(r.outcome).toBe("execute");
    expect(r.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });
  it("parks (escalates execute → require_approval) above threshold", () => {
    const r = applySpendApprovalThreshold(exec(), { ...base, spendAmount: 150 });
    expect(r.outcome).toBe("require_approval");
    expect(r.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });
  it("NEVER touches a deny (under threshold, autonomous)", () => {
    expect(applySpendApprovalThreshold(deny(), base)).toEqual(deny());
  });
  it("does NOT downgrade an irreversible action under threshold", () => {
    expect(
      applySpendApprovalThreshold(approve(), { ...base, mutationClass: "destructive" }).outcome,
    ).toBe("require_approval");
    expect(applySpendApprovalThreshold(approve(), { ...base, reversibility: "none" }).outcome).toBe(
      "require_approval",
    );
  });
  it("is dormant unless trustLevelOverride is autonomous", () => {
    expect(
      applySpendApprovalThreshold(approve(), { ...base, trustLevelOverride: "guided" }),
    ).toEqual(approve());
    expect(
      applySpendApprovalThreshold(approve(), { ...base, trustLevelOverride: undefined }),
    ).toEqual(approve());
  });
  it("is a no-op when no threshold is configured", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, threshold: undefined })).toEqual(
      approve(),
    );
  });
  it("is a no-op for a non-financial action (null amount)", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, spendAmount: null })).toEqual(
      approve(),
    );
  });
  it("uses absolute value (negative budget delta under threshold downgrades)", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, spendAmount: -50 }).outcome).toBe(
      "execute",
    );
  });
  it("treats amount exactly at threshold as under (auto)", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, spendAmount: 100 }).outcome).toBe(
      "execute",
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @switchboard/core test spend-approval-threshold.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

```ts
import type { RiskInput, TrustLevel } from "@switchboard/schemas";
import type { GovernanceDecision } from "../governance-types.js";
import type { MutationClass } from "../types.js";

/** Audit marker appended to matchedPolicies whenever the autonomy threshold acts. */
export const SPEND_APPROVAL_THRESHOLD_MARKER = "SPEND_APPROVAL_THRESHOLD";

export interface SpendApprovalThresholdContext {
  /** Deployment launch posture. The threshold engages ONLY when "autonomous". */
  trustLevelOverride?: TrustLevel;
  /** Per-deployment spendApprovalThreshold (dollars). Undefined ⇒ no-op. */
  threshold?: number;
  /** Action spend amount; null for a non-financial action ⇒ no-op. */
  spendAmount: number | null;
  mutationClass: MutationClass;
  reversibility: RiskInput["reversibility"];
}

/**
 * Post-processes a base GovernanceDecision with the per-deployment spend-approval
 * threshold — the "less-human-in-loop" autonomy lever.
 *
 * Safety properties (pinned by tests): a `deny` is a fixed point; only a
 * reversible financial `require_approval` at/under the threshold under an
 * explicitly-autonomous deployment is relaxed to `execute`; an over-threshold
 * `execute` is escalated to `require_approval` ("asks above $X"); everything else
 * is a no-op. Dormant for every non-autonomous deployment ⇒ default behaviour is
 * byte-identical to before this lever existed.
 */
export function applySpendApprovalThreshold(
  decision: GovernanceDecision,
  ctx: SpendApprovalThresholdContext,
): GovernanceDecision {
  // Opt-in: only an explicitly-autonomous deployment uses the threshold.
  if (ctx.trustLevelOverride !== "autonomous") return decision;
  // Never relax a deny — the compliance/limit floor is independent of autonomy.
  if (decision.outcome === "deny") return decision;
  // No threshold configured.
  if (typeof ctx.threshold !== "number" || !Number.isFinite(ctx.threshold)) return decision;
  // Non-financial action: the threshold only governs spend.
  if (ctx.spendAmount === null || !Number.isFinite(ctx.spendAmount)) return decision;

  const amount = Math.abs(ctx.spendAmount);
  const isReversible = ctx.mutationClass !== "destructive" && ctx.reversibility !== "none";

  if (amount <= ctx.threshold) {
    // Autonomy grant: a reversible financial approval at/under threshold executes
    // without a human. Irreversible stays parked; an execute stays an execute.
    if (decision.outcome === "require_approval" && isReversible) {
      return {
        outcome: "execute",
        riskScore: decision.riskScore,
        budgetProfile:
          decision.riskScore <= 20 ? "cheap" : decision.riskScore <= 60 ? "standard" : "expensive",
        constraints: decision.constraints,
        matchedPolicies: [...decision.matchedPolicies, SPEND_APPROVAL_THRESHOLD_MARKER],
      };
    }
    return decision;
  }

  // amount > threshold ⇒ park. Escalating an execute is the safe direction and
  // delivers the "asks above $X" guarantee; an already-parked decision is unchanged.
  if (decision.outcome === "execute") {
    return {
      outcome: "require_approval",
      riskScore: decision.riskScore,
      approvalLevel: "standard",
      approvers: [],
      constraints: decision.constraints,
      matchedPolicies: [...decision.matchedPolicies, SPEND_APPROVAL_THRESHOLD_MARKER],
    };
  }
  return decision;
}
```

Note: if `TrustLevel` is not exported from `@switchboard/schemas`, import it from
`../../skill-runtime/governance.js` (same source `deployment-context.ts` uses).

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @switchboard/core test spend-approval-threshold.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/governance/spend-approval-threshold.ts packages/core/src/platform/__tests__/spend-approval-threshold.test.ts
git commit -m "feat(core): add applySpendApprovalThreshold autonomy gate helper"
```

---

### Task 3: Wire the helper into `GovernanceGate.evaluate` + gate invariants

**Files:**

- Modify: `packages/core/src/platform/governance/governance-gate.ts:1-21,150-170`
- Test: `packages/core/src/platform/__tests__/governance-gate.test.ts` (extend)

- [ ] **Step 1: Write the failing tests (append to governance-gate.test.ts)**

```ts
describe("GovernanceGate spend-approval threshold", () => {
  const autonomousWorkUnit = (parameters: Record<string, unknown>, threshold = 100) =>
    makeWorkUnit({
      intent: "digital-ads.campaign.adjust_budget",
      parameters,
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "riley",
        trustLevel: "guided",
        trustScore: 42,
        trustLevelOverride: "autonomous",
        policyOverrides: { spendApprovalThreshold: threshold },
      },
    });

  it("downgrades an under-threshold reversible budget approval to execute (autonomous)", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);
    const decision = await gate.evaluate(
      autonomousWorkUnit({ budgetChange: 50 }),
      makeRegistration({ intent: "digital-ads.campaign.adjust_budget", mutationClass: "write" }),
    );
    expect(decision.outcome).toBe("execute");
    expect(decision.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("parks an over-threshold budget action even when the engine would execute", async () => {
    const deps = makeDeps(); // default trace ⇒ execute
    const gate = new GovernanceGate(deps);
    const decision = await gate.evaluate(
      autonomousWorkUnit({ budgetChange: 500 }),
      makeRegistration({ intent: "digital-ads.campaign.adjust_budget", mutationClass: "write" }),
    );
    expect(decision.outcome).toBe("require_approval");
  });

  it("keeps a deny denied under autonomous + under threshold (deny-floor independence)", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(
        makeTrace({
          finalDecision: "deny",
          checks: [
            {
              checkCode: "SPEND_LIMIT",
              checkData: {},
              humanDetail: "limit",
              matched: true,
              effect: "deny",
            },
          ],
        }),
      ),
    });
    const gate = new GovernanceGate(deps);
    const decision = await gate.evaluate(
      autonomousWorkUnit({ budgetChange: 50 }),
      makeRegistration({ intent: "digital-ads.campaign.adjust_budget", mutationClass: "write" }),
    );
    expect(decision.outcome).toBe("deny");
  });

  it("does NOT downgrade an irreversible (destructive) action under threshold", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);
    const decision = await gate.evaluate(
      autonomousWorkUnit({ budgetChange: 50 }),
      makeRegistration({
        intent: "digital-ads.campaign.adjust_budget",
        mutationClass: "destructive",
      }),
    );
    expect(decision.outcome).toBe("require_approval");
  });

  it("is dormant for a guided deployment (byte-identical to today)", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);
    const wu = makeWorkUnit({
      parameters: { budgetChange: 50 },
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "riley",
        trustLevel: "guided",
        trustScore: 42,
        policyOverrides: { spendApprovalThreshold: 100 },
      },
    });
    const decision = await gate.evaluate(wu, makeRegistration({ mutationClass: "write" }));
    expect(decision.outcome).toBe("require_approval");
  });

  it("is a no-op for a non-financial action under autonomous", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);
    const decision = await gate.evaluate(
      autonomousWorkUnit({ note: "no money here" }),
      makeRegistration({ mutationClass: "write" }),
    );
    expect(decision.outcome).toBe("require_approval");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm --filter @switchboard/core test governance-gate.test.ts`
Expected: FAIL (threshold logic not wired; downgrade/park assertions fail).

- [ ] **Step 3: Wire the helper**

In `governance-gate.ts`, add imports after line 21:

```ts
import { extractSpendAmount } from "../../engine/spend-limits.js";
import { applySpendApprovalThreshold } from "./spend-approval-threshold.js";
```

Replace the final `return toGovernanceDecision(trace, constraints);` (line 169) with:

```ts
const decision = toGovernanceDecision(trace, constraints);

// Spend-approval threshold — the per-deployment autonomy lever. Dormant
// unless the deployment is explicitly autonomous; never relaxes a deny.
return applySpendApprovalThreshold(decision, {
  trustLevelOverride: workUnit.deployment?.trustLevelOverride,
  threshold: workUnit.deployment?.policyOverrides?.spendApprovalThreshold,
  spendAmount: extractSpendAmount(proposal),
  mutationClass: registration.mutationClass,
  reversibility: riskInput.reversibility,
});
```

- [ ] **Step 4: Run, verify pass (and no regressions)**

Run: `pnpm --filter @switchboard/core test governance-gate.test.ts`
Expected: PASS (new + all 17 existing).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/governance/governance-gate.ts packages/core/src/platform/__tests__/governance-gate.test.ts
git commit -m "feat(core): enforce spendApprovalThreshold in GovernanceGate.evaluate"
```

---

### Task 4: Thread `policyOverrides` through the live mapper (#644)

**Files:**

- Modify: `apps/api/src/bootstrap/platform-deployment-resolver.ts:22-32`
- Test: `apps/api/src/__tests__/platform-deployment-resolver.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append, mirroring the trustLevelOverride test)**

```ts
it("forwards policyOverrides (spendApprovalThreshold) to the context", async () => {
  const authoritative = resolveAuthoritativeDeployment(
    makeResolver(makeResult({ policyOverrides: { spendApprovalThreshold: 250 } })),
  );
  const ctx = await authoritative.resolve(REQUEST);
  // Seam: if policyOverrides is dropped here, GovernanceGate never sees the
  // threshold and the autonomy lever is inert in production (#644).
  expect(ctx.policyOverrides?.spendApprovalThreshold).toBe(250);
});
```

If `makeResult` does not already accept `policyOverrides`, it does via
`Partial<DeploymentResolverResult>` spread; confirm the helper's signature.

- [ ] **Step 2: Run, verify failure**

Run: `pnpm --filter @switchboard/api test platform-deployment-resolver.test.ts`
Expected: FAIL (`ctx.policyOverrides` is undefined).

- [ ] **Step 3: Implement — add one line to the resolved context**

In `resolveAuthoritativeDeployment`, in the object returned after
`trustLevelOverride: result.trustLevelOverride,` add:

```ts
        // Forward policyOverrides so spendApprovalThreshold reaches GovernanceGate.
        // Dropping it here is the #644 footgun that left the threshold inert.
        policyOverrides: result.policyOverrides,
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @switchboard/api test platform-deployment-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/platform-deployment-resolver.ts apps/api/src/__tests__/platform-deployment-resolver.test.ts
git commit -m "fix(api): thread policyOverrides through resolveAuthoritativeDeployment (#644)"
```

---

### Task 5: Producer-population — structured spend amount on Riley recommendations

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-sink.ts:310-334`
- Test: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it("populates parameters.spendAmount from dollarsAtRisk for financialEffect actions", async () => {
  const emit = vi.fn().mockResolvedValue({ surface: "queue" });
  await runRecommendationSink({
    orgId: "org-1",
    auditRunId: "run-1",
    recommendations: [baseRec({ action: "scale", estimatedImpact: "Scale to save ~$450/mo" })],
    emit,
    emissionContext: { cronId: "c1" },
  });
  const input = emit.mock.calls[0][0];
  expect(input.financialEffect).toBe(true);
  expect(input.parameters.spendAmount).toBe(450);
});

it("does NOT populate spendAmount when no dollar figure is present (fail-safe: stays parked)", async () => {
  const emit = vi.fn().mockResolvedValue({ surface: "queue" });
  await runRecommendationSink({
    orgId: "org-1",
    auditRunId: "run-1",
    recommendations: [baseRec({ action: "scale", estimatedImpact: "Scale for better reach" })],
    emit,
    emissionContext: { cronId: "c1" },
  });
  expect(emit.mock.calls[0][0].parameters.spendAmount).toBeUndefined();
});

it("does NOT populate spendAmount for non-financial (informational) actions", async () => {
  const emit = vi.fn().mockResolvedValue({ surface: "shadow_action" });
  await runRecommendationSink({
    orgId: "org-1",
    auditRunId: "run-1",
    recommendations: [baseRec({ action: "hold", estimatedImpact: "Hold — ~$50 at stake" })],
    emit,
    emissionContext: { cronId: "c1" },
  });
  expect(emit.mock.calls[0][0].parameters.spendAmount).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test recommendation-sink.test.ts`
Expected: FAIL (`spendAmount` undefined for financial action).

- [ ] **Step 3: Implement**

In `runRecommendationSink`, inside the loop, compute the dollar figure once and
inject it as structured `parameters.spendAmount` only when financial and known:

```ts
const { financialEffect, externalEffect } = ACTION_RISK_CONTRACT[rec.action];
const dollarsAtRisk = estimateRisk(rec);
const result = await args.emit(
  {
    orgId: args.orgId,
    agentKey: "riley",
    intent: `recommendation.${rec.action}`,
    action: rec.action,
    humanSummary: humanizeRecommendation(rec),
    confidence: rec.confidence,
    dollarsAtRisk,
    riskLevel: URGENCY_TO_RISK[rec.urgency],
    financialEffect,
    externalEffect,
    clientFacing: false,
    requiresConfirmation: false,
    parameters: {
      ...((rec as { params?: Record<string, unknown> }).params ?? {}),
      // Surface the dollar figure as STRUCTURED data so the governance gate's
      // extractSpendAmount can read it. Only for financial actions with a known
      // figure — an unknown amount must fail safe (stay parked), so omit it.
      ...(financialEffect && dollarsAtRisk > 0 ? { spendAmount: dollarsAtRisk } : {}),
    },
    presentation: buildPresentation(rec),
    targetEntities: { campaignId: rec.campaignId, campaignName: rec.campaignName },
    expiresAt,
    sourceWorkflow: args.auditRunId,
  },
  args.emissionContext,
);
```

(Removes the now-duplicate inline `estimateRisk(rec)` from the `dollarsAtRisk:` field.)

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @switchboard/ad-optimizer test recommendation-sink.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/recommendation-sink.ts packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts
git commit -m "feat(ad-optimizer): emit structured parameters.spendAmount on Riley recs"
```

---

### Task 6: Reinforce deny-floor trust-independence + full verification

**Files:**

- Modify: `packages/core/src/skill-runtime/__tests__/deny-floor-trust-independence.test.ts` (append a note-test)

- [ ] **Step 1: Append an assertion that the new platform-gate lever cannot reach the afterSkill floor**

```ts
it("the spend-approval threshold lives only in the platform gate, not as a beforeToolCall/afterSkill hook", async () => {
  // The autonomy lever post-processes the platform GovernanceDecision; it is not
  // a skill-runtime hook, so it cannot relax the banned-phrase / claim / consent
  // floor regardless of trust posture. Pin the module shape so a future refactor
  // can't quietly turn it into a trust-gated hook.
  const mod = await import("../../platform/governance/spend-approval-threshold.js");
  expect(typeof mod.applySpendApprovalThreshold).toBe("function");
  expect("beforeToolCall" in mod).toBe(false);
  expect("afterSkill" in mod).toBe(false);
});
```

- [ ] **Step 2: Run the focused suites**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/ad-optimizer test
```

Expected: all PASS.

- [ ] **Step 3: Run the S1 governance regression lock + typecheck/lint/format**

```bash
pnpm eval:governance
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: governance eval "All 26 governance decisions match the live gate."; typecheck/lint/format clean.

- [ ] **Step 4: Full build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/deny-floor-trust-independence.test.ts
git commit -m "test(core): pin spend-threshold lever outside the deny floor"
```

---

## Self-Review

- **Spec coverage:** §3.1 → Task 1; §3.3 → Tasks 2-3; §3.2 → Task 4; §3.4 → Task 5; §4 invariants → Tasks 2-3-6; §4.6 (#781 lock) → Task 6 Step 3. All covered.
- **Type consistency:** `applySpendApprovalThreshold(decision, ctx)` + `SpendApprovalThresholdContext` fields (`trustLevelOverride`, `threshold`, `spendAmount`, `mutationClass`, `reversibility`) identical across Tasks 2 & 3. `SPEND_APPROVAL_THRESHOLD` marker constant consistent. `extractSpendAmount` signature unchanged (still `(proposal) => number | null`).
- **No placeholders:** every code step is concrete.
