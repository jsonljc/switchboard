import { describe, it, expect } from "vitest";
import {
  ApprovalLifecycleStatusSchema,
  ApprovalLifecycleSchema,
  ApprovalRevisionSchema,
  ExecutableWorkUnitSchema,
  DispatchRecordSchema,
  DispatchRecordStateSchema,
  LifecycleCommandSchema,
} from "../approval-lifecycle.js";

describe("ApprovalLifecycleStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of [
      "pending",
      "approved",
      "rejected",
      "expired",
      "superseded",
      "recovery_required",
    ]) {
      expect(ApprovalLifecycleStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => ApprovalLifecycleStatusSchema.parse("patched")).toThrow();
  });
});

describe("ApprovalLifecycleSchema", () => {
  it("parses a valid lifecycle object", () => {
    const result = ApprovalLifecycleSchema.parse({
      id: "lc-1",
      actionEnvelopeId: "env-1",
      organizationId: "org-1",
      status: "pending",
      currentRevisionId: "rev-1",
      currentExecutableWorkUnitId: null,
      expiresAt: new Date().toISOString(),
      pausedSessionId: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.id).toBe("lc-1");
    expect(result.status).toBe("pending");
  });
});

describe("ApprovalRevisionSchema", () => {
  it("parses a valid revision", () => {
    const result = ApprovalRevisionSchema.parse({
      id: "rev-1",
      lifecycleId: "lc-1",
      revisionNumber: 1,
      parametersSnapshot: { budget: 5000 },
      approvalScopeSnapshot: { approvers: ["user-1"], riskCategory: "medium" },
      bindingHash: "a".repeat(64),
      rationale: null,
      supersedesRevisionId: null,
      createdBy: "user-1",
      createdAt: new Date().toISOString(),
    });
    expect(result.revisionNumber).toBe(1);
  });
});

describe("ExecutableWorkUnitSchema", () => {
  it("parses a valid executable work unit", () => {
    const result = ExecutableWorkUnitSchema.parse({
      id: "ewu-1",
      lifecycleId: "lc-1",
      approvalRevisionId: "rev-1",
      actionEnvelopeId: "env-1",
      frozenPayload: { intent: "campaign.pause", parameters: {} },
      frozenBinding: { deploymentId: "dep-1" },
      frozenExecutionPolicy: { maxRetries: 3 },
      executableUntil: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(result.id).toBe("ewu-1");
  });
});

describe("DispatchRecordSchema", () => {
  it("parses a valid dispatch record", () => {
    const result = DispatchRecordSchema.parse({
      id: "dr-1",
      executableWorkUnitId: "ewu-1",
      attemptNumber: 1,
      idempotencyKey: "idem-1",
      state: "dispatching",
      dispatchedAt: new Date().toISOString(),
      completedAt: null,
      outcome: null,
      errorMessage: null,
      durationMs: null,
    });
    expect(result.state).toBe("dispatching");
  });
});

describe("DispatchRecordStateSchema", () => {
  it("rejects invalid state", () => {
    expect(() => DispatchRecordStateSchema.parse("pending")).toThrow();
  });
});

describe("LifecycleCommandSchema", () => {
  it("accepts valid commands", () => {
    for (const c of [
      "create_gated_lifecycle",
      "create_revision",
      "approve_revision",
      "reject_revision",
      "create_revision_and_approve",
      "expire_lifecycle",
      "dispatch_executable_work_unit",
      "record_dispatch_outcome",
    ]) {
      expect(LifecycleCommandSchema.parse(c)).toBe(c);
    }
  });
});
