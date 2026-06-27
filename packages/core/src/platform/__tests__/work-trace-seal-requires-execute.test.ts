import { describe, it, expect } from "vitest";
import type { WorkTrace } from "../work-trace.js";
import type { WorkUnit } from "../work-unit.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import { buildWorkTrace } from "../work-trace-recorder.js";
import { assertNoMutatingBypass, MutatingBypassError } from "../work-trace-bypass-guard.js";
import { validateUpdate } from "../work-trace-lock.js";

// ---------------------------------------------------------------------------
// EV-9b / GOV-5 — a `completed` seal must rest on a `governanceOutcome ===
// "execute"` claim.
//
// "completed" is the only trace outcome that attests a mutating action ran to
// success. The no-mutating-bypass guard (work-trace-bypass-guard.ts) enforces
// at CONSTRUCTION that such a seal carries `governanceOutcome === "execute"` —
// you cannot BUILD a completed trace off a require_approval / deny decision.
//
// SCOPE BOUNDARY (the bypass-guard doc flags this, and this suite PINS it): the
// guard runs on construction (`buildWorkTrace`), NOT on the store's terminal
// transition. The approval-execute seal path (`executeAfterApproval`) reaches
// "completed" via `WorkTraceStore.update()`, and the lock (`validateUpdate`)
// does NOT re-check `governanceOutcome` there. Authorization on that path comes
// from the approved-envelope gate, not from a re-stamped execute claim, so a
// require_approval trace CAN be sealed to completed through the lock. This is a
// documented boundary, not a leak — but it is exactly the place a future
// "extend the invariant to the store transition" change must flag.
// ---------------------------------------------------------------------------

const T_GOV = "2026-04-16T10:00:01.000Z";
const T_EXEC = "2026-04-16T10:00:01.500Z";

const baseWorkUnit: WorkUnit = {
  id: "wu-1",
  traceId: "trace-1",
  requestedAt: "2026-04-16T10:00:00.000Z",
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  deployment: {
    deploymentId: "dep-1",
    skillSlug: "test-skill",
    trustLevel: "guided",
    trustScore: 42,
  },
  resolvedMode: "skill",
  trigger: "chat",
  priority: "normal",
};

const constraints = {
  allowedModelTiers: ["default" as const],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30000,
  maxWritesPerExecution: 2,
  trustLevel: "guided" as const,
};

const executeDecision: GovernanceDecision = {
  outcome: "execute",
  riskScore: 0.2,
  budgetProfile: "standard",
  constraints,
  matchedPolicies: ["default-policy"],
};

const approvalDecision: GovernanceDecision = {
  outcome: "require_approval",
  riskScore: 0.6,
  approvalLevel: "manager",
  approvers: ["mgr-1"],
  constraints,
  matchedPolicies: ["approval-required"],
};

const denyDecision: GovernanceDecision = {
  outcome: "deny",
  reasonCode: "BUDGET_EXCEEDED",
  riskScore: 0.9,
  matchedPolicies: ["budget-limit"],
};

function completedResult(): ExecutionResult {
  return {
    workUnitId: "wu-1",
    outcome: "completed",
    summary: "executed",
    outputs: {},
    mode: "skill",
    durationMs: 100,
    traceId: "trace-1",
  };
}

/** A persisted, NOT-yet-sealed parked trace: governance required approval, so
 * outcome is pending_approval and governanceOutcome is require_approval. */
function parkedRequireApprovalTrace(): WorkTrace {
  return {
    workUnitId: "wu-1",
    traceId: "trace-1",
    intent: "campaign.pause",
    mode: "skill",
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    trigger: "chat",
    governanceOutcome: "require_approval",
    riskScore: 0.6,
    matchedPolicies: ["approval-required"],
    outcome: "pending_approval",
    durationMs: 0,
    requestedAt: "2026-04-16T10:00:00.000Z",
    governanceCompletedAt: T_GOV,
    ingressPath: "platform_ingress",
    hashInputVersion: 2,
  } as WorkTrace;
}

describe("GOV-5: a constructed `completed` seal requires governanceOutcome === execute", () => {
  it("admits a completed seal under an execute claim", () => {
    const trace = buildWorkTrace({
      workUnit: baseWorkUnit,
      governanceDecision: executeDecision,
      governanceCompletedAt: T_GOV,
      executionStartedAt: T_EXEC,
      executionResult: completedResult(),
    });
    expect(trace.outcome).toBe("completed");
    expect(trace.governanceOutcome).toBe("execute");
    expect(() => assertNoMutatingBypass(trace)).not.toThrow();
  });

  it("REFUSES to construct a completed seal off a require_approval claim", () => {
    expect(() =>
      buildWorkTrace({
        workUnit: baseWorkUnit,
        governanceDecision: approvalDecision,
        governanceCompletedAt: T_GOV,
        executionStartedAt: T_EXEC,
        executionResult: completedResult(),
      }),
    ).toThrow(MutatingBypassError);
  });

  it("REFUSES to construct a completed seal off a deny claim", () => {
    expect(() =>
      buildWorkTrace({
        workUnit: baseWorkUnit,
        governanceDecision: denyDecision,
        governanceCompletedAt: T_GOV,
        executionStartedAt: T_EXEC,
        executionResult: completedResult(),
      }),
    ).toThrow(MutatingBypassError);
  });

  it("the guard directly rejects a hand-built completed + non-execute trace", () => {
    const bypass = {
      ...parkedRequireApprovalTrace(),
      outcome: "completed",
      executionStartedAt: T_EXEC,
    } as WorkTrace;
    expect(() => assertNoMutatingBypass(bypass)).toThrow(MutatingBypassError);
  });
});

describe("GOV-5 scope boundary (SURFACE): the store lock does NOT re-check governanceOutcome on the completed transition", () => {
  it("validateUpdate PERMITS sealing a require_approval parked trace to completed", () => {
    // This is the approval-execute seal path. The lock allows pending_approval ->
    // completed and stamps lockedAt, WITHOUT asserting governanceOutcome ===
    // execute (governanceOutcome is immutable and stays "require_approval").
    // assertNoMutatingBypass is NOT a gate here — authorization is the approved
    // envelope check in executeAfterApproval.
    const current = parkedRequireApprovalTrace();
    const result = validateUpdate({
      current,
      update: {
        outcome: "completed",
        executionStartedAt: T_EXEC,
        completedAt: "2026-04-16T10:00:02.000Z",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // entering a terminal outcome stamps the seal timestamp
      expect(typeof result.computedLockedAt).toBe("string");
    }

    // The boundary made explicit: the very shape the lock just permitted is one
    // the CONSTRUCTION guard would reject as a mutating bypass.
    const sealed = {
      ...current,
      outcome: "completed",
      executionStartedAt: T_EXEC,
    } as WorkTrace;
    expect(() => assertNoMutatingBypass(sealed)).toThrow(MutatingBypassError);
  });
});
