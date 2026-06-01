import { describe, it, expect } from "vitest";
import type { WorkTrace } from "../work-trace.js";
import type { WorkUnit } from "../work-unit.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkOutcome } from "../types.js";
import { buildWorkTrace } from "../work-trace-recorder.js";
import type { TraceInput } from "../work-trace-recorder.js";
import { assertNoMutatingBypass, MutatingBypassError } from "../work-trace-bypass-guard.js";

// Doctrine under test (DOCTRINE.md / CLAUDE.md): "No mutating bypass paths."
// A WorkTrace whose outcome is the terminal success value "completed" asserts a
// mutating action actually executed. That is only legitimate when governance
// AUTHORIZED execution (governanceOutcome === "execute") AND governance finished
// BEFORE execution began (governanceCompletedAt <= executionStartedAt). Any other
// shape is an execute-without-approval or approve-after-execute bypass.

// ISO-8601 UTC anchors. These compare lexicographically, the same way the rest of
// the platform compares trace timestamps (see work-trace-integrity.ts).
const T_GOV = "2026-04-16T10:00:01.000Z"; // governance completed
const T_EXEC = "2026-04-16T10:00:01.500Z"; // execution started (after governance)

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

/** A legitimately-executed trace: completed, execute-authorized, governance-before-execution. */
function executedTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu-1",
    traceId: "trace-1",
    intent: "campaign.pause",
    mode: "skill",
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    trigger: "chat",
    governanceOutcome: "execute",
    riskScore: 10,
    matchedPolicies: ["P1"],
    outcome: "completed",
    durationMs: 100,
    requestedAt: "2026-04-16T10:00:00.000Z",
    governanceCompletedAt: T_GOV,
    executionStartedAt: T_EXEC,
    ingressPath: "platform_ingress",
    hashInputVersion: 2,
    ...overrides,
  };
}

describe("assertNoMutatingBypass — the no-mutating-bypass guard", () => {
  it("admits a completed trace governance authorized before execution started", () => {
    expect(() => assertNoMutatingBypass(executedTrace())).not.toThrow();
  });

  it("admits the boundary where governance completes exactly at execution start", () => {
    expect(() =>
      assertNoMutatingBypass(
        executedTrace({ governanceCompletedAt: T_EXEC, executionStartedAt: T_EXEC }),
      ),
    ).not.toThrow();
  });

  it("rejects a completed trace whose governance only required approval", () => {
    expect(() =>
      assertNoMutatingBypass(executedTrace({ governanceOutcome: "require_approval" })),
    ).toThrow(MutatingBypassError);
  });

  it("rejects a completed trace whose governance denied execution", () => {
    expect(() => assertNoMutatingBypass(executedTrace({ governanceOutcome: "deny" }))).toThrow(
      MutatingBypassError,
    );
  });

  it("rejects a completed trace with no executionStartedAt", () => {
    expect(() => assertNoMutatingBypass(executedTrace({ executionStartedAt: undefined }))).toThrow(
      MutatingBypassError,
    );
  });

  it("rejects a completed trace where execution started before governance finished", () => {
    expect(() =>
      assertNoMutatingBypass(
        executedTrace({ governanceCompletedAt: T_EXEC, executionStartedAt: T_GOV }),
      ),
    ).toThrow(MutatingBypassError);
  });

  it.each(["failed", "pending_approval", "queued", "running"] as WorkOutcome[])(
    "ignores non-executed outcome %s even under denied governance",
    (outcome) => {
      // Only the terminal SUCCESS outcome ("completed") asserts a mutation ran; other
      // outcomes never executed, so they cannot be a mutating bypass.
      expect(() =>
        assertNoMutatingBypass(
          executedTrace({ outcome, governanceOutcome: "deny", executionStartedAt: undefined }),
        ),
      ).not.toThrow();
    },
  );
});

// Independent re-statement of the invariant. Deliberately NOT the production guard,
// so the property below cannot pass vacuously against a no-op guard.
function isBypassTrace(t: WorkTrace): boolean {
  if (t.outcome !== "completed") return false;
  return !(
    t.governanceOutcome === "execute" &&
    t.executionStartedAt !== undefined &&
    t.governanceCompletedAt <= t.executionStartedAt
  );
}

function makeExecutionResult(outcome: WorkOutcome): ExecutionResult {
  return {
    workUnitId: "wu-1",
    outcome,
    summary: `outcome=${outcome}`,
    outputs: {},
    mode: "skill",
    durationMs: 100,
    traceId: "trace-1",
  };
}

