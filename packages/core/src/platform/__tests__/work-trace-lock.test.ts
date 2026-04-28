import { describe, it, expect } from "vitest";
import {
  validateUpdate,
  WorkTraceLockedError,
  TERMINAL_OUTCOMES,
  ALLOWED_OUTCOME_TRANSITIONS,
} from "../work-trace-lock.js";
import type { WorkTrace } from "../work-trace.js";

function makeTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu_1",
    traceId: "t_1",
    intent: "test.intent",
    mode: "skill",
    organizationId: "org_1",
    actor: { id: "actor_1", type: "user" },
    trigger: "api",
    governanceOutcome: "execute",
    riskScore: 0,
    matchedPolicies: [],
    outcome: "running",
    durationMs: 0,
    requestedAt: "2026-04-28T00:00:00.000Z",
    governanceCompletedAt: "2026-04-28T00:00:01.000Z",
    ...overrides,
  };
}

describe("TERMINAL_OUTCOMES", () => {
  it("contains exactly completed and failed", () => {
    expect([...TERMINAL_OUTCOMES].sort()).toEqual(["completed", "failed"]);
  });
});

describe("ALLOWED_OUTCOME_TRANSITIONS", () => {
  it("encodes the lifecycle from spec §1", () => {
    expect([...ALLOWED_OUTCOME_TRANSITIONS.pending_approval].sort()).toEqual([
      "completed",
      "failed",
      "queued",
      "running",
    ]);
    expect([...ALLOWED_OUTCOME_TRANSITIONS.queued].sort()).toEqual([
      "completed",
      "failed",
      "running",
    ]);
    expect([...ALLOWED_OUTCOME_TRANSITIONS.running].sort()).toEqual(["completed", "failed"]);
    expect(ALLOWED_OUTCOME_TRANSITIONS.completed.size).toBe(0);
    expect(ALLOWED_OUTCOME_TRANSITIONS.failed.size).toBe(0);
  });
});

describe("validateUpdate — outcome transitions", () => {
  it("allows running -> completed and stamps lockedAt", () => {
    const current = makeTrace({ outcome: "running" });
    const result = validateUpdate({ current, update: { outcome: "completed" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.computedLockedAt).toBe("string");
  });

  it("rejects completed -> running (illegal regress on locked trace)", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({ current, update: { outcome: "running" as never } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("outcome");
  });

  it("allows pending_approval -> pending_approval no-op alongside non-outcome fields", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({
      current,
      update: { outcome: "pending_approval", approvalId: "appr_1" },
    });
    expect(result.ok).toBe(true);
  });

  it("non-terminal transitions do not stamp lockedAt", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({ current, update: { outcome: "running" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.computedLockedAt).toBeNull();
  });
});

describe("validateUpdate — bucket A (always-immutable)", () => {
  it("rejects mutating organizationId", () => {
    const current = makeTrace();
    const result = validateUpdate({
      current,
      update: { organizationId: "org_2" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("organizationId");
  });

  it("rejects mutating governanceConstraints", () => {
    const current = makeTrace();
    const result = validateUpdate({
      current,
      update: {
        governanceConstraints: {
          allowedModelTiers: ["default"],
          maxToolCalls: 1,
          maxLlmTurns: 1,
          maxTotalTokens: 100,
          maxRuntimeMs: 1000,
          maxWritesPerExecution: 1,
          trustLevel: "guided",
        },
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — bucket B (parameters)", () => {
  it("allows parameters change while approvalOutcome and executionStartedAt and lockedAt are unset", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({
      current,
      update: { parameters: { v: 2 } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects parameters change once approvalOutcome is set", () => {
    const current = makeTrace({
      outcome: "pending_approval",
      approvalOutcome: "approved",
    });
    const result = validateUpdate({ current, update: { parameters: { v: 2 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("parameters");
  });

  it("rejects parameters change once executionStartedAt is set", () => {
    const current = makeTrace({
      outcome: "running",
      executionStartedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({ current, update: { parameters: { v: 2 } } });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — bucket C (one-shot)", () => {
  it("allows first set of approvalId", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({
      current,
      update: {
        approvalId: "appr_1",
        approvalOutcome: "approved",
        approvalRespondedBy: "user_1",
        approvalRespondedAt: "2026-04-28T00:00:02.000Z",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects second set of approvalId", () => {
    const current = makeTrace({
      outcome: "pending_approval",
      approvalId: "appr_1",
    });
    const result = validateUpdate({ current, update: { approvalId: "appr_2" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("approvalId");
  });

  it("rejects second set of executionStartedAt", () => {
    const current = makeTrace({
      outcome: "running",
      executionStartedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({
      current,
      update: { executionStartedAt: "2026-04-28T00:00:03.000Z" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — bucket D (terminal-only)", () => {
  it("allows executionOutputs on terminal write", () => {
    const current = makeTrace({ outcome: "running" });
    const result = validateUpdate({
      current,
      update: { outcome: "completed", executionOutputs: { ok: true } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects executionOutputs rewrite after lock", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
      executionOutputs: { ok: true },
    });
    const result = validateUpdate({
      current,
      update: { executionOutputs: { ok: false } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("executionOutputs");
  });
});

describe("validateUpdate — bucket E (modeMetrics)", () => {
  it("allows modeMetrics until lock", () => {
    const current = makeTrace({ outcome: "running" });
    const result = validateUpdate({
      current,
      update: { modeMetrics: { tokens: 100 } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects modeMetrics after lock", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({
      current,
      update: { modeMetrics: { tokens: 200 } },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — locked trace blanket rejection", () => {
  it("rejects any field write after lockedAt is set", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({ current, update: { durationMs: 999 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.lockedAt).toBe("2026-04-28T00:00:02.000Z");
      expect(result.diagnostic.currentOutcome).toBe("completed");
    }
  });
});

describe("WorkTraceLockedError", () => {
  it("carries diagnostic + code", () => {
    const err = new WorkTraceLockedError({
      traceId: "t_1",
      workUnitId: "wu_1",
      currentOutcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
      rejectedFields: ["executionOutputs"],
      reason: "Trace locked",
    });
    expect(err.code).toBe("WORK_TRACE_LOCKED");
    expect(err.diagnostic.workUnitId).toBe("wu_1");
    expect(err.message).toContain("Trace locked");
  });
});
