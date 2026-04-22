import { describe, it, expect } from "vitest";
import { validateDispatchAdmission, DispatchAdmissionError } from "../dispatch-admission.js";
import type { ApprovalLifecycle, ExecutableWorkUnit } from "@switchboard/schemas";

function makeLifecycle(overrides: Partial<ApprovalLifecycle> = {}): ApprovalLifecycle {
  return {
    id: "lc-1",
    actionEnvelopeId: "env-1",
    organizationId: "org-1",
    status: "approved",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: "ewu-1",
    expiresAt: new Date(Date.now() + 86400000),
    pausedSessionId: null,
    version: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeWorkUnit(overrides: Partial<ExecutableWorkUnit> = {}): ExecutableWorkUnit {
  return {
    id: "ewu-1",
    lifecycleId: "lc-1",
    approvalRevisionId: "rev-1",
    actionEnvelopeId: "env-1",
    frozenPayload: {},
    frozenBinding: {},
    frozenExecutionPolicy: {},
    executableUntil: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("validateDispatchAdmission", () => {
  it("passes when lifecycle is approved and pointer matches", () => {
    expect(() => validateDispatchAdmission(makeLifecycle(), makeWorkUnit())).not.toThrow();
  });

  it("rejects when lifecycle status is not approved", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle({ status: "pending" }), makeWorkUnit()),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when lifecycle status is rejected", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle({ status: "rejected" }), makeWorkUnit()),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when lifecycle status is expired", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle({ status: "expired" }), makeWorkUnit()),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when lifecycle pointer does not match work unit id", () => {
    const err = expect(() =>
      validateDispatchAdmission(
        makeLifecycle({ currentExecutableWorkUnitId: "ewu-other" }),
        makeWorkUnit(),
      ),
    );
    err.toThrow(DispatchAdmissionError);
  });

  it("returns STALE_AUTHORITY code on pointer mismatch", () => {
    try {
      validateDispatchAdmission(
        makeLifecycle({ currentExecutableWorkUnitId: "ewu-other" }),
        makeWorkUnit(),
      );
    } catch (e) {
      expect((e as DispatchAdmissionError).code).toBe("STALE_AUTHORITY");
    }
  });

  it("rejects when lifecycle pointer is null", () => {
    expect(() =>
      validateDispatchAdmission(
        makeLifecycle({ currentExecutableWorkUnitId: null }),
        makeWorkUnit(),
      ),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when work unit has expired", () => {
    expect(() =>
      validateDispatchAdmission(
        makeLifecycle(),
        makeWorkUnit({ executableUntil: new Date(Date.now() - 1000) }),
      ),
    ).toThrow(DispatchAdmissionError);
  });

  it("returns EXPIRED_WORK_UNIT code on expiry", () => {
    try {
      validateDispatchAdmission(
        makeLifecycle(),
        makeWorkUnit({ executableUntil: new Date(Date.now() - 1000) }),
      );
    } catch (e) {
      expect((e as DispatchAdmissionError).code).toBe("EXPIRED_WORK_UNIT");
    }
  });

  it("rejects when work unit lifecycleId does not match lifecycle id", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle(), makeWorkUnit({ lifecycleId: "lc-other" })),
    ).toThrow(DispatchAdmissionError);
  });
});