describe("buildWorkTrace can never emit an executed-without-approval trace", () => {
  const GOV_DECISIONS: Array<{ label: string; decision: GovernanceDecision }> = [
    { label: "execute", decision: executeDecision },
    { label: "require_approval", decision: approvalDecision },
    { label: "deny", decision: denyDecision },
  ];

  const EXEC_OUTCOMES: Array<WorkOutcome | "none"> = [
    "completed",
    "failed",
    "queued",
    "running",
    "pending_approval",
    "none",
  ];

  const TIMINGS: Array<{
    label: string;
    governanceCompletedAt: string;
    executionStartedAt?: string;
  }> = [
    { label: "gov<exec", governanceCompletedAt: T_GOV, executionStartedAt: T_EXEC },
    { label: "gov==exec", governanceCompletedAt: T_EXEC, executionStartedAt: T_EXEC },
    { label: "gov>exec", governanceCompletedAt: T_EXEC, executionStartedAt: T_GOV },
    { label: "exec-missing", governanceCompletedAt: T_GOV, executionStartedAt: undefined },
  ];

  const combos = GOV_DECISIONS.flatMap((gov) =>
    EXEC_OUTCOMES.flatMap((exec) => TIMINGS.map((timing) => ({ gov, exec, timing }))),
  );

  it("returns a non-bypass trace or throws for every governance × execution × timing combo", () => {
    let emitted = 0;
    let rejected = 0;

    for (const { gov, exec, timing } of combos) {
      const input: TraceInput = {
        workUnit: baseWorkUnit,
        governanceDecision: gov.decision,
        governanceCompletedAt: timing.governanceCompletedAt,
        executionStartedAt: timing.executionStartedAt,
        executionResult: exec === "none" ? undefined : makeExecutionResult(exec),
      };

      let trace: WorkTrace;
      try {
        trace = buildWorkTrace(input);
      } catch (err) {
        rejected++;
        expect(err).toBeInstanceOf(MutatingBypassError);
        continue;
      }

      emitted++;
      // The universal property: a RETURNED trace is never a mutating bypass.
      expect(
        isBypassTrace(trace),
        `bypass emitted for gov=${gov.label} exec=${exec} timing=${timing.label}`,
      ).toBe(false);
    }

    // Coverage guard so the property cannot pass vacuously. Only a "completed"
    // executionResult yields a "completed" trace, so violations come from:
    //   execute          → gov>exec, exec-missing            = 2
    //   require_approval → all four timings                  = 4
    //   deny             → all four timings                  = 4
    expect(rejected).toBe(10);
    expect(emitted).toBe(combos.length - 10);
  });

  it("emits a valid trace for the legitimate execute + completed + ordered path", () => {
    const trace = buildWorkTrace({
      workUnit: baseWorkUnit,
      governanceDecision: executeDecision,
      governanceCompletedAt: T_GOV,
      executionStartedAt: T_EXEC,
      executionResult: makeExecutionResult("completed"),
    });
    expect(trace.outcome).toBe("completed");
    expect(trace.governanceOutcome).toBe("execute");
    expect(isBypassTrace(trace)).toBe(false);
  });

  it.each([
    ["require_approval", approvalDecision],
    ["deny", denyDecision],
  ] as const)("throws when a completed execution rides %s governance", (_label, decision) => {
    expect(() =>
      buildWorkTrace({
        workUnit: baseWorkUnit,
        governanceDecision: decision,
        governanceCompletedAt: T_GOV,
        executionStartedAt: T_EXEC,
        executionResult: makeExecutionResult("completed"),
      }),
    ).toThrow(MutatingBypassError);
  });

  it("throws when a completed execution started before governance finished", () => {
    expect(() =>
      buildWorkTrace({
        workUnit: baseWorkUnit,
        governanceDecision: executeDecision,
        governanceCompletedAt: T_EXEC,
        executionStartedAt: T_GOV,
        executionResult: makeExecutionResult("completed"),
      }),
    ).toThrow(MutatingBypassError);
  });

  it("throws when a completed execution carries no executionStartedAt", () => {
    expect(() =>
      buildWorkTrace({
        workUnit: baseWorkUnit,
        governanceDecision: executeDecision,
        governanceCompletedAt: T_GOV,
        executionResult: makeExecutionResult("completed"),
      }),
    ).toThrow(MutatingBypassError);
  });
});
